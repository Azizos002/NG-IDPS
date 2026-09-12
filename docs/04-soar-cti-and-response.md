# 04 — SOAR, CTI, and Response

This document specifies **automated orchestration** (`vm-ml/soar.py`), **human and Auto-Pilot actuation** (`vm-response/agent_soar.py`, `backend/server.js`), **safety interlocks**, and the **anticipatory CTI / RAG / LMS** subsystem under `vm-response/anticipation/` plus Gemini routes on the hub.

---

## 1. SOAR decision engine (`soar.py`)

### 1.1 Placement and I/O

| Item | Value |
|------|-------|
| Host | VM-ML `192.168.56.130` |
| Kafka bootstrap | `192.168.56.130:9092` |
| Consume | `ml-alerts`, `suricata-alerts` |
| Group | `soar-orchestrator` |
| Offset | `latest` |
| Produce | `alerts-for-llm`; also `incident-reports` on Zero-Trust bypass |
| SSH target | `aziz@192.168.56.128`, identity `/home/aziz/.ssh/soar_key`, `StrictHostKeyChecking=no` |
| Whitelist file | `actifs_critiques.json` (working directory), keys `whitelist` or `actifs_critiques` |
| Correlation window | `FENETRE_CORRELATION_SEC = 30` |
| LLM debounce | `COOLDOWN_LLM_SEC = 60` keyed by Suricata **category** |

In-memory sets (lost on restart):

- `ips_deja_bloquees` — DROP already issued **or** Zero-Trust logical lock
- `ips_en_cours_ia` — Palier 2 LLM already notified for this IP
- `derniere_alerte_ml`, `derniere_alerte_suricata` — last Unix time per IP
- `cache_alertes_soar` — last LLM notification time per **category**

Whitelist is **re-read from disk on every Kafka record** (`charger_actifs_critiques()`), so hub-driven file updates are visible to SOAR without restart **if** the file path SOAR opens is the one being written.

### 1.2 IP hygiene

`ip_valide(ip)` requires `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$`. Invalid strings never reach SSH (command-injection control). Octet range 0–255 is **not** further validated (e.g. `999.1.1.1` would pass the regex).

### 1.3 `ENABLE_DDOS_SHIELD`

Triggered when `traiter_alerte_ml` sees `action == "ENABLE_DDOS_SHIELD"` (LSTM global flood, document 03). Function `activer_bouclier_anti_ddos`:

1. `sudo sysctl -w net.ipv4.tcp_syncookies=1`
2. `sudo iptables -I INPUT -p tcp --syn --dport 80 -m limit --limit 100/s --limit-burst 150 -j ACCEPT`
3. `sudo iptables -A INPUT -p tcp --syn --dport 80 -j DROP`

Each command is a separate SSH with `timeout=10`. If all succeed, produce `alerts-for-llm`:

```json
{
  "src_ip": "MULTIPLE_SPOOFED_IPS",
  "source_detection": "Bouclier Anti-DDoS (SOAR)",
  "details": "DDoS Spoofing détecté par l'analyseur volumétrique. Bouclier d'infrastructure activé automatiquement : TCP SYN Cookies et Rate-Limiting Iptables.",
  "auto_blocked": true,
  "timestamp": <unix>
}
```

Repeated shield activations **append** more iptables rules (no idempotent flush). Operators must inspect `iptables -L` after tests.

### 1.4 `bloquer_ip(ip, actifs_critiques)`

Order of guards:

1. IP ∈ whitelist → log `[AUDIT] BLOCAGE REFUSÉ`, return `False`.
2. IP ∈ `ips_deja_bloquees` → idempotent skip, `False`.
3. Regex fail → `False`.
4. SSH `sudo iptables -I INPUT -s {ip} -j DROP` → on success add to `ips_deja_bloquees`, `True`.

`CalledProcessError` and `TimeoutExpired` are logged; return `False`.

### 1.5 Palier model (ML path)

`traiter_alerte_ml`:

1. DDoS action → shield; return.
2. Missing `src_ip` → return.
3. **Zero-Trust:** IP ∈ whitelist:
   - If not already in `ips_deja_bloquees`: log lateral movement; add to set (**without** iptables); send `incident-reports`:

```json
{
  "src_ip": "<whitelist ip>",
  "diagnostic": "🚨 ALERTE INTERNE ABSOLUE (BYPASS IA) 🚨\n\nMouvement latéral détecté depuis un serveur de la Whitelist.\nLe SOAR a refusé le blocage automatique pour maintenir la continuité de service (Zero Trust).\n\nAction : Isolez la machine compromise manuellement de toute urgence."
}
```

   - Return (no LLM topic).
4. If already physically/logically blocked → return.
5. Store `derniere_alerte_ml[ip] = now`.
6. If `|t_ml - t_sur| ≤ 30` **and** both timestamps exist → Palier 3: `bloquer_ip`; on success `notifier_agent_ia(..., source="Multi-Source", auto_blocked=True)`.
7. Else Palier 2: if IP ∉ `ips_en_cours_ia`, add it and `notifier_agent_ia(..., source="LSTM-VAE (IA)", auto_blocked=False)`.

`notifier_agent_ia` always `flush()`es Kafka.

### 1.6 Palier model (Suricata path)

`traiter_alerte_suricata` reads `src_ip` or `source_ip` or `ip`; `signature` default `"Inconnue"`; `category` default `"Inconnue"`; `severity` default **3**.

Zero-Trust branch analogous, diagnostic text includes the signature.

Debounce: `generer_rapport_ia` is true only if `category` unseen or last notify \(\ge 60\) s ago. **Physical DROP can still occur** on Palier 3 even when the LLM is skipped.

- Palier 3: correlate; `bloquer_ip` **and** `generer_rapport_ia` → Multi-Source notify `auto_blocked=True`.
- Else if `severity <= 2`: Palier 2; notify Suricata if IP not in `ips_en_cours_ia` and debounce allows, `auto_blocked=False`.
- Else Palier 1: log only.

Suricata severity **1–2 = high**; **3+ = informational** in this policy (Suricata community convention).

### 1.7 Human actuator (`agent_soar.py`)

Listens Socket.IO `http://192.168.56.1:4000`, event `execute_command`.

- `action == "BLOCK_IP"` and `targetIp` present.
- `is_valid_ip`: `^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$`.
- Same SSH DROP as `soar.py`.
- Always emits `command_result` with `status` `success` or `error`.

This path is used for **dashboard clicks** and **Night Auto-Pilot**. It does **not** consult the whitelist (the hub is supposed to avoid emitting BLOCK for whitelist IPs). A crafted `execute_command` from a connected Socket.IO client could still DROP a critical IP — laboratory residual risk.

Reconnect loop: 5 s on `ConnectionError`. `sio.wait()` blocks while connected.

`unblock.py` (on VM-ML lstm-vae folder) SSHes `sudo iptables -D INPUT -s {ip} -j DROP` **without** the dedicated key (`ssh aziz@192.168.56.128` only). It prints that **`soar.py` must be restarted** to forget `ips_deja_bloquees`.

---

## 2. Safety and resilience mechanisms

### 2.1 Zero-Trust bypass for `actifs_critiques.json`

Canonical list on the hub:

```json
{
  "whitelist": [
    "192.168.56.128",
    "192.168.56.130",
    "192.168.56.140",
    "192.168.56.1"
  ]
}
```

**Enforcement points:**

| Component | Behaviour for whitelist IP |
|-----------|----------------------------|
| LSTM `realtime_interface.py` | Persistence may fire; **no** `AUTO_BLOCK_IP` |
| `soar.py` `bloquer_ip` | Hard refuse |
| `soar.py` alert handlers | `incident-reports` bypass, no `alerts-for-llm` |
| Hub Auto-Pilot | `finalStatus = "Alerte Zero Trust (Protégée)"`, no `execute_command` |
| Hub Kafka `alerts-for-llm` | Still creates a case **unless** 3-minute mute applies |
| Hub `incident-reports` | Synthesizes Bypass `diagnostic_json` if SOAR sent only `diagnostic` |

Rationale encoded in comments: **Fail-Open** for production-like assets (do not black-hole the NIDS, Kafka node, response VM, or Host). Isolation of a compromised critical asset is **manual** (operator).

Settings UI `POST/DELETE /api/whitelist` persists JSON and broadcasts `sync_whitelist`. ML `agent_monitor.py` writes `/home/aziz/dataset/actifs_critiques.json`. Align this path with `soar.py`’s relative `actifs_critiques.json` in operations (document 06).

### 2.2 Three-minute post-attack muting (collateral MSE)

Hub, on topic `alerts-for-llm` only:

```javascript
let lastExternalAttackTime = 0;
// if src_ip NOT in whitelist → lastExternalAttackTime = Date.now()
// if src_ip IN whitelist AND (now - lastExternalAttackTime) < 180000 → return
```

**Intent:** During an external flood, LSTM MSE on **internal** IPs (the sensors themselves) spikes. Those IPs are whitelisted. Without muting, the hub would open Zero-Trust cases for `.128`/`.130`/`.140`/`.1` as collateral. For **180 seconds** after the last **external** `alerts-for-llm` event, whitelist-sourced alerts are dropped.

**Limitations:**

- Single global timestamp, not per-victim.
- Does not stop `soar.py` from emitting bypass `incident-reports` (those use a different topic). Bypass reports still update cases if a matching `Analyse IA*` document exists.
- After 3 minutes, whitelist alerts are treated as genuine internal Zero-Trust (`[!] Alerte SOC (INTERNE / Zero Trust)`).

### 2.3 Night Auto-Pilot

`activeAdmins` counts Socket.IO connections whose HTTP `Origin` is `http://localhost:3000` or `http://192.168.56.1:3000`.

When `incident-reports` is applied and composite **Score \(\ge 85\)** (document 03) and **no** admin and **not** whitelist:

- `caseStatus = "Bannie (Auto-Pilote / Mode Nuit)"`
- `io.emit('execute_command', { action: "BLOCK_IP", targetIp: src_ip, sensor: "SOAR-Auto-Pilot", incidentId })`

If admins are online, the same high score leaves status `Ouvert` (unless SOAR already auto-blocked → `Bannie (Auto-Remédiation)`).

If `activeAdmins === 0`, the hub **does not** emit `soar_incident_updated`; it **emails** HTML (Nodemailer Gmail) instead. Opening the dashboard later shows Mongo state via REST.

### 2.4 LLM anti-saturation

`soar.py` `cache_alertes_soar[category]`: one Llama-bound `alerts-for-llm` per Suricata category per 60 s. ML Palier 2 uses `ips_en_cours_ia` (once per IP per process lifetime) rather than category.

Ollama timeout 120 s (`agent_ia.py`) plus Kafka buffering can still queue work; debounce only reduces **producer** rate from SOAR.

### 2.5 Other resilience

| Mechanism | Detail |
|-----------|--------|
| Idempotent DROP in SOAR | `ips_deja_bloquees` |
| Auto-block cooldown | 300 s in LSTM before another `ml-alerts` AUTO_BLOCK |
| Rule dry-run | `suricata -T` before `local.rules` append |
| Pydantic CTI | Invalid / `NOISE` articles not inserted |
| Mongo CTI dedup | `article_existe_deja(url_article)` |
| Watchdog VMs | 15 s heartbeat |
| JWT role | `role !== 'RSSI'` → 403 on guarded routes |
| Simulate route | `GET /api/simulate-attack` injects UI-only incident (not Kafka) |

---

## 3. CTI and RAG subsystem

### 3.1 Source of OSINT URLs

Mongo model `CtiSource`: `nom`, `url`, `type_source` (default `"URL"`), `actif`, `date_ajout`.

- `GET /api/cti-sources` — **active only** (`actif: true`). Called by CTI agents at `http://192.168.56.1:4000/api/cti-sources`.
- `POST /api/cti-sources` — `{ nom, url, type_source }` (unauthenticated in current hub).

V9 `agent_cti.py` handles `type_source == "RSS"` (first **3** RSS entries) and `"JSON"` (GET URL, MD5 hash of body in `url_article` for uniqueness).

V12 `agent_cti_formation.py` handles **RSS only** in the loop shown (JSON branch removed).

### 3.2 Cognitive stack

| Resource | Value |
|----------|-------|
| Generate | `POST http://192.168.56.1:11434/api/generate`, model `llama3.2:3b`, `format: json`, timeout 300 s |
| Embed | `POST http://192.168.56.1:11434/api/embeddings`, model `nomic-embed-text`, dim **768**, prompt truncated to 4000 chars |
| Mongo | `mongodb://192.168.56.1:27017/`, db `soc_dashboard`, collection `ctiactualities` |
| Historical RAG | `LocalThreatMemory(embedding_dim=768)` → `threat_intel.sqlite` + `index_faiss.bin` |
| Syntax RAG (V12) | `rag_suricata.index` + `rag_suricata.sqlite` table `rules(raw_rule)` |

### 3.3 `core_memory.py` (`LocalThreatMemory`)

Hybrid **append-only** store:

- SQLite `threat_reports(id, ioc_value UNIQUE, ioc_type, rapport_json, timestamp)`.
- FAISS `IndexFlatL2(embedding_dim)`.
- `recherche_exacte(ioc)` — SQL by `ioc_value`.
- `recherche_semantique(vector, top_k)` — L2 search; maps FAISS index \(i\) to SQLite `id = i+1` (assumes no deletes and successful inserts only).
- `sauvegarder_menace` — INSERT then `index.add` + `faiss.write_index`.

Default constructor `embedding_dim=3072` is **wrong** for `nomic-embed-text` (768). Agents **must** pass 768 (they do). Mixing dimensions corrupts the index.

### 3.4 Syntax index (`build_rule_index.py`)

- Input file `suricata.rules` (transfer from VM-Edge; **not in git**).
- Regex extracts `alert ... msg:"..." classtype:... sid:...`.
- Semantic text embedded: `"Attack Type: {classtype}. Target Protocol: {proto}. Threat Description: {msg}."`
- Batches of 500; semaphore **15** concurrent HTTP embeddings (comment: RTX 3050 4 GB).
- SQLite `rules(id, sid UNIQUE, protocol, classtype, message, raw_rule)`.
- FAISS vectors appended only when `INSERT` yields `lastrowid` (new SID).

V12 `get_reference_rules(vector, top_k=2)` returns raw rule strings for few-shot Suricata generation.

### 3.5 V9 vs V12 agent behaviour

**V9 `agent_cti.py` — `CTIActualitySchema`**

- Fields: `titre_menace`, `resume_ia`, `iocs_extraits`, `regles_suricata`, `fiabilite_score`.
- IOC cleaner strips placeholders (`N/A`, `C2-MALWARE.COM`, …).
- Rule cleaner: dict/list unwrap; `'` → `"`; empty → `N/A`.
- Mongo insert **without** `type_article` / `status` (Mongo defaults `TECHNICAL_THREAT` / `PENDING` if inserted via Mongoose later; raw pymongo insert omits `status` unless the schema default applies only on Mongoose create).
- Few-shot prompt with `sid` random in \([9000000, 9999999]\).
- Semantic history `top_k=2`.

**V12 `agent_cti_formation.py` — triage**

- Extra field `type_article`: `TECHNICAL_THREAT` | `AWARENESS`; validator **raises** on `NOISE` / advertising (article discarded).
- `PENDING_FORMATION` if AWARENESS else `PENDING`.
- `regles_suricata` forced `N/A` unless string contains `"alert "`; first line sliced from `alert `.
- Prompt instructs NOISE → `fiabilite_score: -1` (validator maps negative to reject via `ValueError("Score négatif")` only if `int` path hits `< 0` after parse — `-1` raises and filters).
- History `top_k=1` plus two Suricata reference rules.

**Production choice:** V12 is the “God’s Mode” path aligned with the Formations hub; V9 remains a simpler technical-only generator.

### 3.6 Rule CI/CD on VM-Edge (`deploy_agent.py`)

| Step | Detail |
|------|--------|
| Poll | `GET http://192.168.56.1:4000/api/rules/pending-deploy` every 10 s |
| Dry-run | Write `regles_suricata` to `/tmp/suricata_test.rules`; `suricata -T -c /etc/suricata/suricata.yaml -S /tmp/suricata_test.rules` |
| Inject | Append to `/var/lib/suricata/rules/local.rules` with comment `# [OSINT CTI AUTO-DEPLOY]` |
| Reload | `suricatasc -c reload-rules /var/lib/suricata/suricata-command.socket` |
| Feedback | `POST /api/rules/update-status` `{ rule_id: _id, status: DEPLOYED \| REJECTED, error_log }` |

Admin edit: `POST /api/rules/edit` `{ rule_id, new_rule }` → `regles_suricata` updated, `status: PENDING`, `error_log: null` (must be approved again before pending-deploy, which selects **APPROVED** only).

Status vocabulary used across UI and API: `PENDING`, `APPROVED`, `DEPLOYED`, `REJECTED`, `PENDING_FORMATION`, `FORMATION_GENERATED`.

### 3.7 Employee LMS (Gemini)

`POST /api/formations/generate` (hub, **no** JWT in code):

- Body: `rule_id`, `titre_menace`, `resume_ia`, `source_texte`.
- `rule_id` must be a valid Mongo ObjectId.
- Gemini `gemini-3.6-flash`, temperature 0.5, JSON MIME.
- Required JSON: `titre_cours`, `diagramme_mermaid`, `modules[{chapitre, contenu}]` (3 chapters specified), `quiz[{question, options[4], reponse_correcte}]` (prompt asks 5–7 questions).
- Update CTI doc: `status: FORMATION_GENERATED`, `formation_data`.

`POST /api/formations/distribute` (**JWT RSSI**):

- `targetType === "DEPARTEMENT"` + `targetValue` key in `employes.json`, else **ALL** employees.
- One HTML email per person including **`id_employe`** as LMS login and link `http://localhost:3000/formations?courseId={rule_id}`.
- `Promise.all` on Nodemailer.

`POST /api/employes/verify` — lookup ID in all departments.  
`POST /api/formations/submit` — upsert `FormationRecord` on `(courseId, employeeId)`.  
`GET /api/formations/records` — JWT; all scores newest first.

Frontend `/formations` renders Mermaid (`theme: dark`), quiz, department mailer for admins, and a lock screen for employees using `courseId` query (Next `proxy.ts` **bypasses** `soc_token` when `courseId` is present).

---

## 4. Email and night briefing

**Incident mail** (no dashboard origin): from `"SOC Automatisé" <zed.legacy.02@gmail.com>` to `zizoudh06@gmail.com`, subject `🚨 ALERTE SOC : {threatType}`, body includes IP, generation time, composite score, status, `aiSummary`.

**Daily briefing** `POST /api/briefing` JWT: `last_logout` or default last 12 h. Aggregates `SoarCase` and `CtiActuality`. Auto-blocked count: status contains `Nuit` or `Auto-Pilote` or `bloqué`. Critical: `aiConfidenceScore >= 80`. Returns `recent_incidents` slice 3. Frontend `DailyBriefingModal` uses `sessionStorage briefing_seen` and cookie `soc_token`.

---

## 5. End-to-end response state machine (caseStatus)

| Status | Set by |
|--------|--------|
| `Analyse IA (Auto-bloqué)` | Hub on `alerts-for-llm` if `auto_blocked === true` |
| `Analyse IA (Action requise)` | Hub on `alerts-for-llm` otherwise |
| `Ouvert` | After LLM if admin online, score &lt; 85 or not night, not whitelist, not already auto-blocked |
| `Bannie (Auto-Pilote / Mode Nuit)` | Night + score ≥ 85 + external IP |
| `Alerte Zero Trust (Protégée)` | Whitelist after report |
| `Bannie (Auto-Remédiation)` | Case was Auto-bloqué when report arrived |
| `En cours de blocage...` | Admin `BLOCK_IP` `send_command` |
| `IP Bannie (Résolu)` | `command_result` success |
| `Échec du Blocage` | `command_result` error |
| `Faux Positif (Ignoré)` | `IGNORE_INCIDENT` |

Simulation `simulate_alert.py` / `GET /api/simulate-attack` may insert `Ouvert` or mock IDs **without** going through Analyse IA.

---

## 6. Operator playbook (condensed)

1. Keep `soar.py`, `agent_ia.py`, and `agent_soar.py` running before generating Kali traffic.
2. Confirm whitelist IPs match running nodes; add Kali **only** if you must protect it from DROP during a dual-homed test.
3. For CTI: run `build_rule_index.py` once (long), then V12 on a schedule; approve rules in `/threat-intel`; watch `DEPLOYED` vs `REJECTED`.
4. For awareness: generate Gemini course, distribute with JWT, collect `/api/formations/records`.
5. After a DROP test: `python unblock.py <IP>` **and** restart `soar.py` (and consider cooldown 300 s in LSTM).
6. After DDoS shield tests: review and clean iptables INPUT (SYN cookies + rate-limit rules persist).

This is the complete SOAR / CTI / LMS specification as implemented in NG-IDPS.
