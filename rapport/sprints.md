# Architecture du Projet NG-IDPS : Modèle en 2 Releases

Ce document détaille la structuration du projet NG-IDPS en deux grandes releases majeures, séparant le traitement réseau en temps réel (Fast Data) de l'analyse cognitive et de la supervision (Cold Data).

---

## 🚀 Release 1 : La Détection et la Haute Vélocité (Fast Data)
Cette release se concentre sur le cœur réactif du système, garantissant l'interception et l'analyse immédiate des flux avec une latence minimale.

### Sprint 1 : Le Moteur Déterministe
* **Objectif :** Mise en place de la sonde Suricata sur le nœud `VM-Edge`.
* **Fonctionnalités :** 
  * Analyse par signature des menaces connues.
  * Filtrage des paquets et configuration du plan de données réseau.

### Sprint 2 : Le Moteur Stochastique et les Performances Critiques
* **Objectif :** Intégration de l'auto-encodeur variationnel LSTM-VAE sur `VM-ML`.
* **Fonctionnalités :** 
  * Détection d'anomalies comportementales via l'erreur de reconstruction (MSE).
  * Contrainte de performance : maintien d'une latence réseau stricte inférieure à **15 ms**.
  * Gestion de l'idempotence algorithmique en complexité $O(1)$ pour éviter l'épuisement de ressources (state exhaustion).

---

## 🛡️ Release 2 : La Prévention, l'Anticipation et la Supervision (Cold Data & Sécurité Cognitive)
Cette seconde release regroupe l'intelligence artificielle proactive, l'automatisation des réponses, la sensibilisation humaine et le pilotage centralisé.

### Sprint 3 : L'Anticipation par le Renseignement (Agent CTI & Dual-RAG)
* **Objectif :** Aspirer les flux OSINT et concevoir des règles préventives dynamiques.
* **Fonctionnalités :** 
  * Pipeline Dual-RAG (`nomic-embed-text` + index FAISS 49K règles Suricata).
  * Inférence locale via `llama3.2:3b` avec validation stricte Pydantic v2.
  * Liste blanche anti-poisoning en $O(1)$ et test en bac à sable (*Dry-Run* par exécution SSH).

### Sprint 4 : La Mitigation du Risque Humain (Agent Gemini & RAG LMS)
* **Objectif :** Sensibiliser les collaborateurs (ingénierie sociale) suite aux incidents réels.
* **Fonctionnalités :** 
  * Génération de cours structurés (JSON, diagrammes Mermaid, QCM) via l'API Cloud `gemini-3.6-flash`.
  * Diffusion ciblée par e-mail (Nodemailer) basée sur l'annuaire IAM (`employes.json`).
  * Suivi de conformité, validation des acquis ($\ge 70\%$) et enregistrement dans la collection `FormationRecord`.

### Sprint 5 : La Supervision Temps Réel et l'Industrialisation DevSecOps
* **Objectif :** Centraliser le contrôle du SOC et automatiser les mesures de défense (SOAR).
* **Fonctionnalités :** 
  * SOC Dashboard via Next.js 14 et WebSockets (Socket.IO) pour un affichage sub-milliseconde.
  * Score de menace composite tri-factoriel ($0.4 \cdot S_{\text{Suricata}} + 0.3 \cdot S_{\text{ML}} + 0.3 \cdot S_{\text{LLM}}$).
  * Mode "Auto-Pilote" (Mode Nuit) bloquant automatiquement les menaces si aucun analyste n'est actif ($N_{\text{active_admins}} = 0$).
  * Chien de garde (*Watchdog*) toutes les 15 secondes pour le suivi de santé des machines virtuelles.
