# Structuration du Projet NG-IDPS : Planification Scrum en 2 Releases

Ce document définit la feuille de route Agile / Scrum du projet **NG-IDPS (Next-Generation Intrusion Detection and Prevention System)**. Il découpe les développements en deux releases complémentaires : l'interception et l'analyse temps réel (Release 1) et l'intelligence cognitive, la réponse automatisée et la supervision (Release 2).

---

## 🚀 Release 1 : Détection, Ingestion Parallèle & Forensic (Fast Data & ELK)

L'objectif de cette première release est de construire la couche d'interception haute vélocité, d'exécuter la détection stochastique sous la contrainte critique de latence ($< 15\text{ ms}$) et d'assurer l'historisation des logs bruts réseau.

### 📌 Sprint 1 : Ingestion Parallèle & Stack ELK

- **Objectif :** Déployer la sonde Suricata sur `VM-Edge` et établir l'ingestion à double voie (Fast Data & Cold Data).
- **User Stories & Fonctionnalités :**
  - **Voie Fast Data :** Extraction continue des 16 caractéristiques statistiques (`16f`) et transmission asynchrone via le Producer Apache Kafka vers `VM-ML`.
  - **Voie Cold Data (ELK) :** Ingestion directe des logs bruts `eve.json` via le pipeline `Filebeat -> Logstash -> Elasticsearch -> Dashboard Kibana` sur `VM-Edge` pour l'analyse rétrospective et l'investigation forensic.
- **Livrables :** Sonde Suricata opérationnelle, bus Kafka fonctionnel et Dashboard Kibana d'historisation configuré.



### 📌 Sprint 2 : Moteur Stochastique & Filtrage par Persistance

- **Objectif :** Implémenter l'inférence Deep Learning sur `VM-ML` avec calibration hybride et élimination du bruit.
- **User Stories & Fonctionnalités :**
  - **Inférence Deep LSTM-VAE Déterministe :** Détection d'anomalies comportementales basées sur l'erreur de reconstruction séquentielle (MSE) via la moyenne de l'espace latent zmean​, garantissant une latence d'inférence ultra-faible (**2.2 ms à 4.3 ms**, largement inférieure à la contrainte de SLA <15 ms).
  - **Calibration Hybride (OR-Gate) :** Combination du seuil global 1σ (MSE≥26.0959) et du vote dynamique de consensus sur caractéristiques (≥4/16 features violant leur P98​) pour capturer simultanément les anomalies diffuses et ciblées.
  - **Bouclier Anti-DDoS Volumétrique & Rate-Limiting :** Pré-filtre haute performance analysant les bursts globaux (>300 pkts/2s) pour délester l'IA avant inférence, couplé à un suivi par IP (>80 pkts/2s).
  - **Filtrage par Persistance & Safe-Guard :** Fenêtre glissante `deque(maxlen=5)` exigeant ≥3/5 évaluations suspectes pour confirmer une attaque (complexité O(1)), combinée à une Whitelist d'actifs critiques et un cooldown de 300s.
- **Livrables :** Pipeline temps réel `realtime_interface.py` opérationnel sur `VM-ML`, connecté à Kafka et publiant les alertes d'isolation (`AUTO_BLOCK_IP` et `ENABLE_DDOS_SHIELD`).

---



## 🛡️ Release 2 : Prévention, Agents IA & Dashboard SOC (Next.js / Node.js)

Cette seconde release regroupe la sécurité cognitive (agents LLM, RAG), la réponse automatisée (SOAR), l'analyse post-incident et la supervision centralisée sur le Dashboard dédié *(sans dépendance vis-à-vis d'ELK)*.

### 📌 Sprint 3 : Anticipation par le Renseignement (Agent CTI & Dual-RAG)

- **Objectif :** Automatiser la veille OSINT et la génération de règles de détection préventives.
- **User Stories & Fonctionnalités :**
  - **Pipeline Dual-RAG :** Vectorisation des menaces (`nomic-embed-text`) et recherche de similitude sur l'index FAISS (49K règles Suricata).
  - **Inférence CTI Locale :** Génération de signatures via `llama3.2:3b` avec validation stricte par schémas Pydantic v2.
  - **Sécurisation & Test :** Filtrage anti-poisoning par liste blanche en $O(1)$ et exécution *Dry-Run* par script SSH sécurisé.
- **Livrables :** Agent CTI autonome capable d'enrichir dynamiquement le jeu de règles Suricata.



### 📌 Sprint 4 : Mitigation du Risque Humain (Agent Gemini & RAG LMS)

- **Objectif :** Générer des parcours de sensibilisation personnalisés suite à la détection d'incidents réels.
- **User Stories & Fonctionnalités :**
  - **Génération de Contenu LMS :** Création de modules de cours (JSON, diagrammes Mermaid, QCM) via l'API `gemini-3.6-flash`.
  - **Diffusion Ciblée :** Notification automatique par e-mail (Nodemailer) basée sur le registre des employés (`employes.json`).
  - **Suivi de Conformité :** Validation des acquis ($\ge 70$) et enregistrement des attestations dans la collection MongoDB `FormationRecord`.
- **Livrables :** Plateforme LMS automatisée déclenchée par les événements de sécurité.



### 📌 Sprint 5 : Supervision Temps Réel (Dashboard Next.js / Node.js), Agent Post-Attaque & SOAR

- **Objectif :** Centraliser le pilotage du SOC, analyser les incidents a posteriori et automatiser la neutralisation des menaces.
- **User Stories & Fonctionnalités :**
  - **Dashboard SOC (Next.js 14 / Node.js) :** Interface temps réel alimentée par WebSockets (Socket.IO) affichant les métriques d'inférence ML, les alertes et l'état des composants.
  - **Agent IA Post-Attaque (**`agent_ia.py`**) :** Analyse automatique de l'incident (vecteur d'attaque, gravité, empreinte des paquets) et transmission du rapport synthétique au Dashboard SOC.
  - **Score Tri-Factoriel de Menace :** Agrégation pondérée du niveau de risque :
  $$S_{    ext{composite}} = 0.4 \cdot S_{    ext{Suricata}} + 0.3 \cdot S_{    ext{ML}} + 0.3 \cdot S_{    ext{LLM}}$$
  - **Mode Auto-Pilote (Mode Nuit) & SOAR :** Blocage automatique par règles `iptables`/`nftables` en cas d'absence d'analyste actif ($N_{    ext{activeadmins}} = 0$).
  - **Watchdog :** Contrôle de santé des machines virtuelles (`VM-Edge`, `VM-ML`) exécuté toutes les 15 secondes.
- **Livrables :** Application SOC centralisée Next.js/Node.js, agent `agent_ia.py` intégré et boucle de réponse SOAR fermée.

---



## 📊 Matrice Synthétique de Répartition des Sprints


| Release       | Sprint       | Intitulé du Sprint                       | Technologies Clés                                          | Livrable Majeur                                                                 |
| ------------- | ------------ | ---------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Release 1** | **Sprint 1** | Ingestion Parallèle & Stack ELK          | Suricata, Kafka, Filebeat, Logstash, Elasticsearch, Kibana | Sonde Suricata & Ingestion Double Voie (Fast/Cold Data) [cite: 3]               |
|               | **Sprint 2** | Moteur Stochastique & Persistance        | PyTorch (LSTM-VAE 16F), `deque(maxlen=5)`                  | Moteur d'inférence $< 15 ext{ ms}$ & Événements `ANOMALY_DETECTED` [cite: 2, 3] |
| **Release 2** | **Sprint 3** | Agent CTI & Dual-RAG                     | FAISS, `nomic-embed-text`, `llama3.2:3b`, Pydantic v2      | Générateur automatique de règles Suricata (OSINT) [cite: 3]                     |
|               | **Sprint 4** | Agent Gemini & RAG LMS                   | API `gemini-3.6-flash`, Nodemailer, MongoDB                | Plateforme de sensibilisation ciblée post-incident [cite: 3]                    |
|               | **Sprint 5** | Dashboard SOC, Agent Post-Attaque & SOAR | Next.js 14, Node.js, Socket.IO, `agent_ia.py`, `iptables`  | Application SOC centralisée & Réponses SOAR automatisées [cite: 3]              |


