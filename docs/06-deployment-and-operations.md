# 06 — Deployment and Operations

This document is the **runbook** for NG-IDPS on VirtualBox Host-Only network **`192.168.56.0/24`**. Commands assume the directory layout of this repository. Substitute the Linux user `aziz` and paths (`/home/aziz/.ssh/soar_key`, `/home/aziz/dataset/`) if the laboratory accounts differ — those strings are **hardcoded** in Python.

Secrets (`EMAIL_PASS`, `GEMINI_API_KEY`, `JWT_SCRT`) live in `backend/.env` (gitignored). Copy `backend/.env.exemple` and fill values; this runbook never reprints live secrets.

---

## 1. Host setup (`192.168.56.1`)

The Host is the physical Windows machine documented in `host/doc-host.md`. It runs the dashboard, the Node hub, MongoDB, and — in the intended design — Ollama.

### 1.1 Prerequisites

- Node.js compatible with **Next 16.3** and **Express 5** (current LTS 20+ recommended).
- **MongoDB** listening on `127.0.0.1:27017` (no auth in code).
- **Ollama** installed; model pulls:

```powershell
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

- Git clone of this repository.
- Host-Only adapter with IPv4 **`192.168.56.1/24`**.
- Optional: Gmail app password and Gemini API key for LMS and night mail.

### 1.2 MongoDB

1. Install MongoDB Community as a Windows service or run `mongod`.
2. Confirm `mongodb://localhost:27017`.
3. Database **`soc_dashboard`** is created on first Mongoose connect from `server.js`.
4. No replica set is required.
5. Next.js `GET /api/status` uses the same URI (override with `MONGODB_URI` in a frontend `.env` if needed). Frontend `.gitignore` ignores `.env*`.

Collections appear after the first upserts: `vmnodes`, `soarcases`, `ctisources`, `ctiactualities`, `formationrecords`.

### 1.3 Backend hub

```powershell
cd backend
copy .env.exemple .env
# edit .env: EMAIL_PASS, GEMINI_API_KEY, JWT_SCRT
npm install
node server.js
```

Expected console:

```text
[+] Connecté à MongoDB (Hub WebSocket)
[+] Connecté au cluster Kafka (Dashboard Hub)
[+] SOC WebSocket Hub opérationnel sur le port 4000
```

If Kafka at `192.168.56.130:9092` is down, KafkaJS retries (`initialRetryTime: 3000`, `retries: 8`) then logs `[-] Erreur Kafka:`. The HTTP/WS server **still binds 4000**; telemetry, login, and simulate-attack work without Kafka. Live Suricata/LSTM incidents will not.

Firewall: allow **4000/tcp** from `192.168.56.0/24` (VM agents). Allow **3000/tcp** for operators. Allow **11434/tcp** from VMs if Ollama stays on the Host (CTI agents use `http://192.168.56.1:11434`).

### 1.4 Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` or `http://192.168.56.1:3000` (must match Socket.IO CORS). Login **`admin` / `soc`**.

Production-style:

```powershell
npm run build
npm start
```

`next.config.ts` `allowedDevOrigins: ['192.168.56.1']` is required when browsing via the Host-Only IP during `next dev`.

### 1.5 Ollama on the Host

```powershell
ollama serve
```

Default listen is often `127.0.0.1:11434`. **CTI Python on `.140` calls `192.168.56.1:11434`.** Bind Ollama to the Host-Only NIC or `0.0.0.0`, for example (environment documented by Ollama as `OLLAMA_HOST=0.0.0.0:11434` — apply the current Ollama docs for your version). Without this, V12 CTI and embeddings fail while `agent_ia.py` might still work **if** it runs on the same machine as Ollama (`localhost:11434`).

Verify:

```powershell
curl http://127.0.0.1:11434/api/tags
curl http://192.168.56.1:11434/api/tags
```

### 1.6 SMTP

Hub uses `service: 'gmail'` and a hardcoded `user`. `EMAIL_PASS` must be a Gmail **app password**. Night-mode and LMS fail closed to console `[-] Erreur envoi email` if this is wrong; detection still functions.

---

## 2. VM provisioning and startup order

Assign static Host-Only addresses **before** starting Python (they are constants, not DHCP lookups):

| VM | IP | Gateway/DNS | Role |
|----|-----|-------------|------|
| Host | 192.168.56.1 | — | Hub, UI, Mongo, Ollama |
| VM-Edge | 192.168.56.128 | typically .1 | Suricata, collector, iptables, deploy agent |
| VM-ML | 192.168.56.130 | typically .1 | Kafka, Elasticsearch (optional), LSTM, soar.py |
| VM-Response | 192.168.56.140 | typically .1 | agent_ia, agent_soar, CTI |
| Kali | any other `.0/24` address **not** in whitelist unless intended | Offensive tests |

**SSH trust:** from `.130` and `.140`, user `aziz` must log into `.128` with `/home/aziz/.ssh/soar_key` and **passwordless sudo** for `iptables` and `sysctl` (as invoked). `StrictHostKeyChecking=no` is set in code.

Copy `selected_features.json` to the working directories of `edge_collector.py` **and** `realtime_interface.py`. Copy `actifs_critiques.json` next to `soar.py` (and keep `/home/aziz/dataset/actifs_critiques.json` in sync — see §4).

Place LSTM artefacts on VM-ML beside `realtime_interface.py`:

```text
modele_deep_lstm_vae_32features/deep_lstm_vae.keras
modele_deep_lstm_vae_32features/global_scaler.pkl
modele_deep_lstm_vae_32features/metadata_modele.json
selected_features.json
actifs_critiques.json
```

If artefacts are missing, `charger_artefacts()` raises at startup.

### 2.1 Recommended global boot order

Kafka consumers use `auto_offset_reset="latest"` / hub `fromBeginning: false`. Starting consumers **before** producers is safe; starting producers first only drops messages while no consumer is in the group.

1. **Host:** MongoDB → `ollama serve` (bound for LAN) → `node server.js` → `npm run dev` (frontend).
2. **VM-ML `.130`:** Kafka broker (and Zookeeper/KRaft as installed) → optional Elasticsearch → `agent_monitor.py` → `soar.py` → `realtime_interface.py` (heavy GPU/CPU).
3. **VM-Edge `.128`:** Suricata service → Filebeat (optional) → `edge_collector.py` → `deploy_agent.py` → `agent_monitor.py`.
4. **VM-Response `.140`:** `agent_ia.py` → `agent_soar.py` → on-demand `agent_cti_formation.py`.
5. **Kali:** last, after dashboard shows three nodes (or two, if Response has no metrics agent).

If inference starts before Kafka, it retries at process level (no reconnect loop in `realtime_interface.py` `main()` except KeyboardInterrupt — **restart the process** after Kafka is up). `agent_monitor.py` and `agent_soar.py` **do** reconnect every 5 s.

### 2.2 VM-Edge `.128` — step by step

1. Install Suricata; enable `eve.json` at `/var/log/suricata/eve.json`.
2. Ensure `local.rules` path `/var/lib/suricata/rules/local.rules` (created by `deploy_agent.py` if absent).
3. Enable command socket for `suricatasc` at `/var/lib/suricata/suricata-command.socket`.
4. `systemctl start suricata` (name must match `agent_monitor.py` check `suricata`).
5. Python deps: `kafka-python`, `python-socketio`, `psutil`, `requests`.
6. Working directory containing `selected_features.json`:

```bash
python3 edge_collector.py
python3 deploy_agent.py
python3 agent_monitor.py
```

7. Confirm Kafka logs “Envoyés:” increment when traffic exists.
8. `sudo iptables -L INPUT -n` before tests (baseline).
9. Allow SSH from `.130`/`.140` with the SOAR key.

### 2.3 VM-ML `.130` — step by step

1. Install **Apache Kafka**; advertised listeners must include `192.168.56.130:9092` (hub and all producers use this, not `localhost`, except processes on the broker itself can use either if advertised correctly).
2. Create topics (auto-create may suffice depending on broker config). Names:

```text
network-features
suricata-alerts
ml-alerts
alerts-for-llm
incident-reports
```

3. Python deps: `kafka-python`, `numpy`, `joblib`, `tensorflow`/`keras`, `python-socketio`, `psutil`.
4. Start:

```bash
python3 agent_monitor.py
python3 soar.py
python3 lstm-vae/realtime_interface.py   # cwd must see modele_* and JSON contracts
```

`soar.py` paths: `CHEMIN_ACTIFS_CRITIQUES = "actifs_critiques.json"` relative to **cwd**. Start it from the directory that contains the synced whitelist.

5. Offline training (once), from `lstm-vae/` with CIC data present:

```bash
python3 feature_selector.py
python3 train_lstm_vae.py
python3 calibrate_threshold.py
```

6. Unblock helper (after tests):

```bash
python3 lstm-vae/unblock.py 192.168.56.x
```

Then **restart `soar.py`** (in-memory `ips_deja_bloquees`). LSTM cooldown is 300 s independently.

### 2.4 VM-Response `.140` — step by step

1. Python deps: `kafka-python`, `requests`, `python-socketio`, plus CTI: `aiohttp`, `feedparser`, `pydantic`, `pymongo`, `numpy`, `faiss-cpu` (or GPU), `sqlite3` (stdlib).
2. If Llama should run **here**, install Ollama on `.140` and change `agent_ia.py` `OLLAMA_URL` **or** keep Ollama on `.1` and **change `agent_ia.py` to `http://192.168.56.1:11434/api/generate`** (see §4).
3. Start:

```bash
python3 agent_ia.py
python3 agent_soar.py
```

4. CTI (after `GET /api/cti-sources` returns RSS entries):

```bash
# once, with suricata.rules in cwd (copy from edge)
python3 anticipation/build_rule_index.py
python3 anticipation/agent_cti_formation.py
```

`core_memory.py` writes `threat_intel.sqlite` and `index_faiss.bin` in **cwd**. Run agents from `anticipation/` or a fixed data directory.

### 2.5 Kali

No software from this repo. Use the VM only against PFE addresses. After attacks, expect:

- Suricata alerts in `eve.json` and Kafka `suricata-alerts`;
- feature lines on `network-features`;
- dashboard incidents;
- possible iptables DROP on `.128` for the Kali IP if it is **not** whitelisted.

---

## 3. Validation and attack simulation

### 3.1 Connectivity checklist

| Check | Method |
|-------|--------|
| Hub up | Browser `http://192.168.56.1:4000/api/incidents` → JSON array |
| Login | UI `admin` / `soc` → cookie `soc_token` |
| Mongo from Next | `http://localhost:3000/api/status` |
| Kafka | On `.130`, list topics; produce a test JSON to `network-features` if needed |
| Ollama LAN | `curl http://192.168.56.1:11434/api/tags` from `.140` |
| SSH SOAR | From `.140`: `ssh -i ~/.ssh/soar_key aziz@192.168.56.128 'echo ok'` |
| Telemetry | `/infrastructure` CPU moves; hostnames `VM-Capteur-Suricata`, `ML` |

### 3.2 Hub-only UI simulation (no Kali, no Kafka)

**A. Python Socket.IO injector** (run on Host, deps `python-socketio`):

```bash
cd backend
python simulate_alert.py
```

Connects `http://localhost:4000`, emits `new_security_alert` (SSH brute-force mock, IP `45.33.32.156`, confidence 98, status `Ouvert`). Requires **an admin dashboard connected** or the incident is stored but **not** broadcast (`activeAdmins > 0` gate). Then: siren (`GlobalAlertListener`), NotificationCenter, `/incidents` row. **Does not** call iptables or Llama.

**B. HTTP demo missile**

```text
GET http://localhost:4000/api/simulate-attack
```

Emits `soar_incident_incoming` with `_id` prefix `SIM-`, IP `185.15.59.224`, ransomware C2 story, score 99. **Not inserted into Mongo** in the handler. Use for Web Audio, overlay, and routing checks. Night-mail path is **not** exercised (no `activeAdmins` branch here — emit is unconditional).

### 3.3 End-to-end laboratory scenario (Kali)

Preconditions: full boot order; Kali IP **not** in whitelist; Suricata seeing Kali traffic; LSTM artefacts loaded.

1. Generate a **signature-friendly** event (e.g. traffic matching an enabled Suricata rule) **and/or** a volumetric/anomalous pattern (many short flows so windows of 10 fill and MSE or 80 pkt/2s burst trips).
2. On Edge: `tail -f /var/log/suricata/eve.json` shows `flow`/`alert`.
3. Collector logs `Alerte Suricata transmise` and send counters.
4. LSTM logs `MSE=... | paquets_2s=...`; possibly `AUTO-BLOCK` or `ENABLE_DDOS_SHIELD`.
5. SOAR logs Palier 1/2/3 or Zero-Trust.
6. Hub logs `[!] Alerte SOC (EXTERNE)` then `[+] Rapport reçu`.
7. UI: incoming case `Analyse IA...` then update with `titre_incident`, composite `aiConfidenceScore`.
8. If Palier 3: `iptables -L` on `.128` shows `DROP` for Kali IP.
9. If night (close all `localhost:3000` / `192.168.56.1:3000` tabs): Score ≥ 85 → Auto-Pilot `execute_command` and email.
10. Cleanup: `unblock.py`, restart `soar.py`, delete extra DDoS iptables/sysctl if shield fired, optionally restart LSTM to clear cooldowns.

### 3.4 CTI / LMS validation (no packets)

1. `POST /api/cti-sources` with a public RSS `type_source: "RSS"`.
2. Run V12; Mongo `ctiactualities` gains documents.
3. UI `/threat-intel` lists them.
4. Technical: APPROVED → `deploy_agent.py` logs Dry-Run / DEPLOYED or REJECTED.
5. Awareness: Generate formation (needs Gemini) → `/formations` Mermaid + quiz → distribute (JWT) → mailbox → open `http://localhost:3000/formations?courseId=<id>` with `id_employe` from `employes.json` (e.g. `EMP-IT-001`) → submit score → `/api/formations/records`.

### 3.5 Negative tests

| Test | Expected |
|------|----------|
| DROP toward `192.168.56.128` via SOAR | `[AUDIT] BLOCAGE REFUSÉ` |
| `alerts-for-llm` for `.128` within 3 min of external alert | Hub `CORRÉLATION] Faux Positif ignoré` |
| Malformed IP in `execute_command` | `agent_soar.py` security log, `command_result` error |
| `suricata -T` fail | Rule `REJECTED`, `error_log` populated |
| Ollama stop | `incident-reports` fallback titre `Erreur d'analyse IA` |
| Kill `agent_monitor.py` | Within 15 s UI `Hors Ligne` |

---

## 4. Known gaps and workarounds

These items were discovered in the source inventory; they are **operational facts**, not optional extras.

### 4.1 Ollama host binding

| Client | URL in code |
|--------|-------------|
| `vm-response/agent_ia.py` | `http://localhost:11434/api/generate` |
| `agent_cti.py` / `agent_cti_formation.py` / `build_rule_index.py` | `http://192.168.56.1:11434/...` |
| `host/doc-host.md` | Ollama on **HOST**, `ollama serve` |

**Workaround:** Run `agent_ia.py` on the **same OS** as Ollama, **or** patch `OLLAMA_URL` to `http://192.168.56.1:11434/api/generate`. Always set `OLLAMA_HOST` so `.140` can embed. Do not assume `localhost` on `.140` reaches the Windows Ollama.

### 4.2 Unblock vs in-memory SOAR / LSTM

`unblock.py` only runs `iptables -D`. `soar.py` keeps `ips_deja_bloquees` and `ips_en_cours_ia` in RAM. LSTM keeps `ips_deja_bloquees` cooldown **300 s**.

**Workaround:** After `unblock.py <ip>`: Ctrl+C and relaunch `soar.py`. Wait 5 minutes or restart `realtime_interface.py` if auto-block must be re-tested immediately. DDoS shield rules are **not** removed by `unblock.py`.

### 4.3 Whitelist file split brain

| Writer | Path |
|--------|------|
| Hub | `backend/actifs_critiques.json` on Windows |
| `vm-ml/agent_monitor.py` | `/home/aziz/dataset/actifs_critiques.json` |
| `soar.py` | `./actifs_critiques.json` cwd |
| LSTM | `./actifs_critiques.json` **at process start only** |

**Workaround:** Symlink or copy dataset JSON to SOAR cwd; restart LSTM after Settings changes; confirm `sync_whitelist` logs on ML monitor.

### 4.4 Environment variable separation

| Variable | Consumer | Notes |
|----------|----------|--------|
| `EMAIL_PASS` | Hub Nodemailer | Not used by Python |
| `GEMINI_API_KEY` | Hub `@google/genai` | LMS only |
| `JWT_SCRT` | Hub `jsonwebtoken` (typo `SCRT`) | Cookie is not validated with this secret in Next `proxy.ts` |
| `MONGODB_URI` | Next `mongodb.ts` only | Hub URI is **hardcoded** `localhost:27017` |
| Gmail `user` | Hardcoded in `server.js` | Not in `.env` |
| Kafka broker | Hardcoded `.130:9092` | No env |
| SSH key path | Hardcoded | No env |

**Workaround:** Treat `.env` as hub-only. Changing Mongo or Kafka requires **code** edits on each VM. Keep JWT secret stable or all cookies die (8 h max anyway).

### 4.5 Infrastructure UI service names vs agents

ML monitor checks `realtime_interface.py`, `soar.py`. UI looks for `modele_lstm.py`. Response `agent_soar.py` does not send `vm_metrics`. Placeholder IPs `.10/.20/.30` until heartbeat.

**Workaround:** Trust hostname match and CPU graphs; do not fail the defence if a service toggle stays red. Optionally align `backendName` in `infrastructure/page.tsx` with agent `SERVICES_TO_CHECK`.

### 4.6 Overview socket event `new_incident`

Hub emits `soar_incident_incoming`. Overview also subscribes to `new_incident`.

**Workaround:** Use `/incidents` and `GlobalAlertListener` for live proof. Optionally add a hub emit alias if the overview banner must flash without the global overlay.

### 4.7 `evaluate_attacks.py` metadata key

Reads `seuil_anomalie`; trainer writes `seuil_3sigma_baseline` / `seuil_optimal_calibre`.

**Workaround:** For manuscripts, run `calibrate_threshold.py` and cite that script; patch the evaluator or copy the key in `metadata_modele.json` if the PR-curve page is required.

### 4.8 `finetune.py` artefact mismatch

Uses `modele_fenetre_10_enrichi/lstm_candidate.keras`, sampling always stochastic.

**Workaround:** Do not drop those weights into `realtime_interface.py`. Fine-tune by extending `train_lstm_vae.py` / the 32-feature folder if domain adaptation is needed.

### 4.9 Feature sparsity at the edge

Many of 32 CIC features are `0.0` live (document 03). High lab MSE or odd thresholds vs Tuesday CSV are expected.

**Workaround:** Rely on burst (80/2s), flood (300/2s), and Suricata signatures for demos; use `finetune` **after** aligning code; or extend `extraire_features()` with a proper flow meter.

### 4.10 Hub API authentication gaps

Only distribute, records, and briefing verify JWT. Whitelist, rules, generate, simulate-attack are open on port 4000.

**Workaround:** Do not port-forward 4000 beyond Host-Only. For a jury network, add `verifySOCAdmin` or bind the hub to `192.168.56.1` only.

### 4.11 Login credentials in source

`admin` / `soc` are in `server.js`.

**Workaround:** Acceptable for PFE lab; change before any shared LAN. JWT still required for three routes.

### 4.12 `prompt_contexte` not stored

`agent_ia.py` sends it on Kafka; hub `SoarCase` schema has no such field; update pipeline does not copy it. `/ia-activity` cannot show the prompt from Mongo.

**Workaround:** Show `diagnostic_json` only, or add a schema field and `findOneAndUpdate` assignment.

### 4.13 `package.json` main vs `server.js`

`npm start` is not defined; `main` is `index.js` (missing).

**Workaround:** Always `node server.js`.

### 4.14 FAISS dimension default

`LocalThreatMemory()` default 3072 vs nomic 768.

**Workaround:** Never instantiate without `embedding_dim=768`. Delete mismatched `index_faiss.bin` if created with the wrong size.

### 4.15 Docs folder vs `host/doc-host.md` tree

Host doc still draws `host/frontend` and `host/backend`. Actual paths are repo-level `frontend/` and `backend/`.

**Workaround:** Follow this `/docs` suite as the deployment source of truth.

### 4.16 Simulate-attack vs Mongo

GET simulate does not `SoarCase.create`; refresh `/incidents` may **lose** the mock unless Python simulator was used (that path **does** create).

---

## 5. Steady-state operations

| Cadence | Action |
|---------|--------|
| Continuous | Suricata, Kafka, hub, LSTM, soar, agent_ia, agent_soar, two monitors, deploy_agent |
| Periodic | V12 CTI (cron); review REJECTED rules; Gemini courses |
| After each DROP test | unblock + restart soar |
| After whitelist edit | confirm file on `.130` cwd; restart LSTM |
| Disk | `eve.json` growth; FAISS/SQLite CTI; Mongo capped only by 50-item API limits (DB can grow unbounded) |
| Models | Retrain when CIC or lab traffic distribution changes; recalibrate Tuesday FPR ≤ 5% |

---

## 6. Abort and isolation

If automation misbehaves on the lab LAN:

1. Stop `soar.py` and `agent_soar.py` (stops new SSH DROP / shield).
2. `sudo iptables -F INPUT` on `.128` **only if** you understand you will also flush Suricata-unrelated policies; prefer targeted `-D` via `unblock.py`.
3. Stop `edge_collector.py` to silence Kafka.
4. Hub can remain up for forensic Mongo reads.

Kali documentation: never target addresses outside the PFE virtualisation set.

---

## 7. File map for operators

| Path | Bring-up relevance |
|------|--------------------|
| `backend/server.js` | Hub |
| `backend/.env` | Secrets |
| `backend/actifs_critiques.json` | Whitelist source of truth on Host |
| `backend/employes.json` | LMS directory |
| `backend/simulate_alert.py` | UI inject |
| `frontend/` | Dashboard |
| `vm-edge/*.py` | Sense, deploy, heartbeat |
| `vm-ml/soar.py` | Auto SOAR |
| `vm-ml/lstm-vae/realtime_interface.py` | Live ML |
| `vm-ml/lstm-vae/unblock.py` | Cleanup |
| `vm-response/agent_ia.py` | Llama JSON |
| `vm-response/agent_soar.py` | Human/Auto-Pilot DROP |
| `vm-response/anticipation/*` | CTI RAG |
| `docs/01`–`05` | Design reference |

This runbook, together with documents 01–05, is the complete operational specification of the NG-IDPS laboratory as implemented in the repository.
