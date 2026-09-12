# 01 — System Overview

**NG-IDPS** (Next-Generation Intrusion Detection and Prevention System)  
PFE — On-premise hybrid SOC for autonomous cyberdefense on VirtualBox Host-Only network `192.168.56.0/24`

---

## 1. Abstract

Contemporary enterprise and laboratory networks sit at the intersection of **IT services** (authentication, HTTP, remote administration) and **OT-like constrained segments** (isolated hypervisor networks, dedicated sensor VMs, deterministic firewalls). Signature-only Network Intrusion Detection Systems (NIDS) such as Suricata remain necessary: they encode decades of community knowledge as deterministic `alert` rules. They are not sufficient. Zero-day behaviours, encrypted or sparsely logged sessions, volumetric spoofed floods, and **lateral movement originating from trusted assets** produce either silence or a flood of uncorrelated events.

NG-IDPS addresses this gap with a **closed-loop, on-premise SOC** that fuses three independent evidence channels:

1. **Deterministic sensing** — Suricata on VM-Edge (`192.168.56.128`) tails `eve.json` and publishes both flow feature vectors and signature alerts.
2. **Unsupervised behavioural modelling** — a Deep LSTM-VAE (architecture \(64{-}32{-}16{-}32{-}64\), window size \(10\), \(32\) CIC-IDS2017-derived features) reconstructs live sequences and scores Mean Squared Error (MSE) against a calibrated threshold, augmented by burst and global-flood pre-filters.
3. **Cognitive triaging** — Llama 3.2 3B (Ollama) produces a structured JSON incident report (MITRE ATT&CK mapping, executive summary, recommended actions). Gemini (`gemini-3.6-flash`) generates employee micro-learning modules from OSINT awareness items.

A **SOAR orchestrator** (`soar.py` on `192.168.56.130`) correlates LSTM-VAE and Suricata within a 30-second window, enforces a Zero-Trust whitelist (`actifs_critiques.json`), rate-limits LLM invocations (60 s per Suricata category), and executes **iptables DROP** on VM-Edge via SSH. The Host (`192.168.56.1`) runs the Node.js WebSocket hub (port **4000**), MongoDB `soc_dashboard`, Next.js 16 dashboard (port **3000**), and—per `host/doc-host.md`—the Ollama server. A **composite threat score**

\[
\text{Score} = 0.40 \times \text{Suricata} + 0.30 \times \text{ML} + 0.30 \times \text{LLM}
\]

drives Night Auto-Pilot: when no SOC administrator is connected and \(\text{Score} \ge 85\) for a non-whitelisted IP, the hub emits `execute_command` with `action: "BLOCK_IP"`.

The laboratory is **air-gapped from production**. Kali Linux (`vm-kali`) is the sole offensive injector. All mitigation targets only Host-Only addresses in `192.168.56.0/24`.

---

## 2. Purpose and problem statement

### 2.1 Problem: modern OT/IT intrusion detection

| Failure mode | Signature NIDS alone | Pure ML anomaly detector alone |
|--------------|----------------------|--------------------------------|
| Known CVE / malware C2 | High true-positive if a rule exists | May miss if traffic reconstructs as “normal” |
| Novel or polymorphic behaviour | Miss (no SID) | Detectable via reconstruction MSE |
| Volumetric DDoS with IP spoofing | One alert per spoofed source → operator overload | LSTM-VAE per-IP buffers explode; GPU/CPU saturation |
| Collateral MSE on **critical assets** during an external flood | Alerts on `.128` / `.130` themselves | False “internal compromise” |
| Night / unattended operations | Tickets pile up | No actuation unless an orchestrator exists |
| Human-targeted phishing / MFA fatigue | Out of NIDS scope | Out of packet-feature scope |

NG-IDPS therefore treats detection as **multi-sensor fusion** and response as **policy-constrained automation**, not as a single model.

### 2.2 Purpose of this platform

- Detect **both** signature matches and behavioural anomalies on the Host-Only LAN.
- Correlate the two streams in SOAR (Palier 1 informational, Palier 2 single-source, Palier 3 dual-source).
- Produce **audit-ready JSON** diagnostics via a local LLM (no mandatory cloud path for live incidents).
- Actuate **iptables** on the edge firewall with IP regex validation and whitelist hard-stops.
- Feed a **SOC dashboard** (JWT role `RSSI`) with live WebSocket incidents, VM telemetry, CTI, and LMS.
- Close the anticipatory loop: OSINT RSS → Llama triage → Suricata rule proposal or Gemini awareness course → dry-run deploy or employee email.

### 2.3 Non-goals

- Cloud-native SIEM replacement (Elasticsearch is monitored as a process on VM-ML; Kibana URLs appear as optional fields, not as the control plane).
- Production-grade identity (login is a laboratory JWT with credentials defined in `backend/server.js`).
- Full CICFlowMeter feature parity at the edge (see document 03: many of the 32 features are zero-filled from Suricata `flow` events).

---

## 3. Technology stack

### 3.1 Host (`192.168.56.1`) — application and cognitive runtime

Documented in `host/doc-host.md`. The Host is the physical Windows machine. It does **not** inspect packets; it orchestrates humans, storage, and LLMs.

| Component | Technology (as in repository) | Role |
|-----------|-------------------------------|------|
| SOC dashboard | **Next.js 16.3.0**, **React 19.2.8**, TypeScript, Tailwind CSS 4, shadcn (`components.json` style `base-nova`), Recharts 3, Mermaid 11, Socket.IO client, jsPDF + html2canvas | Operator UI on port **3000**; `allowedDevOrigins: ['192.168.56.1']` |
| SOC hub | **Node.js** CommonJS, **Express 5.2.1**, **Socket.IO 4.8.3**, **KafkaJS 2.2.4**, **Mongoose 9**, **jsonwebtoken**, **nodemailer**, **@google/genai** | `backend/server.js` listens on port **4000**; Kafka client `soc-dashboard-hub`; group `dashboard-group` |
| Document store | **MongoDB** `mongodb://localhost:27017/soc_dashboard` | Collections implied by Mongoose models: `vmnodes`, `soarcases`, `ctisources`, `ctiactualities`, `formationrecords` |
| Local LLM | **Ollama**, model **`llama3.2:3b`**, started with `ollama serve` | Incident JSON (`agent_ia.py`) and CTI JSON (`agent_cti*.py`). CTI agents call `http://192.168.56.1:11434`. `agent_ia.py` currently calls `http://localhost:11434` (binding nuance: see document 06). |
| Embeddings | Ollama **`nomic-embed-text`**, dimension **768** | FAISS indexes in the CTI RAG path |
| Cloud pedagogue | **Google Gemini** via `@google/genai`, model **`gemini-3.6-flash`**, `responseMimeType: "application/json"` | `POST /api/formations/generate` |
| Mail | Nodemailer, `service: 'gmail'`, sender hardcoded in hub, password `EMAIL_PASS` | Night-mode incident mail; LMS distribution |
| Auth | JWT secret `JWT_SCRT` (`.env`), expiry **8 hours**, claim `role: "RSSI"` | Cookie `soc_token` on the dashboard (`frontend/src/proxy.ts`) |

**Hub CORS origins:** `http://localhost:3000`, `http://192.168.56.1:3000`.

**Hub Kafka brokers:** `['192.168.56.130:9092']` (retries: initial 3000 ms, 8 attempts).

### 3.2 VM-Edge (`192.168.56.128`) — sensing and enforcement

| Component | Role |
|-----------|------|
| **Suricata** NIDS | Writes `/var/log/suricata/eve.json`. Rules in `/var/lib/suricata/rules/local.rules`. Config `/etc/suricata/suricata.yaml`. UNIX command socket `/var/lib/suricata/suricata-command.socket`. |
| `edge_collector.py` | Tail-follow EVE; Kafka producer to `192.168.56.130:9092`; topics `network-features` and `suricata-alerts`; feature contract `selected_features.json` (`n_features: 32`). |
| `deploy_agent.py` | Polls `http://192.168.56.1:4000/api/rules/pending-deploy` every **10 s**; `suricata -T` dry-run; append rule; `suricatasc -c reload-rules`. |
| `agent_monitor.py` | Socket.IO client to `http://192.168.56.1:4000`; hostname `VM-Capteur-Suricata`; checks systemd/process **`suricata`**, **`filebeat`**. |
| **iptables** | Target of SOAR: `sudo iptables -I INPUT -s <ip> -j DROP`. DDoS shield also injects SYN cookies and rate-limit rules on TCP/80. |
| **Filebeat** | Monitored for health only in this repository (no Filebeat config in-tree). |

SSH identity used by remote actuators: user `aziz`, key `/home/aziz/.ssh/soar_key` (from VM-ML and VM-Response).

### 3.3 VM-ML (`192.168.56.130`) — streaming, learning, first-line SOAR

| Component | Role |
|-----------|------|
| **Apache Kafka** | Broker `192.168.56.130:9092`. Topics used in code: `network-features`, `suricata-alerts`, `ml-alerts`, `alerts-for-llm`, `incident-reports`. |
| **Elasticsearch** | Process watched by `vm-ml/agent_monitor.py`; not called from Python in this repo. |
| **TensorFlow / Keras** | `train_lstm_vae.py`, `realtime_interface.py`, `calibrate_threshold.py`, `evaluate_attacks.py`, `finetune.py`. Custom layers `CoucheEchantillonnage`, `CoucheVAELoss`. Artefacts directory `modele_deep_lstm_vae_32features/` (`deep_lstm_vae.keras`, `global_scaler.pkl`, `metadata_modele.json`) — **not committed**. |
| **scikit-learn** | `VarianceThreshold`, `MinMaxScaler`, `roc_curve`, `precision_recall_curve`. |
| `soar.py` | Consumer group `soar-orchestrator`; SSH mitigation toward `.128`; producer to `alerts-for-llm` and sometimes `incident-reports`. |
| `realtime_interface.py` | Consumer group `realtime-interface`; topic `network-features`; producer `ml-alerts`. |
| `agent_monitor.py` | Hostname `ML`; services `kafka`, `elasticsearch`, `realtime_interface.py`, `soar.py`; writes whitelist to `/home/aziz/dataset/actifs_critiques.json` on `sync_whitelist`. |

### 3.4 VM-Response (`192.168.56.140`) — LLM worker and human-in-the-loop actuator

| Component | Role |
|-----------|------|
| `agent_ia.py` | Kafka `alerts-for-llm` → Ollama generate (`format: json`) → `incident-reports`. Group `agent-ia-group`. |
| `agent_soar.py` | Socket.IO listener `execute_command`; IPv4 regex; SSH iptables on `.128`; emits `command_result`. Hostname `VM-Response`; services list includes `ollama` (telemetry not implemented in the same file as the command listener). |
| `anticipation/agent_cti.py` | V9 OSINT: RSS + JSON sources from `GET /api/cti-sources`; Pydantic `CTIActualitySchema`; Mongo insert. |
| `anticipation/agent_cti_formation.py` | V12 triage `TECHNICAL_THREAT` / `AWARENESS` / `NOISE`; FAISS Suricata syntax RAG (`rag_suricata.index`, `rag_suricata.sqlite`). |
| `anticipation/build_rule_index.py` | Ingests `suricata.rules` (file not in git); embeds with `nomic-embed-text`; SQLite + FAISS. Semaphore **15** concurrent embedding requests. |
| `anticipation/core_memory.py` | Class `LocalThreatMemory`: SQLite `threat_intel.sqlite` + FAISS `index_faiss.bin`. Agents instantiate with `embedding_dim=768`. |
| **FAISS** | `IndexFlatL2` exact Euclidean search. |
| **SQLite** | Rule SID store and threat-report store. |
| **Pydantic v2** | Guardrails against LLM schema drift. |
| **feedparser**, **aiohttp**, **pymongo** | RSS, HTTP, MongoDB from the VM. |

### 3.5 VM-Kali — offensive laboratory node

Folder `vm-kali/` contains only `doc-vm-kali.md`. No exploit scripts are stored in this repository. Kali’s role is to **generate controlled attack traffic** toward the other VMs so that Suricata, the LSTM-VAE, SOAR, and the dashboard can be validated. Tests must remain inside `192.168.56.0/24`.

### 3.6 Shared data contracts (JSON)

| File | Location | Content |
|------|----------|---------|
| `selected_features.json` | `vm-edge/` (copy expected on VM-ML next to the collector/model) | `"n_features": 32` and ordered feature names (CIC-IDS2017 style: Destination Port, Flow Duration, … Idle Std). |
| `actifs_critiques.json` | `backend/` and runtime copies on VM-ML | `"whitelist": ["192.168.56.128", "192.168.56.130", "192.168.56.140", "192.168.56.1"]` |
| `employes.json` | `backend/` | Departments Engineering, Finance, Direction, Sécurité, IT with `id_employe`, `nom`, `email`, `poste`. |

---

## 4. High-level functional blocks

The system is five blocks with explicit interfaces (Kafka topics, REST, Socket.IO, SSH). No block infers packets in isolation from the others except VM-Edge sensing.

### 4.1 Edge Sensing

**Where:** VM-Edge `192.168.56.128`.  
**Inputs:** Raw frames on the Host-Only NIC; Suricata rules (static + CTI-injected `local.rules`).  
**Processing:**

- Suricata emits `event_type == "flow"` and `event_type == "alert"` into `eve.json`.
- `extraire_features()` maps a flow to a 32-dimensional vector **in the exact order** of `FEATURES_ORDRE`, plus `src_ip`.
- `extraire_alerte()` maps signature, severity, category, `src_ip`.

**Outputs:**

- Kafka `network-features` — behavioural vector stream for the LSTM-VAE.
- Kafka `suricata-alerts` — deterministic alerts for SOAR.

**Side channel:** `deploy_agent.py` pulls `status: "APPROVED"` CTI rules from the hub and hot-reloads Suricata (`suricatasc reload-rules`) after a successful `suricata -T` test against `/tmp/suricata_test.rules`.

### 4.2 AI Analysis

**Where:** VM-ML `192.168.56.130`, process `realtime_interface.py`.  
**Inputs:** Kafka `network-features`; artefacts `deep_lstm_vae.keras`, `global_scaler.pkl`, `metadata_modele.json`; whitelist file `actifs_critiques.json`.  
**Processing (ordered):**

1. **Global volumetric pre-filter:** deque of packet timestamps; if more than **300** events in **2.0 s**, emit `ml-alerts` with `"action": "ENABLE_DDOS_SHIELD"` at most once every **30 s**, then **return** (no LSTM call).
2. Per-IP sliding window of length **10**; MinMax scaler clip \([0,1]\); compiled `modele(x, training=False)`.
3. \(\mathrm{MSE} = \mathrm{mean}((x - \hat{x})^2) \times 1000\).
4. Burst: ≥ **80** packets from the same `src_ip` in **2.0 s**.
5. Persistence: **3** consecutive window evaluations with MSE above threshold **or** burst → `AUTO_BLOCK_IP` on `ml-alerts` (5-minute cooldown per IP), unless `src_ip` is in `WHITELIST_IPS`.

**Outputs:** Kafka `ml-alerts` (`AUTO_BLOCK_IP` or `ENABLE_DDOS_SHIELD`).

Offline pipeline (not in the live loop): `feature_selector.py` → `train_lstm_vae.py` → `calibrate_threshold.py` (Tuesday, FPR \(\le 5\%\)) → optional `evaluate_attacks.py` / `finetune.py`.

### 4.3 LLM Cognitive Triaging

**Where:** VM-Response `agent_ia.py`; Host Gemini for LMS; VM-Response CTI agents for OSINT.  
**Inputs (incidents):** Kafka `alerts-for-llm` payloads `{src_ip, source_detection, details, auto_blocked, timestamp}`.  
**Processing:** Prompt forces a JSON object with keys `titre_incident`, `resume_executif`, `niveau_severite`, `score_confiance`, `mitre_attack_technique`, `analyse_technique`, `recommandations_actions`. Ollama `format: "json"`. Fallback JSON if parse or HTTP fails.  
**Outputs:** Kafka `incident-reports` including `diagnostic_json`, `prompt_contexte`, `duree_generation_sec`.

**CTI path:** RSS/JSON OSINT → embeddings → optional FAISS Suricata examples → Llama JSON → Pydantic → MongoDB `ctiactualities` with `type_article` and `status` `PENDING` or `PENDING_FORMATION`.

**LMS path:** Hub `POST /api/formations/generate` → Gemini → `formation_data` (modules, Mermaid, quiz) stored on the same CTI document, `status: "FORMATION_GENERATED"`.

### 4.4 SOAR Mitigation

**Where:** `vm-ml/soar.py` (automated), `vm-response/agent_soar.py` (dashboard-driven), `backend/server.js` (Night Auto-Pilot and correlation muting).

**`soar.py` decision layers:**

- Reload whitelist from `actifs_critiques.json` **on every Kafka record**.
- If `src_ip` ∈ whitelist → **no iptables DROP**; one-shot `incident-reports` Zero-Trust bypass (Fail-Open continuity); software lock in `ips_deja_bloquees`.
- Palier 3: ML and Suricata timestamps for the same IP differ by \(\le 30\) s → `bloquer_ip` then `notifier_agent_ia(..., auto_blocked=True)`.
- Palier 2 ML-only: notify LLM if IP not already in `ips_en_cours_ia`.
- Palier 2 Suricata `severity <= 2`: same, with **category debounce 60 s** (`COOLDOWN_LLM_SEC`).
- Palier 1 Suricata `severity > 2`: log only.
- `ENABLE_DDOS_SHIELD`: SSH three commands (tcp_syncookies, iptables limit 100/s burst 150 ACCEPT then DROP syn dport 80).

**Hub Auto-Pilot:** `activeAdmins === 0` ∧ composite score \(\ge 85\) ∧ IP not whitelisted → `io.emit('execute_command', { action: "BLOCK_IP", targetIp, sensor: "SOAR-Auto-Pilot", incidentId })`.  
**Human path:** dashboard `send_command` → hub rebroadcast `execute_command` → `agent_soar.py` SSH DROP → `command_result`.

IP validation: regex `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$` (`soar.py`) and equivalent compiled pattern in `agent_soar.py`.

### 4.5 SOC Visualization

**Where:** Next.js App Router under `frontend/src/app/`.  
**Inputs:** REST `http://<hostname>:4000/api/*`; Socket.IO same origin host port 4000.  
**Surfaces:**

| Route | Function |
|-------|----------|
| `/login` | JWT login; sets cookie `soc_token` (max-age 28800) |
| `/` | KPIs, Recharts area/pie, Daily Briefing modal, `alert.mp3` |
| `/infrastructure` | Three-node telemetry; event `dashboard_update` |
| `/incidents` | SOAR case list, BLOCK/IGNORE, jsPDF export |
| `/threat-intel` | CTI feed, rule approve/edit, Gemini generate |
| `/formations` | LMS; public if `?courseId=` (proxy exception) |
| `/ia-activity` | LLM JSON cards, generation latency |
| `/settings` | Whitelist CRUD + `sync_whitelist` |

**Global UX:** `GlobalAlertListener` (Web Audio square-wave siren on `soar_incident_incoming`), `NotificationCenter`, Sidebar open-incident badge.  
**Watchdog:** hub `setInterval` 15 s marks VMs `Hors Ligne` if `lastHeartbeat` older than 15 s.

---

## 5. Kafka topic catalogue (canonical)

| Topic | Producer | Consumer | Payload intent |
|-------|----------|----------|----------------|
| `network-features` | `edge_collector.py` | `realtime_interface.py` (group `realtime-interface`) | 32 features + `src_ip` |
| `suricata-alerts` | `edge_collector.py` | `soar.py` (group `soar-orchestrator`) | `source`, `src_ip`, `signature`, `severity`, `category`, `timestamp` |
| `ml-alerts` | `realtime_interface.py` | `soar.py` | `AUTO_BLOCK_IP` or `ENABLE_DDOS_SHIELD` |
| `alerts-for-llm` | `soar.py`; hub also **subscribes** | `agent_ia.py` (group `agent-ia-group`); hub group `dashboard-group` | Pending or auto-blocked context |
| `incident-reports` | `agent_ia.py`; Zero-Trust bypass in `soar.py` | Hub `dashboard-group` | `diagnostic_json` or emergency `diagnostic` string |

Hub subscriptions in `startKafkaConsumer()`: **`alerts-for-llm`** and **`incident-reports`** only (`fromBeginning: false`).

---

## 6. Trust, safety, and laboratory ethics

- **Scope:** Host-Only `192.168.56.0/24`. Kali documentation forbids targeting hosts outside the PFE laboratory.
- **Fail-open on critical IPs:** whitelist members are never DROP’d by `bloquer_ip()`; the hub refuses Auto-Pilot DROP for those IPs and labels `Alerte Zero Trust (Protégée)`.
- **Fail-closed on malformed IPs:** regex rejection before SSH.
- **Human override:** `IGNORE_INCIDENT` sets `Faux Positif (Ignoré)`. `unblock.py` deletes iptables rules but **does not** clear `soar.py` RAM sets (restart required).
- **Secrets:** `backend/.env` holds `EMAIL_PASS`, `GEMINI_API_KEY`, `JWT_SCRT`. File is gitignored; `.env.exemple` is the template. This documentation does not reproduce secret values.

---

## 7. Document map

| File | Content |
|------|---------|
| [02-architecture-and-dataflow.md](./02-architecture-and-dataflow.md) | IP plan, packet lifecycle, Mermaid sequence |
| [03-ml-and-detection-engine.md](./03-ml-and-detection-engine.md) | 32 features, LSTM-VAE, thresholds, composite score |
| [04-soar-cti-and-response.md](./04-soar-cti-and-response.md) | SOAR, Zero-Trust, Night mode, CTI RAG, LMS |
| [05-api-and-dashboard.md](./05-api-and-dashboard.md) | REST, WebSocket, JWT, MongoDB, Next.js routes |
| [06-deployment-and-operations.md](./06-deployment-and-operations.md) | Boot order, simulation, known gaps |

---

## 8. References to source of truth

All numerical constants in this suite are taken from the repository files cited (e.g. `POIDS_SURICATA = 0.4` in `backend/server.js`; `SEUIL_SPAM_PAQUETS = 80` in `vm-ml/lstm-vae/realtime_interface.py`; `FENETRE_CORRELATION_SEC = 30` in `vm-ml/soar.py`). Where the UI placeholder IPs (`192.168.56.10` / `.20` / `.30` in `infrastructure/page.tsx`) disagree with agent-reported addresses (`.128` / `.130` / `.140`), the **agent and whitelist files are authoritative**; the UI overwrites displayed IP from MongoDB `ipAddress` after the first heartbeat.
