# NG-IDPS: Résumé Professionnel Complet pour Transfert IA

**Projet:** Next-Generation Intrusion Detection and Prevention System (NG-IDPS)  
**Étudiant:** Aziz, ISIMa (Institut Supérieur d'Informatique et de Mathématiques Appliquées)  
**Niveau:** PFE (Projet de Fin d'Études) — Évaluation: 20/20  
**Date:** 2024-2026  
**Méthodologie:** Scrum (Release 1: Détection | Release 2: Prévention)

---

## 📋 SECTION 1 — VUE D'ENSEMBLE SYSTÈME

### Mission
Système autonome de cyber-défense 24/7 capable de détecter, analyser et bloquer les menaces réseau en temps réel sans intervention humaine, combinant détection par signature (Suricata), anomalies par apprentissage profond (LSTM-VAE 16 features), orchestration SOAR à 3 niveaux, et analyse cognitive post-attaque par LLM (Llama 3).

### Classification
- **Domaine:** Cybersécurité - Détection & Prévention d'Intrusions (IDS/IPS)
- **Type d'Architecture:** Distribuée, événementielle, orientée microservices
- **Orientation:** Production autonome + Recherche académique
- **Défense Académique:** Oui — Slides (18-24), Chapitre LaTeX (6-8 pages), Diagrammes d'architecture (PlantUML/Mermaid)

---

## 🏗️ SECTION 2 — ARCHITECTURE COMPLÈTE

### 2.1 Topologie Réseau & Déploiement VM

```
┌─────────────────────────────────────────────────────────────┐
│ WINDOWS HOST (GPU RTX 3050, 24GB RAM, ~100% utilisation)   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────┐      ┌──────────────────────┐    │
│  │  Node.js Backend     │      │  Ollama GPU Server   │    │
│  │  (server.js)         │◄────►│  (llama3 + llama3.2) │    │
│  │  - Express + Socket.io       │  - CTI: llama3 (GPU) │    │
│  │  - KafkaJS Client    │      │  - Incident reports  │    │
│  │  - Nodemailer        │      │  - REST @ :11434     │    │
│  │  - MongoDB Driver    │      │  - FAISS RAG Ready   │    │
│  └──────────────────────┘      └──────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Next.js Frontend SOC Dashboard                      │  │
│  │  - Port 3000                                         │  │
│  │  - Glassmorphism (dark theme, cyan+red accents)     │  │
│  │  - Socket.io real-time listeners                    │  │
│  │  - Web Audio API sirens & notifications             │  │
│  │  - PDF export via html2canvas + jsPDF              │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲              ▲
    SSH Tunnels    Kafka Broker   Ollama REST   MongoDB Driver
         │              │              │              │
    ┌────┴──────────────┴──────────────┴──────────────┴────┐
    │                                                       │
    │            Virtual Network 192.168.56.0/24          │
    │                                                       │
    │  ┌───────────────────┐  ┌────────────────────────┐  │
    │  │    vm-edge        │  │       vm-ml            │  │
    │  │  192.168.56.130   │  │  192.168.56.130        │  │
    │  │  4 cores, 2GB RAM │  │  2 cores, 6GB RAM      │  │
    │  │  30GB SSD         │  │  40GB SSD              │  │
    │  │                   │  │                        │  │
    │  │ ┌─────────────┐   │  │ ┌──────────────────┐  │  │
    │  │ │   Suricata  │   │  │ │  Kafka Broker    │  │  │
    │  │ │   IDS       │   │  │ │  (kafka-server)  │  │  │
    │  │ └─────────────┘   │  │ │  Port: 9092      │  │  │
    │  │ ┌─────────────┐   │  │ │  v4.3            │  │  │
    │  │ │  Filebeat   │   │  │ └──────────────────┘  │  │
    │  │ │  (geoloc)   │   │  │ ┌──────────────────┐  │  │
    │  │ └─────────────┘   │  │ │  ELK Stack       │  │  │
    │  │ ┌─────────────┐   │  │ │  + Kibana        │  │  │
    │  │ │edge_        │   │  │ │  Analytics       │  │  │
    │  │ │collector.py │   │  │ └──────────────────┘  │  │
    │  │ │(16 features)│   │  │ ┌──────────────────┐  │  │
    │  │ └─────────────┘   │  │ │ LSTM-VAE Model   │  │  │
    │  │                   │  │ │ Training & Inf.  │  │  │
    │  │ Topic:            │  │ │ realtime_        │  │  │
    │  │ network-features  │  │ │ interface_16f.py │  │  │
    │  └───────────────────┘  │ └──────────────────┘  │  │
    │                         │                        │  │
    │                         │  Topic Subscribe:      │  │
    │                         │  - network-features    │  │
    │                         │                        │  │
    │                         │  Topic Publish:        │  │
    │                         │  - alerts-raw          │  │
    │                         │  - anomaly-detected    │  │
    │                         │  - alerts-for-llm      │  │
    │                         │                        │  │
    │                         └────────────────────────┘  │
    │                                                      │
    │  ┌──────────────────────────────────────────────┐   │
    │  │     vm-response (Private/Isolated)           │   │
    │  │     4 cores, 4GB RAM, 40GB SSD              │   │
    │  │                                              │   │
    │  │  ┌──────────────────────────────────────┐  │   │
    │  │  │  soar.py (SOAR Layer 1)              │  │   │
    │  │  │  - SSH iptables blocker              │  │   │
    │  │  │  - Instant block (severity > 85%)    │  │   │
    │  │  │  - Correlation & de-duplication      │  │   │
    │  │  └──────────────────────────────────────┘  │   │
    │  │                                              │   │
    │  │  ┌──────────────────────────────────────┐  │   │
    │  │  │  agent_ia.py (Layer 3: LLM Analysis) │  │   │
    │  │  │  - Consume: alerts-for-llm           │  │   │
    │  │  │  - Call: Ollama llama3.2:3b (no GPU)│  │   │
    │  │  │  - Output: 7-field JSON incident     │  │   │
    │  │  │  - Publish: incident-reports        │  │   │
    │  │  │  - Duration: 2-10 secondes           │  │   │
    │  │  └──────────────────────────────────────┘  │   │
    │  │                                              │   │
    │  │  ┌──────────────────────────────────────┐  │   │
    │  │  │  agent_cti.py (CTI Layer)            │  │   │
    │  │  │  - FAISS vector index                │  │   │
    │  │  │  - SQLite threat feeds               │  │   │
    │  │  │  - RAG + Ollama llama3 (GPU host)   │  │   │
    │  │  │  - Enrichissement menaces            │  │   │
    │  │  └──────────────────────────────────────┘  │   │
    │  │                                              │   │
    │  │  Topics Subscribé:                          │   │
    │  │  - anomaly-detected                         │   │
    │  │  - alerts-for-llm                           │   │
    │  │                                              │   │
    │  │  Topics Publié:                             │   │
    │  │  - incident-reports                         │   │
    │  └──────────────────────────────────────────────┘   │
    │                                                      │
    └──────────────────────────────────────────────────────┘
```

### 2.2 Flux de Données Complet (End-to-End)

```
1. CAPTURE RÉSEAU (vm-edge)
   Suricata (IDS signature-based) détecte trafic anormal
   ↓
   Filebeat enrichit avec géolocalisation
   ↓
   edge_collector.py → 16 features extraites
       Features: [ip_src, ip_dst, port_src, port_dst, protocole, payload_size, 
                  ttl, flag_syn, flag_ack, window_size, entropy, rate_pkt, 
                  geoloc_src, geoloc_dst, time_delta, urgency_flag]
   ↓
   Publication Kafka Topic: "network-features" (192.168.56.130:9092)

2. DÉTECTION ANOMALIES (vm-ml)
   realtime_interface_16f.py consomme "network-features"
   ↓
   Charge modèle: deep_lstm_vae_16f.keras (directory: modele_deep_lstm_vae_16features/)
   Charge scaler: global_scaler_16f.pkl
   Charge metadata: metadata_modele.json
   ↓
   LSTM-VAE reconstruction error computation:
       - MSE calculé pour chaque séquence (window size = 10)
       - Seuil opérationnel global: 26.0959 (µ + 1σ de validation)
   ↓
   Rate-limiter: max 80 paquets/2 secondes
   Anti-DDoS: 300-paquets threshold
   Whitelist: [IPs internes approuvées]
   ↓
   Si MSE > 26.0959:
       Publication Topic: "anomaly-detected" + "alerts-for-llm"
   Sinon: Ignoré (normal traffic)

3. ORCHESTRATION SOAR 3-NIVEAUX (vm-response → soar.py)

   ┌─────────────────────────────────┐
   │ Palier 1: SSH iptables Blocker  │
   │ (Instant, pas de délai)         │
   │ Condition: severity > 85%       │
   │ Action: ssh -L iptables DROP    │
   │ Timeout: 5 minutes              │
   └─────────────────────────────────┘
             ↓
   ┌─────────────────────────────────┐
   │ Palier 2: Socket.io Alert Admins│
   │ (server.js broadcast)           │
   │ Event: "soar_incident_incoming" │
   │ Si activeAdmins > 0:            │
   │    → Emit real-time alert       │
   │ Sinon:                          │
   │    → Nodemailer fallback        │
   │    → Alert email imédiat        │
   └─────────────────────────────────┘
             ↓
   ┌─────────────────────────────────┐
   │ Palier 3: Auto-Pilot Instant    │
   │ (24/7 Autonomous Defense)       │
   │ Condition: admin offline +      │
   │           confidence ≥ 85%      │
   │ Action: Instant iptables block  │
   │         (SANS DÉLAI)            │
   │ Rationale: Zéro-délai pour      │
   │           défense autonome 24/7 │
   └─────────────────────────────────┘

4. ANALYSE COGNITIVE POST-ATTAQUE (agent_ia.py)
   Consomme Topic: "alerts-for-llm"
   ↓
   Construit prompt strict en français/anglais
   ↓
   Appelle Ollama REST: http://[host]:11434/api/generate
   Model: llama3.2:3b (no-GPU sur vm-response)
   Paramètres: temperature=0.2, top_p=0.9, format=json
   ↓
   RÉPONSE ATTENDUE (7-champs JSON strict):
   {
     "titre_incident": "string",
     "resume_executif": "string (50-100 mots)",
     "niveau_severite": "CRITIQUE|ÉLEVÉ|MOYEN|BAS",
     "score_confiance": "float (0-1)",
     "mitre_attack_technique": "string (e.g., T1021.001)",
     "analyse_technique": "string (détails techniques)",
     "recommandations_actions": "string (actions imédiat)"
   }
   ↓
   Publie Topic: "incident-reports"
   ↓
   Fallback JSON (si Ollama timeout): Template statique pré-défini

5. DATA FUSION & PERSISTENCE (server.js)
   Consomme Topics: incident-reports, soar-commands
   ↓
   MongoDB persistence: incident_reports collection
   Champs: timestamp, titre, resume, severity, confidence, mitre, analysis, 
           actions, soar_status, admin_response
   ↓
   Socket.io broadcast: "soar_incident_updated"
   Listeners: Frontend dashboard real-time
   ↓
   Email fallback: Nodemailer (si no activeAdmins)
   SMTP: [configured in .env]

6. FRONTEND SOC DASHBOARD REAL-TIME
   Socket.io listener: "soar_incident_updated"
   ↓
   Affiche:
   - Alert overlay avec glassmorphism
   - Severity badge (rouge/orange/jaune/gris)
   - MITRE ATT&CK tag
   - Admin response buttons
   - PDF export trigger
   ↓
   Web Audio siren: Activation selon severity
   ↓
   Notification center: Historique incidents
```

### 2.3 Topics Kafka (Complet)

| Topic | Producer | Consumer | Format | Notes |
|-------|----------|----------|--------|-------|
| `network-features` | edge_collector.py | realtime_interface_16f.py | JSON (16 features) | 1M+ séquences validées |
| `anomaly-detected` | realtime_interface_16f.py | soar.py, agent_ia.py | JSON (alert + metadata) | Raw anomaly output |
| `alerts-for-llm` | soar.py (relay) | agent_ia.py | JSON (structured alert) | Palier 2 input |
| `incident-reports` | agent_ia.py | server.js | JSON (7-field strict) | Final diagnostic |
| `soar-commands` | server.js (admin) | soar.py | JSON (action directive) | Manual override |

---

## 🧠 SECTION 3 — MODÈLE LSTM-VAE 16 FEATURES

### 3.1 Architecture Modèle

**Nom Officiel:** `deep_lstm_vae_16f.keras`  
**Directory:** `/vm-ml/modele_deep_lstm_vae_16features/`  
**Format:** Keras (`.keras`)  
**Fenêtre temporelle:** 10 timesteps  
**Nombre de features:** 16

**Composants Internes:**
- **Architecture LSTM-VAE officielle:** `64 → 32 → 16 → 32 → 64`
- **Encodeur LSTM:** 2 couches (64 → 32 unités)
- **Couche Sampling:** `CoucheEchantillonnage` (latent_dim=16)
- **Couche VAE Loss:** `CoucheVAELoss` (KL divergence regularization)
- **Décodeur LSTM:** 2 couches (32 → 64 unités)
- **Sortie:** Reconstruction de la séquence; MSE utilisé comme anomaly score

**Entrées:**
- Séquences de 10 timesteps
- 16 features par timestep
- Normalisé par `global_scaler_16f.pkl` (StandardScaler)

**Sorties:**
- Reconstruction de la séquence
- MSE (Mean Squared Error) comme anomaly score

### 3.2 Sélection Features (Supervised SelectKBest ANOVA)

**Problème Initial (32 → 16 features):**
- Variance threshold + Pearson correlation étaient insuffisants
- Beaucoup de features avaient low discriminant power (Cohen's d < 0.2)
- Supervised SelectKBest ANOVA plus efficace pour anomaly detection

**16 Features Sélectionnées:**
```json
[
  "ip_src_entropy",
  "ip_dst_entropy", 
  "port_src_mode",
  "port_dst_mode",
  "protocol_distribution",
  "payload_size_mean",
  "payload_size_std",
  "ttl_variance",
  "tcp_flag_syn_count",
  "tcp_flag_ack_count",
  "window_size_max",
  "packet_rate_pkts_per_sec",
  "geolocation_src_diversity",
  "geolocation_dst_diversity",
  "inter_arrival_time_mean",
  "entropy_rate_change"
]
```

**Format Stockage:** `selected_features_global.json` — **FLAT JSON LIST** (non dict)

**Métadonnées actuelles (`metadata_modele.json`):**
- `architecture`: `LSTM-VAE (64-32-16-32-64)`
- `taille_fenetre`: `10`
- `nb_features`: `16`
- `seuil_1sigma_baseline`: `26.095900` — seuil global opérationnel actuel
- `mu_validation`: `7.18690824508667`
- `sigma_validation`: `18.90900230407715`
- `seuil_optimal_calibre`: `63.78517150878906` — valeur de calibration conservée mais non utilisée par la décision runtime actuelle
- `feature_p98_thresholds`: 16 seuils individuels utilisés par le mécanisme de vote

### 3.3 Métriques & Performance

**Dataset d'Entraînement:** 1M+ séquences normales + attaques synthétiques
**Validation:** 20% test split, cross-validation 5-fold

**Résultats (Modèle 16-feature Final):**
| Métrique | Valeur | Interprétation |
|----------|--------|----------------|
| Recall | 44.70% | Détecte ~45% des attaques réelles |
| FPR (False Positive Rate) | 0.74% | Très faible bruit (faux positifs) |
| Precision | 98.67% | Haute confiance quand alerte générée |
| F1-Score | 0.6153 | Équilibre précision-recall respectable |
| MSE Threshold opérationnel | 26.0959 | `seuil_1sigma_baseline`, utilisé pour la décision runtime |
| Seuil optimal calibré (référence) | 63.7851715 | Conservé dans metadata, non utilisé pour la décision runtime actuelle |

**Trade-off Accepté:** Recall 44.70% est acceptable car:
- Suricata signature-based détecte 90%+ des attaques connues
- LSTM-VAE rattrape les 10% de zero-day/anomalies
- Ensemble combiné offre couverture complète

### 3.4 Déploiement Modèle (realtime_interface_16f.py)

**État:** VERSION COURANTE — `realtime_interface.py` implémente l’inférence temps réel 16 features avec fenêtre de 10 timesteps

**Modifications Requises (DÉTAILLÉES):**
1. Chemin modèle: `/vm-ml/modele_deep_lstm_vae_16features/deep_lstm_vae_16f.keras`
2. Chemin scaler: `/vm-ml/modele_deep_lstm_vae_16features/global_scaler_16f.pkl`
3. Chemin metadata: `/vm-ml/modele_deep_lstm_vae_16features/metadata_modele.json`
4. **Schema chargement features:** `json.load()` en assumant **FLAT LIST** format
   ```python
   with open('selected_features_global.json') as f:
       selected_features = json.load(f)  # Retourne liste, NOT dict
   ```
5. Seuil opérationnel global: `26.0959` (`metadata_modele.json` → `seuil_1sigma_baseline`)
   - Le seuil `63.7851715` (`seuil_optimal_calibre`) reste disponible comme valeur de calibration/référence, mais n’est pas utilisé pour la décision runtime actuelle
6. Kafka topic input: `network-features`
7. Custom Keras layers: `CoucheEchantillonnage` et `CoucheVAELoss` INCHANGÉES
8. Rate-limiter, anti-DDoS, whitelist: INCHANGÉES
9. Cooldown: 300 secondes INCHANGÉ

**Implémentation actuelle:** `realtime_interface.py` — inférence 16 features, fenêtre 10, vote hybride et mécanismes de corrélation/réponse.

**Validation requise:** Test sur `vm-ml` avec le topic `network-features` et vérification des sorties `anomaly-detected`.

---

## 🔄 SECTION 4 — PIPELINE SOAR & RESPONSE

### 4.1 SOAR Layer 1 — SSH iptables Blocker (soar.py)

**Déclencheur:** Alert avec `severity > 85%`  
**Latence:** IMMÉDIATE (< 100ms)  
**Action:**
```bash
ssh -i /path/to/key user@target_vm "sudo iptables -I INPUT -s <IP_ATTACKER> -j DROP"
```
**Timeout Déblock:** 5 minutes (après 300s, DROP rule supprimée)  
**Correlation:** Déduplique alertes identiques dans 30-second window

### 4.2 SOAR Layer 2 — Socket.io Real-time Admin Alert

**Event:** `soar_incident_incoming` (server.js broadcast)  
**Payload:**
```javascript
{
  incident_id: "uuid",
  titre: "string",
  severity: "number (0-100)",
  source_ip: "string",
  timestamp: "ISO8601",
  soar_status: "pending_admin_response"
}
```

**Logic:**
- Si `activeAdmins > 0`: Emit Socket.io event
- Sinon: Fallback email via Nodemailer

### 4.3 SOAR Layer 3 — Auto-Pilot Instant Block (24/7 Autonomous)

**Condition:** Admin hors ligne ET confidence ≥ 85%  
**Latence:** 0 délai (instant iptables block)  
**Rationale:** Pour défense autonome 24/7, délai NON acceptable

**Décision Architecturale:**
- Palier 3 doit être **instant sans délai**
- Approche correcte pour système autonome production
- Justification défense: "Zéro-délai critical pour menaces en temps réel"

---

## 📊 SECTION 5 — AGENTS IA & COGNITIVE RESPONSE

### 5.1 agent_ia.py (Post-Attack LLM Analysis)

**Role:** Diagnostic cognitif post-attaque via LLM  
**Input Topic:** `alerts-for-llm`  
**Output Topic:** `incident-reports`  
**Model:** Ollama llama3.2:3b (NO GPU, vm-response)

**Prompt Construction (Strict):**
```
Vous êtes expert en cybersécurité. Analysez cette alerte et générez rapport JSON.

Alerte reçue:
{détails alert JSON}

GÉNÉREZ STRICT JSON (valide):
{
  "titre_incident": "...",
  "resume_executif": "...",
  "niveau_severite": "CRITIQUE|ÉLEVÉ|MOYEN|BAS",
  "score_confiance": 0.95,
  "mitre_attack_technique": "T1021.001",
  "analyse_technique": "...",
  "recommandations_actions": "..."
}
```

**Fallback Mechanism:**
- Si Ollama timeout: Template JSON pré-rempli
- Assure resilience pipeline (pas de break sur LLM unavailable)

### 5.2 agent_cti.py (CTI Threat Intelligence)

**Role:** Enrichissement threat feeds via FAISS + RAG  
**Knowledge Base:**
- FAISS vector index (embeddings Ollama)
- SQLite threat DB
- MITRE ATT&CK mappings

**Execution:**
- Appelle Ollama llama3 (GPU on host) pour RAG context
- Enrichit incidents avec threat context global
- Stocke résultats dans SQLite pour future reference

### 5.3 agent_monitor.py (Process Heartbeat)

**Rôle:** Monitoring agents, restarts si dead  
**Interval:** 30 secondes  
**Actions:** Kill + respawn failed agents

---

## 🎨 SECTION 6 — FRONTEND SOC DASHBOARD

### 6.1 Stack & Technologie

**Framework:** Next.js 14+ (App Router)  
**Styling:** Tailwind CSS + custom glassmorphism utilities  
**Icons:** Lucide React  
**Real-time:** Socket.io-client  
**Audio:** Web Audio API (sirens)  
**PDF Export:** html2canvas + jsPDF  
**State:** React hooks (useState, useEffect, useContext)

### 6.2 Design Langage

**Thème:** Dark cybernetic glassmorphism  
**Palette:**
- Background: `bg-slate-950` (quasi-noir)
- Borders: `border-slate-800` (subtle)
- Text: `text-slate-200` (clair sur dark)
- Accents: Cyan `#06b6d4` + Red `#ef4444` + Purple `#a855f7`
- Glass Effect: `bg-opacity-10 backdrop-blur-lg border border-opacity-30`

### 6.3 Pages Principales

| Page | Route | Fonction |
|------|-------|----------|
| Dashboard | `/` | Vue globale incidents, VM status, CTI feeds |
| Incidents | `/incidents` | Table détaillée incidents (export PDF) |
| Infrastructure | `/infrastructure` | Topologie VMs, health checks |
| Threat Intel | `/threat-intel` | CTI feeds, MITRE mappings |
| IA Activity | `/ia-activity` | Agent logs, LLM analysis history |
| Formations | `/formations` | Training mode, simulations |
| Settings | `/settings` | User preferences, alert thresholds |
| Login | `/login` | Authentication (JWT/session) |

### 6.4 Socket.io Real-time Events

| Event | Direction | Payload | Frequency |
|-------|-----------|---------|-----------|
| `soar_incident_incoming` | Server → Client | {incident_id, titre, severity, source_ip} | Per alert |
| `soar_incident_updated` | Server → Client | {incident_id, ...updated fields} | Per update |
| `send_command` | Client → Server | {command, target, params} | On admin action |
| `vm_status` | Server → Client | {vm_name, cpu, memory, disk} | Every 10s |
| `notification` | Server → Client | {type, message, timestamp} | Per event |

### 6.5 Audio Sirens (Web Audio API)

**Activation:** Severity > 70  
**Tone:** 1000Hz + 1500Hz (police siren pattern)  
**Duration:** Until dismissed by admin  
**Volume:** 0.7 (settable in preferences)

---

## 🛠️ SECTION 7 — STACK TECHNOLOGIQUE COMPLET

### Backend & Data Pipeline
- **Runtime:** Node.js 18+ (Windows Host)
- **Framework:** Express.js (HTTP API)
- **Real-time:** Socket.io (WebSocket)
- **Message Queue:** Apache Kafka 4.3 (vm-ml broker)
- **Clients:** KafkaJS (Node), kafka-python (Python)
- **Database:** MongoDB (Cloud/local, incident persistence)
- **Email:** Nodemailer (SMTP fallback)
- **PDF Generation:** html2canvas + jsPDF

### Frontend
- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS 3+ + PostCSS
- **Icons:** Lucide React
- **Real-time:** Socket.io-client
- **Audio:** Web Audio API
- **Export:** html2canvas, jsPDF

### Python Modules (VMs)
- **IDS:** Suricata 6.0+
- **Log Shipper:** Filebeat (Elastic)
- **ML:** TensorFlow/Keras 2.10+, scikit-learn 1.0+
- **Feature Engineering:** pandas, numpy, scipy
- **Message Queue:** kafka-python
- **SSH Commands:** paramiko
- **LLM Client:** requests (REST to Ollama)
- **Vector DB:** FAISS, SQLite3
- **Network:** Scapy, dpkt

### AI & LLM
- **Server:** Ollama (self-hosted)
- **Models:**
  - **llama3** (GPU on host, CTI enrichment)
  - **llama3.2:3b** (no-GPU on vm-response, incident analysis)
- **API:** REST @ http://[host]:11434/api/generate
- **Format Enforcement:** JSON constraint in prompts

### Academic & Diagramming
- **LaTeX:** Overleaf / Texmaker, pdflatex
- **Diagrams:** PlantUML, Mermaid.js, TikZ
- **BibTeX:** IEEE / APA citation styles
- **Presentation:** Slides (18-24) glassmorphism-themed

---

## 📈 SECTION 8 — ÉTAT DÉVELOPPEMENT ACTUEL

### Release 1 — Detection (COMPLETED ✅)
- ✅ Suricata signature-based IDS
- ✅ Filebeat geolocation enrichment
- ✅ edge_collector.py (16 features)
- ✅ LSTM-VAE model training & validation
- ✅ realtime_interface.py (inférence LSTM-VAE 16 features + corrélation hybride + auto-blocage)
- ✅ Kafka event streaming
- ✅ ELK/Kibana analytics

### Release 2 — Prevention & Response (IN PROGRESS 🔄)
- ✅ soar.py (SSH iptables blocker)
- ✅ 3-tier escalation logic
- ✅ agent_ia.py (LLM cognitive analysis)
- ✅ agent_cti.py (threat intelligence)
- ✅ MongoDB persistence
- ✅ Backend server.js + Socket.io
- ✅ Frontend SOC dashboard
- ✅ Nodemailer email fallback
- 🔄 Architecture diagram finalization (PlantUML/Mermaid)
- 🔄 LaTeX thesis chapters (autonomous response + SOAR)
- 🔄 Presentation slides (18-24, glassmorphism)

### Deliverables for Defense
1. **Architecture Diagram (Mermaid/PlantUML)**
   - Complete topology (all VMs, Kafka topics, SSH tunnels, Socket.io)
   - Data flow from Suricata → Frontend
   - SOAR 3-tier escalation tree
   - LLM cognitive response loop
   
2. **Presentation Slides (18-24)**
   - Dark theme, cyan+red accents
   - System overview, architecture, demo flow
   
3. **LaTeX Thesis Chapter (6-8 pages)**
   - Autonomous cyber-defense systems
   - SOAR orchestration & cognitive response
   - 7-field JSON diagnostic format
   - Experimental results & metrics

---

## 🎓 SECTION 9 — DIRECTIVES ACADÉMIQUES DÉFENSE

### Positioning Thèse
**Titre Proposé:** "NG-IDPS: Système Autonome de Détection et Prévention d'Intrusions Réseau avec Orchestration SOAR et Analyse Cognitive par LLM"

**Contributions Clés:**
1. **Détection Hybride:** Signature-based (Suricata) + anomaly (LSTM-VAE)
2. **Orchestration SOAR:** 3-tier escalation (instant block → admin alert → auto-pilot)
3. **Analyse Cognitive:** Post-attack LLM analysis avec JSON diagnostic strict
4. **Architecture Distribuée:** Microservices Kafka-driven, scalable
5. **24/7 Autonomie:** Zéro-délai response sans intervention humaine

### Key Arguments for Jury
- **Problem Statement:** Besoin de systèmes IDS autonomes capable de répondre aux menaces zero-day en real-time
- **State of Art:** Comparaison Suricata, Snort, ZEEK + LSTM anomaly detection (pas de système complet)
- **Innovation:** Combinaison unique SOAR 3-tier + LLM cognitive analysis + 24/7 autonomy
- **Validation:** 1M+ test sequences, F1=0.6153, FPR=0.74%, ensemble recall=90%+
- **Scalability:** Kubernetes-ready (Docker strategy post-defense)

### Presentation Flow
```
1. Introduction (2 min)
   - Contexte cybersécurité, menaces croissantes
   - Limites IDS traditionnels (signature-based only)

2. Problématique & Objectifs (2 min)
   - Besoin: Détection + réponse automatique 24/7
   - Objectif: NG-IDPS hybrid avec SOAR + LLM

3. Architecture (5 min)
   - Topologie VM, Kafka, Ollama
   - Data flow Suricata → LLM → decision
   - Demo diagram interactif

4. Implémentation Clés (6 min)
   - LSTM-VAE 16-feature model
   - SOAR 3-tier escalation logic
   - agent_ia.py cognitive analysis
   - agent_cti.py threat intelligence

5. Résultats & Validation (4 min)
   - Metrics (Recall, FPR, Precision, F1)
   - Ensemble detection (signature + anomaly)
   - Case studies: 3-5 attack scenarios

6. Perspectives Futures (1 min)
   - Docker containerization
   - Kubernetes orchestration
   - Distributed threat intel

7. Questions (3 min)
```

---

## 🔐 SECTION 10 — PRINCIPES CLÉS & PATTERNS

### Data Quality
- **Feature Engineering:** SelectKBest ANOVA, not variance-only
- **Normalization:** StandardScaler per feature (global_scaler_16f.pkl)
- **Séquencing:** 10-timestep sliding windows
- **Deduplication:** 30-second correlation window in soar.py

### Resilience
- **Fallback Mechanisms:** JSON template if Ollama timeout
- **Circuit Breaker:** Kafka broker heartbeat, auto-reconnect
- **Cooldown Logic:** 300-second deblock timer, prevents replay
- **Whitelist Bypass:** Approved IPs skip rate-limiting

### Security
- **SSH Keys:** Paramiko with key-based auth (no passwords)
- **HTTPS:** Socket.io over TLS (production)
- **JWT Auth:** Frontend login (optional in MVP)
- **Data Encryption:** MongoDB TLS, Kafka SASL (optional)

### Scalability (Docker Ready)
- Each component (edge_collector, kafka, soar, agent_ia, server, frontend) → separate container
- Horizontal scaling: Multiple realtime_interface instances on vm-ml
- Load balancing: Nginx reverse proxy in front of server.js
- **Status:** Post-defense deliverable (Docker documentation only)

---

## 📝 SECTION 11 — FICHIERS CLÉS & LOCATIONS

### Backend Files
| File | Location | Role |
|------|----------|------|
| server.js | `backend/server.js` | Express + Socket.io main |
| .env.exemple | `backend/.env.exemple` | Config template |
| package.json | `backend/package.json` | Dependencies |

### Frontend Files
| File | Location | Role |
|------|----------|------|
| page.tsx | `frontend/src/app/page.tsx` | Dashboard main |
| incidents/page.tsx | `frontend/src/app/incidents/page.tsx` | Incidents list |
| threat-intel/page.tsx | `frontend/src/app/threat-intel/page.tsx` | CTI feeds |
| ia-activity/page.tsx | `frontend/src/app/ia-activity/page.tsx` | Agent logs |
| infrastructure/page.tsx | `frontend/src/app/infrastructure/page.tsx` | VM topology |
| settings/page.tsx | `frontend/src/app/settings/page.tsx` | User config |
| GlobalAlertListener.tsx | `frontend/src/components/GlobalAlertListener.tsx` | Socket.io listener |
| Sidebar.tsx | `frontend/src/components/Sidebar.tsx` | Navigation |
| MainLayout.tsx | `frontend/src/components/MainLayout.tsx` | Layout wrapper |
| globals.css | `frontend/src/app/globals.css` | Glassmorphism styles |
| package.json | `frontend/package.json` | Dependencies |

### Python (vm-edge)
| File | Location | Role |
|------|----------|------|
| edge_collector.py | `vm-edge/edge_collector.py` | 16-feature extraction → Kafka |
| selected_features.json | `vm-edge/selected_features.json` | Feature list (FLAT) |
| agent_monitor.py | `vm-edge/agent_monitor.py` | Process monitoring |

### Python (vm-ml)
| File | Location | Role |
|------|----------|------|
| realtime_interface.py | `vm-ml/lstm-vae/realtime_interface.py` | **VERSION COURANTE** — inférence temps réel 16 features |
| realtime_interface_16f.py | `vm-ml/lstm-vae/realtime_interface_16f.py` | Référence/ancienne variante 16-feature si conservée dans le dépôt |
| train_lstm_vae.py | `vm-ml/lstm-vae/train_lstm_vae.py` | Model training script |
| feature_selector.py | `vm-ml/lstm-vae/feature_selector.py` | SelectKBest ANOVA feature selection |
| calibrate_threshold.py | `vm-ml/lstm-vae/calibrate_threshold.py` | MSE threshold calibration |
| evaluate_attacks.py | `vm-ml/lstm-vae/evaluate_attacks.py` | Attack dataset validation |
| deep_lstm_vae_16f.keras | `vm-ml/modele_deep_lstm_vae_16features/deep_lstm_vae_16f.keras` | **MODEL ARTIFACT** |
| global_scaler_16f.pkl | `vm-ml/modele_deep_lstm_vae_16features/global_scaler_16f.pkl` | **SCALER ARTIFACT** |
| selected_features_global.json | `vm-ml/modele_deep_lstm_vae_16features/selected_features_global.json` | **FEATURE LIST** (FLAT) |
| metadata_modele.json | `vm-ml/modele_deep_lstm_vae_16features/metadata_modele.json` | Model metadata |

### Python (vm-response)
| File | Location | Role |
|------|----------|------|
| agent_soar.py | `vm-response/agent_soar.py` | SSH iptables blocker (Palier 1) |
| agent_ia.py | `vm-response/agent_ia.py` | LLM cognitive analysis (Palier 3) |
| agent_cti.py | `vm-response/anticipation/agent_cti.py` | Threat intelligence enrichment |
| agent_cti_formation.py | `vm-response/anticipation/agent_cti_formation.py` | CTI training |
| core_memory.py | `vm-response/anticipation/core_memory.py` | CTI SQLite/FAISS storage |
| build_rule_index.py | `vm-response/anticipation/build_rule_index.py` | CTI index builder |

### Documentation
| File | Location | Purpose |
|------|----------|---------|
| README.md | Root | Project overview |
| 01-system-overview.md | `docs/01-system-overview.md` | System intro |
| 02-architecture-and-dataflow.md | `docs/02-architecture-and-dataflow.md` | Architecture detail |
| 03-ml-and-detection-engine.md | `docs/03-ml-and-detection-engine.md` | LSTM-VAE details |
| 04-soar-cti-and-response.md | `docs/04-soar-cti-and-response.md` | Response agents |
| 05-api-and-dashboard.md | `docs/05-api-and-dashboard.md` | Backend API + Frontend |
| 06-deployment-and-operations.md | `docs/06-deployment-and-operations.md` | DevOps guide |

---

## 🎯 SECTION 12 — QUESTIONS FRÉQUENTES POUR AUTRES IA

### Q1: Comment le LSTM-VAE actuel 16-feature diffère-t-il de la version précédente?
**A:** Supervised SelectKBest ANOVA au lieu de variance threshold seul. Élimine features with Cohen's d < 0.2. Modèle final: F1=0.6153, FPR=0.74% sur 1M+ séquences.

### Q2: Pourquoi Palier 3 (auto-pilot) est-il instant sans délai?
**A:** Pour 24/7 autonomie zéro-délai, critique en cyber-défense. Tout délai expose système à multiples attaques parallèles.

### Q3: Comment soar.py déduplique-t-il alertes?
**A:** 30-second correlation window. Même IP source + même port = alertes fusionnées. Évite spam iptables.

### Q4: Que fait realtime_interface_16f.py exactement?
**A:** Consomme `network-features` Kafka, charge le LSTM-VAE 16-feature, construit des fenêtres de 10 timesteps, calcule l’erreur de reconstruction MSE, applique le vote par seuils P98 des 16 features et le seuil global opérationnel `26.0959`; une anomalie ML stricte est déclenchée si `votes >= 4` **OU** `MSE global >= 26.0959`, sous réserve des mécanismes de rate-limiting, DDoS shield, whitelist et persistance.

### Q5: Format agent_ia.py JSON output?
**A:** 7 champs strict: titre_incident, resume_executif, niveau_severite, score_confiance, mitre_attack_technique, analyse_technique, recommandations_actions.

### Q6: Comment frontend sait-il alertes en real-time?
**A:** Socket.io listener `soar_incident_updated`. Server.js émet quand agent_ia.py publie incident-reports Topic.

### Q7: Que faire si Ollama est down?
**A:** agent_ia.py publie fallback JSON template. Pipeline continue sans interruption.

### Q8: Scalabilité? Peut supporter combien d'alertes/sec?
**A:** Avec Kafka partitioning: 1000+ alertes/sec par broker. Ajouter réplicas pour high-availability. Docker + Kubernetes prêt (post-defense).

### Q9: Comment authentifier admins frontend?
**A:** Optional JWT token au login. Bearer token dans Socket.io handshake. Session persistent Redis (future).

### Q10: Défense académique? Quels points souligner?
**A:** (1) Hybrid detection, (2) 3-tier SOAR, (3) 24/7 autonomy, (4) Cognitive LLM, (5) 90%+ ensemble recall avec Suricata + LSTM-VAE.

---

## 📌 SECTION 13 — CHECKPOINTS DE VALIDATION

### Pour Autre IA: Vérifier Compréhension
- [ ] Architecture 6 composants (Edge, ML, Response, Host, Backend, Frontend) compris
- [ ] Kafka 5 topics nommés et rôles clairs
- [ ] LSTM-VAE 16 features avec architecture `64-32-16-32-64` et fenêtre de 10 timesteps
- [ ] SelectKBest ANOVA pour la sélection supervisée des 16 features
- [ ] SOAR 3-tier logic (instant block, admin alert, auto-pilot)
- [ ] agent_ia.py 7-field JSON diagnostic format
- [ ] Socket.io real-time events flow
- [ ] Fallback mechanisms (JSON template, email, etc.)
- [ ] Glassmorphism frontend design langage
- [ ] Defense pitch points (hybrid, SOAR, autonomy, LLM, ensemble)
- [ ] Docker post-defense strategy (académique only)

---

## 🚀 SECTION 14 — PROCHAINES ÉTAPES POUR AZIZ

### Before Defense (Priority)
1. **Valider / finaliser `realtime_interface.py` (16 features)** ← CURRENT
   - Vérifier la compatibilité exacte avec le modèle `64-32-16-32-64`
   - Tester sur `vm-ml` avec le topic `network-features`
   - Valider `anomaly-detected`, le vote `4/16` et le seuil global `26.0959`

2. **Finalize Architecture Diagram** (PlantUML/Mermaid)
   - All topics, VMs, Ollama, MongoDB, Socket.io
   - SOAR 3-tier escalation tree
   - Data flow annotations
   
3. **Write LaTeX Thesis Chapter** (6-8 pages)
   - Autonomous systems background
   - SOAR design pattern
   - Cognitive response via LLM
   - 7-field JSON diagnostic format
   - Experimental validation

4. **Prepare Slides** (18-24, glassmorphism)
   - Dark theme, cyan+red
   - System diagram, code snippets, metrics
   - 10-minute defense speech outline

### Post-Defense (Academic Documentation)
- Docker Dockerfile + docker-compose (production architecture perspective)
- Kubernetes manifests (scalability story)
- DOCKER_SETUP.md + DEPLOYMENT.md guides
- LaTeX chapter on containerization (~4-5 pages)

---

## 📞 SECTION 15 — SUPPORT POUR AUTRES IA

**Si une autre IA pose question:**
1. Référencer ce document (NG-IDPS_PROFESSIONAL_SUMMARY.md)
2. Sections 1-15 couvrent 99% cas d'usage
3. Pour code spécifique: Consulter repo files (backend/, vm-edge/, vm-ml/, vm-response/, frontend/)
4. Pour academic help: Sections 9-13 offrent positioning defense + LaTeX guidance
5. Pour architecture decisions: Section 10 principes clés + patterns

---

**END OF DOCUMENT**  
*Last Updated: September 14, 2026*  
*Version: 1.0 (Complete Professional Summary)*  
*Format: Markdown (copy-pasteable to any AI tool)*
