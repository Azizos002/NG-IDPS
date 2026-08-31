## Plan d'Implémentation : Agent CTI & RAG (`agent_cti.py`)

### Phase 1 : Initialisation et Mémoire Locale (RAG)
*   **Étape 1 : Dépendances Minimales :** Installation des bibliothèques légères `faiss-cpu`, `pydantic`, `aiohttp` et `pymongo` dans l'environnement de la VM-Response.
*   **Étape 2 : Base de Données SQLite :** Création de la table `threat_intel.sqlite` qui servira de source de vérité persistante pour stocker l'historique des rapports CTI générés.
*   **Étape 3 : Index Vectoriel FAISS :** Initialisation et chargement du fichier `index_faiss.bin` en RAM pour permettre la recherche de similarité et la déduplication sémantique.

### Phase 2 : Le Système Multi-Agents (Pur Python)
*   **Étape 4 : L'Agent Scout (Déterministe) :** Création de la fonction asynchrone pour télécharger le flux OSINT, extraire les adresses IP via Regex, et les filtrer instantanément ($O(1)$) avec la liste blanche `actifs_critiques.json`[cite: 1, 2].
*   **Étape 5 : L'Agent Analyste (IA) :** Implémentation de la requête HTTP vers l'API Ollama de l'hôte (`192.168.56.1`), incluant le mécanisme de *Circuit Breaker* (bloc `try/except` avec Timeout strict) pour ne pas figer la VM.
*   **Étape 6 : L'Agent Guardrail (Validation) :** Définition de la classe `Pydantic` pour forcer mathématiquement le LLM (Llama 3) à respecter notre format JSON strict.

### Phase 3 : Orchestration et Exportation
*   **Étape 7 : Le "Fast Path" (Cache Sémantique) :** Implémentation du routeur. Si l'attaque est déjà connue dans FAISS, le système récupère le JSON dans SQLite (CPU = 0%).
*   **Étape 8 : Persistance :** Si c'est une menace inédite, sauvegarde du nouveau vecteur dans l'index FAISS et écriture du rapport dans SQLite.
*   **Étape 9 : Injection MongoDB (Dashboard) :** Envoi du rapport final vers la base de données de l'hôte avec le statut adaptatif (`UNVERIFIED` par défaut, ou `AUTO-APPROVED` si la criticité est maximale).