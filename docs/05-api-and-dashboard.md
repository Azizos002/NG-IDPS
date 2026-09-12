# 05 — API and Dashboard

This document is the interface contract for the **SOC hub** (`backend/server.js`, TCP **4000**) and the **Next.js 16.3** dashboard (`frontend/`, TCP **3000**). MongoDB database name is **`soc_dashboard`**. All dashboard fetches use `http://${window.location.hostname}:4000` so a browser opened at `http://192.168.56.1:3000` talks to `http://192.168.56.1:4000`.

---

## 1. Backend hub (`server.js`)

### 1.1 Runtime

| Item | Value |
|------|-------|
| Package name | `websocket-hub` (`backend/package.json`) |
| Entry | `server.js` (package.json `main` still says `index.js` — **start the file explicitly**: `node server.js`) |
| HTTP + WS | `http.createServer(app)` + `socket.io` `Server` |
| Listen | `PORT = 4000` |
| Express | `cors()`, `express.json()` |
| KafkaJS clientId | `soc-dashboard-hub` |
| Kafka brokers | `192.168.56.130:9092` |
| Kafka group | `dashboard-group` |
| Kafka topics | `alerts-for-llm`, `incident-reports` |
| Mongo URI | `mongodb://localhost:27017/soc_dashboard` |
| Socket.IO CORS origin | `http://localhost:3000`, `http://192.168.56.1:3000` |
| Socket.IO methods listed | `GET`, `POST`, `DELETE` |
| Env | `dotenv`: `GEMINI_API_KEY`, `JWT_SCRT`, `EMAIL_PASS` |
| Gemini | `GoogleGenAI` model `gemini-3.6-flash` |
| SMTP | `nodemailer` `service: 'gmail'`, user hardcoded in source |

### 1.2 JWT authentication

**Login** `POST /api/login`

Request: `{ "username": string, "password": string }`.

Laboratory principal (hardcoded):

```javascript
{ id: "ADMIN-001", username: "admin", password: "soc", role: "RSSI", name: "Administrateur SOC" }
```

Success `200`:

```json
{
  "success": true,
  "token": "<jwt>",
  "user": { "name": "Administrateur SOC", "role": "RSSI" }
}
```

JWT payload: `{ id, username, role }`, secret `process.env.JWT_SCRT`, `expiresIn: '8h'`.

Failure `401`: `{ success: false, error: "Identifiants SOC invalides." }`.

**Middleware `verifySOCAdmin`**

- Header `Authorization: Bearer <token>` required; else `401` missing token.
- `jwt.verify`; else `401` invalid/expired.
- `decoded.role !== 'RSSI'` → `403` insufficient privilege.
- Sets `req.user = decoded`.

**Routes that use `verifySOCAdmin`:**

- `POST /api/formations/distribute`
- `GET /api/formations/records`
- `POST /api/briefing`

All other `/api/*` routes on the hub are **unauthenticated** in the present source (including whitelist mutation, rule status, Gemini generate, employee verify, simulate-attack). Network isolation of `192.168.56.0/24` is the laboratory compensating control.

### 1.3 MongoDB collections (Mongoose)

Mongoose lowercases and pluralizes model names unless overridden. Expected collection names:

| Model | Schema highlights | Typical collection |
|-------|-------------------|--------------------|
| `VmNode` | `hostname` unique; `ipAddress`, `os`, `cpuUsage`, `ramUsage`, `services` Array, `lastHeartbeat`, `nodeStatus`; `{ strict: false }` | `vmnodes` |
| `SoarCase` | `kibanaUrl`, `sourceSensor`, `maliciousIp`, `threatType`, `severity`, `aiSummary`, `diagnostic_json` Object, `aiConfidenceScore`, `duree_generation_sec`, `caseStatus` default `"Ouvert"`, `timestamp` | `soarcases` |
| `CtiSource` | `nom`, `url`, `type_source` default `"URL"`, `actif` default true, `date_ajout` | `ctisources` |
| `CtiActuality` | `titre_menace`, `source_osint`, `url_article`, `resume_ia`, `type_article` default `TECHNICAL_THREAT`, `iocs_extraits` Array, `regles_suricata`, `fiabilite_score`, `status` default `PENDING`, `error_log`, `formation_data`, `last_updated`, `date_publication` | `ctiactualities` |
| `FormationRecord` | `courseId`, `courseTitle`, `employeeId`, `employeeName`, `department`, `score`, `completedAt` | `formationrecords` |

**Frontend-only models** `frontend/src/lib/models/SoarCase.ts` and `VmNode.ts` define stricter enums (`severity` Basse/Moyenne/…, `aiConfidence` vs `aiConfidenceScore`, nested `actions[]`). They are **not** used by the hub. Next.js `connectDB` is used only by `GET /api/status`. Treat **`server.js` schemas as production**.

### 1.4 REST routes (complete)

Base URL: `http://192.168.56.1:4000` or `http://localhost:4000`.

#### Authentication

| Method | Path | Auth | Body / query | Success body |
|--------|------|------|--------------|--------------|
| POST | `/api/login` | No | `{ username, password }` | `{ success, token, user }` |

#### CTI sources and feed

| Method | Path | Auth | Body | Success |
|--------|------|------|------|---------|
| GET | `/api/cti-sources` | No | — | Array of `{ _id, nom, url, type_source, actif, ... }` with `actif: true` |
| POST | `/api/cti-sources` | No | `{ nom, url, type_source? }` | `{ success: true, source }` ; `400` if missing nom/url |
| GET | `/api/cti-actualities` | No | — | Up to **50** documents, `date_publication` descending |

#### Incidents and infrastructure

| Method | Path | Auth | Success |
|--------|------|------|---------|
| GET | `/api/incidents` | No | Up to **50** `SoarCase`, `timestamp` descending |
| GET | `/api/vms` | No | All `VmNode` |

#### Whitelist (file `backend/actifs_critiques.json`)

`getWhitelistData()` reads `{ whitelist: string[] }` or `{ actifs_critiques: string[] }`; on error defaults to `.128`, `.130`, `.140`, `.1`.

| Method | Path | Auth | Body | Side effect |
|--------|------|------|------|-------------|
| GET | `/api/whitelist` | No | — | `{ whitelist: string[] }` |
| POST | `/api/whitelist` | No | `{ ip }` | Append if new; `io.emit('sync_whitelist', list)` |
| DELETE | `/api/whitelist` | No | `{ ip }` | Filter out; emit `sync_whitelist` |

`400` if `ip` missing.

#### Suricata rule workflow

| Method | Path | Auth | Body | Behaviour |
|--------|------|------|------|-----------|
| POST | `/api/rules/update-status` | No | `{ rule_id, status, error_log? }` | `CtiActuality.findByIdAndUpdate`; `{ message, new_status }` |
| POST | `/api/rules/edit` | No | `{ rule_id, new_rule }` | Sets `regles_suricata`, `status: PENDING`, clears `error_log` |
| GET | `/api/rules/pending-deploy` | No | — | `{ count, rules }` where `status === "APPROVED"` |

#### Formations and employees

| Method | Path | Auth | Body | Behaviour |
|--------|------|------|------|-----------|
| POST | `/api/formations/generate` | No | `{ rule_id, titre_menace, resume_ia, source_texte? }` | Gemini JSON → `formation_data`, `FORMATION_GENERATED` |
| GET | `/api/employes` | No | — | Parsed `employes.json` object keyed by department |
| POST | `/api/formations/distribute` | JWT RSSI | `{ rule_id, formation_data, targetType, targetValue }` | Per-employee Gmail; `{ message, count }` |
| POST | `/api/employes/verify` | No | `{ id_employe }` | `{ success, employe }` or `401` |
| POST | `/api/formations/submit` | No | `{ courseId, courseTitle, employeeId, employeeName, department, score }` | Upsert `FormationRecord` |
| GET | `/api/formations/records` | JWT RSSI | — | All records, `completedAt` descending |

Gemini errors: `500` `{ error, details }`. Invalid ObjectId: `400`.

#### Briefing and laboratory simulation

| Method | Path | Auth | Body | Behaviour |
|--------|------|------|------|-----------|
| POST | `/api/briefing` | JWT RSSI | `{ last_logout? }` ISO date | See §1.5 |
| GET | `/api/simulate-attack` | No | — | Builds mock incident `_id: "SIM-..."`, `maliciousIp: "185.15.59.224"`, ransomware narrative, `io.emit("soar_incident_incoming")`, `{ success, message }` — **not written to Mongo** in this handler |

#### Briefing JSON (`POST /api/briefing`)

```json
{
  "success": true,
  "since": "<ISO>",
  "summary": {
    "total_incidents": 0,
    "auto_blocked": 0,
    "critical_alerts": 0,
    "new_cti": 0,
    "new_formations": 0
  },
  "recent_incidents": [ ]
}
```

`since` = `last_logout` or `now - 12h`.  
`auto_blocked`: `caseStatus` includes `Nuit` **or** `Auto-Pilote` **or** `bloqué`.  
`critical_alerts`: `aiConfidenceScore >= 80`.  
`new_formations`: CTI with `status === 'FORMATION_GENERATED'`.  
`recent_incidents`: first 3 of the period, newest first.

### 1.5 Kafka consumption (hub)

See [02-architecture-and-dataflow.md](./02-architecture-and-dataflow.md) stages F. Composite score: [03-ml-and-detection-engine.md](./03-ml-and-detection-engine.md) §4.

`SoarCase.create` on `alerts-for-llm`:

```javascript
{
  sourceSensor: payload.source_detection || "Multi-Source",
  maliciousIp: payload.src_ip,
  threatType: auto_blocked ? "Menace Critique (Bloquée)" : "Menace Suspecte (À vérifier)",
  aiSummary: "⏳ L'Agent IA (Llama 3) analyse actuellement les paquets. Veuillez patienter...",
  aiConfidenceScore: 0,
  caseStatus: auto_blocked ? "Analyse IA (Auto-bloqué)" : "Analyse IA (Action requise)",
  timestamp: new Date()
}
```

Night Auto-Pilot emit:

```javascript
{
  action: "BLOCK_IP",
  targetIp: payload.src_ip,
  sensor: "SOAR-Auto-Pilot",
  incidentId: existingIncident._id
}
```

### 1.6 WebSocket event schemas

Connection: Engine.IO default path `/socket.io/` on port 4000.

**Admin detection:** `socket.handshake.headers.origin` ∈ `{ http://localhost:3000, http://192.168.56.1:3000 }`.

#### `vm_metrics` (agent → hub)

```json
{
  "hostname": "VM-Capteur-Suricata | ML",
  "ipAddress": "192.168.56.128 | 192.168.56.130",
  "os": "Linux",
  "cpuUsage": 0,
  "ramUsage": 0,
  "services": [ { "name": "suricata", "active": true } ]
}
```

Hub upserts by `hostname`, sets `lastHeartbeat`, `nodeStatus: 'Online'`, broadcasts `dashboard_update` with the Mongo document (`strict: false` preserves extra keys).

#### `new_security_alert` (simulator → hub)

Example from `simulate_alert.py`:

```json
{
  "kibanaUrl": "http://192.168.1.20:5601/app/discover#/view/...",
  "sourceSensor": "Suricata (NIDS)",
  "maliciousIp": "45.33.32.156",
  "threatType": "Brute Force SSH",
  "severity": "Critique",
  "aiSummary": "...",
  "aiConfidenceScore": 98,
  "caseStatus": "Ouvert"
}
```

Persisted; `soar_incident_incoming` **only if** `activeAdmins > 0`.

#### `send_command` (dashboard → hub)

```json
{
  "action": "BLOCK_IP",
  "targetIp": "x.x.x.x",
  "incidentId": "<ObjectId>",
  "sensor": "<optional string>"
}
```

or `{ "action": "IGNORE_INCIDENT", "incidentId": "..." }`.

Hub always `io.emit('execute_command', commandData)` (IGNORE still broadcasts; `agent_soar.py` only acts on `BLOCK_IP`).

BLOCK updates status `En cours de blocage...` and `soar_incident_updated`.  
IGNORE sets `Faux Positif (Ignoré)`.

#### `command_result` (agent_soar → hub)

```json
{ "incidentId": "<id>", "ip": "<ip>", "status": "success | error" }
```

Maps to `IP Bannie (Résolu)` or `Échec du Blocage`.

#### `soar_incident_incoming` / `soar_incident_updated` (hub → UI)

Full Mongoose document: `_id`, `maliciousIp`, `threatType`, `caseStatus`, `aiSummary`, `diagnostic_json`, `aiConfidenceScore`, `duree_generation_sec`, `sourceSensor`, `timestamp`, etc.

`diagnostic_json` shape (Llama / bypass):

```json
{
  "titre_incident": "string",
  "resume_executif": "string",
  "niveau_severite": "Critique | Elevé | Moyen | Faible | ...",
  "score_confiance": 0,
  "mitre_attack_technique": "Txxxx - ...",
  "analyse_technique": "string",
  "recommandations_actions": [ "string" ]
}
```

#### `execute_command` (hub → VM-Response)

Same object as `send_command` or Auto-Pilot payload above.

#### `sync_whitelist` (hub → VM-ML monitor)

JSON array of IP strings, e.g. `["192.168.56.128","192.168.56.130","192.168.56.140","192.168.56.1"]`.

#### `dashboard_update` (hub → UI)

`VmNode` after metrics upsert or watchdog offline transition (`cpuUsage: 0`, `ramUsage: 0`, services `active: false`).

Watchdog interval **15 000 ms**; threshold **15 s** since `lastHeartbeat`.

---

## 2. Frontend UI (Next.js 16)

### 2.1 Tooling

| Item | Value |
|------|-------|
| `package.json` name | `dashboard` |
| Scripts | `next dev`, `next build`, `next start`, `eslint` |
| UI | Tailwind 4, `@base-ui/react`, CVA, lucide-react, shadcn `base-nova` |
| Charts | `recharts` 3.10 |
| Diagrams | `mermaid` 11.17 |
| PDF | `jspdf` + `html2canvas` |
| Realtime | `socket.io-client` 4.8 |
| Auth cookie | `soc_token`, `path=/`, `max-age=28800`, `samesite=strict` |
| LocalStorage | `soc_user` JSON `{ name, role }`; `soc_last_logout` ISO |
| SessionStorage | `briefing_seen` |
| `next.config.ts` | `allowedDevOrigins: ['192.168.56.1']` |
| Font | Google Inter via `next/font` |
| Theme | `bg-slate-950` / `#070B14` login |

`AGENTS.md` warns that Next 16 APIs may differ from older training data; `src/proxy.ts` exports **`proxy`** (not the historical `middleware` filename).

### 2.2 Route protection (`src/proxy.ts`)

Matcher excludes `api`, `_next/static`, `_next/image`, `favicon.ico`, `noise.png`.

| Condition | Result |
|-----------|--------|
| Path `/formations` **and** query `courseId` | `NextResponse.next()` (employee LMS, no cookie) |
| Path starts `/login` **and** cookie `soc_token` | Redirect `/` |
| Path not `/login` **and** no cookie | Redirect `/login` |
| Else | next |

JWT is **not** verified in the proxy (presence of cookie only). Hub JWT checks apply only to the three guarded APIs.

### 2.3 App Router pages

Layout (`src/app/layout.tsx`): title `SOC Dashboard | Cyberdéfense Active`; wraps `MainLayout` + `GlobalAlertListener`.  
`MainLayout`: if pathname `/login`, full-screen children; else Sidebar `w-64` + `main ml-64 p-8`.

#### `GET /login` — `src/app/login/page.tsx`

Form POST hub `/api/login`. On success: set cookie `soc_token`, `localStorage.soc_user`, `router.push("/")`. Errors: invalid credentials or “Serveur SOC injoignable.”

#### `GET /` — `src/app/page.tsx` (Vue d’ensemble)

- Fetches `/api/incidents` and `/api/vms`.
- KPIs: total incidents, `activeNodesCount` as `"n / 3"`, global status string (`SÉCURISÉ` vs alerting colours), mean `aiConfidenceScore`.
- Recharts **AreaChart**: weekly buckets `suricata` vs `ml_ia` (derived from incident `sourceSensor` strings).
- Recharts **PieChart**: threat type distribution, colours `#f59e0b #ef4444 #06b6d4 #8b5cf6 #10b981 #ec4899`.
- `DailyBriefingModal` on first session.
- Alert UX: `new Audio('/alert.mp3')` (file `frontend/public/alert.mp3`), document.title blink `🚨 ALERTE CRITIQUE 🚨`.
- Socket: `dashboard_update` refetches; also `new_incident` (hub never emits this name — live banner should be driven by `soar_incident_incoming` via `GlobalAlertListener` / other pages).

#### `GET /infrastructure` — `src/app/infrastructure/page.tsx`

Three cards, **hostname keys** must match agents:

| hostname | Initial placeholder IP | Agent real IP | Services (`backendName`) |
|----------|------------------------|---------------|---------------------------|
| `VM-Capteur-Suricata` | `192.168.56.10` | `192.168.56.128` | `suricata`, `filebeat` |
| `ML` | `192.168.56.20` | `192.168.56.130` | `kafka`, `elasticsearch`, `modele_lstm.py` |
| `VM-Response` | `192.168.56.30` | `192.168.56.140` | `ollama`, `agent_soar.py` |

After `/api/vms` or `dashboard_update`, `ip` is replaced by `knownVm.ipAddress`.

**Service matching gap:** ML agent reports `realtime_interface.py` and `soar.py`, not `modele_lstm.py`. Response agent `agent_soar.py` does not emit `vm_metrics` in-repo; Ollama activity may stay grey unless another monitor is added. CPU/RAM **LineChart** (`historyData`) appends points from live updates.

#### `GET /incidents` — `src/app/incidents/page.tsx`

- Hydrate `/api/incidents`; sockets `soar_incident_incoming`, `soar_incident_updated`.
- Filters, severity badges, GeoIP heuristic (e.g. `192.168.56*` → interne LAN).
- Actions: `socket.emit('send_command', { action: 'BLOCK_IP', targetIp, incidentId })` or `IGNORE_INCIDENT`.
- Expand `diagnostic_json` (MITRE, recommendations).
- **PDF:** `html2canvas` + `jsPDF` of the incident view.

#### `GET /threat-intel` — `src/app/threat-intel/page.tsx`

- `/api/cti-actualities`, `/api/cti-sources`.
- Add source POST `{ nom, url }` (type optional).
- Filters: status `ALL|PENDING|DEPLOYED|AWARENESS`; category `ALL|CVE|MALWARE|PHISHING|NEWS`; search.
- Approve → `POST /api/rules/update-status` `APPROVED`.
- Edit Suricata line → `/api/rules/edit`.
- Awareness → `/api/formations/generate` then link to `/formations`.

#### `GET /formations` — `src/app/formations/page.tsx`

- Admin: list `FORMATION_GENERATED`, Mermaid renderer (`mermaid.initialize({ theme: 'dark' })`), quiz, department/all distribute with **Bearer token from cookie**.
- Employee: `courseId` query; ID gate via `/api/employes/verify`; submit `/api/formations/submit`.
- Optional records table via `/api/formations/records`.

#### `GET /ia-activity` — `src/app/ia-activity/page.tsx`

- Incidents with `diagnostic_json` / `duree_generation_sec`.
- Socket `soar_incident_updated` prepends completed analyses.
- Expandable JSON / prompt fields when present on the document (prompt is on Kafka payload; **hub does not persist `prompt_contexte`** on `SoarCase` — UI may show N/A unless added later).

#### `GET /settings` — `src/app/settings/page.tsx`

- GET/POST/DELETE `/api/whitelist`.
- Local validation messages; Socket.IO client constructed (sync is server-push to agents more than to this page).

#### `GET /api/status` — `src/app/api/status/route.ts` (Next server)

`connectDB()` then `{ connected: mongoose.connection.readyState === 1, message }`. URI `process.env.MONGODB_URI || mongodb://localhost:27017/soc_dashboard`.

### 2.4 Shared components

#### `Sidebar.tsx`

Menu: `/`, `/infrastructure`, `/incidents`, `/threat-intel`, `/formations`, `/ia-activity`, `/settings`.  
Open-incident badge: status **not** containing `Bannie`, `Résolu`, `Faux Positif`, `Ignoré`.  
Logout: `soc_last_logout = now`, clear `briefing_seen`, `soc_user`, expire `soc_token`, `router.push('/login')`. Hidden on `/login`.

#### `NotificationCenter.tsx`

Bell panel; `soar_incident_incoming` → unread stack; mark-all-read.

#### `GlobalAlertListener.tsx`

Mounted globally. On `soar_incident_incoming`: Web Audio **square** oscillator alternating ~987.77 Hz / 739.99 Hz, gain 0.15, ~0.9 s (not `alert.mp3`). Overlay cards with IP, type, sensor, severity from `diagnostic_json.niveau_severite` or `severity`. Dismiss per card. Hidden logically on login because incidents should not arrive unauthenticated, but the component **still connects** Socket.IO on every page including login.

#### `DailyBriefingModal.tsx`

`POST /api/briefing` with `Authorization: Bearer` from `soc_token` cookie and `last_logout`. Sets `briefing_seen`. Displays summary counters and up to three incidents.

#### `ui/button.tsx`

shadcn/Base UI `Button` + `buttonVariants` (default, outline, secondary, ghost, destructive, link).

### 2.5 Static assets (`frontend/public/`)

| File | Use |
|------|-----|
| `alert.mp3` | Overview page `Audio` |
| `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | Unused by SOC pages (create-next-app leftovers) |
| `src/app/favicon.ico` | Browser tab |

---

## 3. Cross-cutting UI ↔ API map

| User action | Transport | Hub handler |
|-------------|-----------|-------------|
| Login | REST POST `/api/login` | JWT issue |
| Open dashboard | REST GET `/api/incidents`, `/api/vms` | Mongo |
| Live incident | WS `soar_incident_*` | Kafka + create/update |
| Block IP | WS `send_command` | `execute_command` + pending status |
| Ignore | WS `send_command` IGNORE | status only |
| Edit whitelist | REST POST/DELETE `/api/whitelist` | file + `sync_whitelist` |
| Approve rule | REST POST `/api/rules/update-status` | Mongo status |
| Generate course | REST POST `/api/formations/generate` | Gemini |
| Mail course | REST POST `/api/formations/distribute` | JWT + SMTP |
| Employee quiz | REST POST `/api/formations/submit` | upsert |
| Demo missile | GET `/api/simulate-attack` or Python `simulate_alert.py` | WS emit |

---

## 4. CORS and mixed-content notes

Socket.IO and REST are **HTTP** on the laboratory LAN. The Next origin must be one of the two CORS origins or browsers will block the hub. Opening the UI as `http://127.0.0.1:3000` is **not** in the CORS list (only `localhost` and `192.168.56.1`). `allowedDevOrigins` additionally allows the Host IP to use Next’s dev resources.

This document enumerates every hub route, every Socket.IO event implemented in-tree, and every App Router page under `frontend/src/app`.
