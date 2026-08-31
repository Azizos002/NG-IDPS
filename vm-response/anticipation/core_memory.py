"""
core_memory.py
Phase 4 - Mémoire Vectorielle Continue (RAG)
Moteur hybride (SQLite + FAISS) avec recherche sémantique (Similarity Search).
"""

import os
import sqlite3
import json
import logging
import numpy as np
import faiss

# Configuration du Logger
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cti-memory")

class LocalThreatMemory:
    def __init__(self, db_path="threat_intel.sqlite", faiss_path="index_faiss.bin", embedding_dim=3072):
        """
        Initialise la mémoire hybride.
        - embedding_dim : Taille du vecteur généré (3072 est la dimension exacte pour Llama 3.2 3B).
        """
        self.db_path = db_path
        self.faiss_path = faiss_path
        self.embedding_dim = embedding_dim

        # 1. Connexion et initialisation de SQLite (Le Disque)
        self.conn = sqlite3.connect(self.db_path)
        self.cursor = self.conn.cursor()
        self._creer_tables()

        # 2. Chargement de l'index FAISS (La RAM)
        self.index = self._charger_faiss()

    def _creer_tables(self):
        """Crée la table de référence si elle n'existe pas."""
        self.cursor.execute('''
            CREATE TABLE IF NOT EXISTS threat_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ioc_value TEXT UNIQUE,
                ioc_type TEXT,
                rapport_json TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        self.conn.commit()
        logger.info("[+] Base SQLite 'threat_intel' vérifiée et prête.")

    def _charger_faiss(self):
        """Charge l'index vectoriel depuis le disque s'il existe, sinon en crée un nouveau."""
        if os.path.exists(self.faiss_path):
            index = faiss.read_index(self.faiss_path)
            logger.info(f"[+] Index FAISS chargé depuis le disque ({index.ntotal} empreintes en mémoire).")
            return index
        else:
            logger.info("[-] Aucun index FAISS existant. Création d'une nouvelle mémoire vectorielle.")
            # Utilisation d'un index L2 (Distance Euclidienne), parfait pour la similarité sémantique
            return faiss.IndexFlatL2(self.embedding_dim)

    def recherche_exacte(self, ioc_value: str):
        """
        Le Fast Path (Complexité O(1)).
        Vérifie si l'IP/Domaine est déjà connu via SQL. Zéro IA sollicitée.
        """
        self.cursor.execute("SELECT rapport_json FROM threat_reports WHERE ioc_value = ?", (ioc_value,))
        resultat = self.cursor.fetchone()

        if resultat:
            return json.loads(resultat[0])
        return None

    def recherche_semantique(self, vecteur_numpy, top_k=2):
        """
        Le Moteur RAG : Cherche dans FAISS les menaces historiques les plus proches sémantiquement.
        Renvoie une liste de textes formatés pour être injectés dans le Prompt de l'IA.
        """
        if self.index.ntotal == 0:
            return [] # La mémoire est vide, rien à comparer.

        # 1. Formatage du vecteur de la nouvelle menace
        vecteur_format = np.array([vecteur_numpy], dtype=np.float32)

        # 2. Recherche mathématique dans FAISS
        # D = Distances (plus c'est bas, plus c'est similaire)
        # I = Indices (la position dans la base de données)
        D, I = self.index.search(vecteur_format, top_k)

        resultats_textuels = []
        
        # 3. Récupération du contexte dans SQLite
        for i in range(len(I[0])):
            idx_faiss = int(I[0][i])
            distance = float(D[0][i])

            # Si l'index est valide (-1 signifie aucune correspondance)
            if idx_faiss >= 0:
                # Astuce d'architecture : l'ID SQLite correspond à l'Index FAISS + 1 (Append-Only)
                sqlite_id = idx_faiss + 1
                self.cursor.execute("SELECT rapport_json FROM threat_reports WHERE id = ?", (sqlite_id,))
                row = self.cursor.fetchone()
                
                if row:
                    rapport = json.loads(row[0])
                    # On formate un résumé clair pour que l'IA le comprenne
                    contexte = f"- [Alerte Précédente : {rapport.get('titre_menace')}] : {rapport.get('resume_ia')}"
                    resultats_textuels.append(contexte)

        return resultats_textuels

    def sauvegarder_menace(self, ioc_value: str, ioc_type: str, rapport_json: dict, vecteur_numpy=None):
        """
        Sauvegarde le rapport dans SQLite et le vecteur sémantique dans FAISS.
        L'architecture est "Append-Only" (Ajout uniquement) pour synchroniser SQLite et FAISS.
        """
        try:
            # 1. Écriture du rapport dans SQLite
            self.cursor.execute(
                "INSERT INTO threat_reports (ioc_value, ioc_type, rapport_json) VALUES (?, ?, ?)",
                (ioc_value, ioc_type, json.dumps(rapport_json))
            )
            self.conn.commit()

            # 2. Mise à jour de FAISS
            if vecteur_numpy is not None:
                vecteur_format = np.array([vecteur_numpy], dtype=np.float32)
                self.index.add(vecteur_format)
                faiss.write_index(self.index, self.faiss_path)

            return True

        except sqlite3.IntegrityError:
            logger.warning(f"[!] L'IoC '{ioc_value}' existe déjà dans la base SQLite locale.")
            return False

if __name__ == "__main__":
    print("=== DÉMARRAGE DU TEST DE LA MÉMOIRE LOCALE ===")
    memoire = LocalThreatMemory()
    print("=== TEST TERMINÉ AVEC SUCCÈS ===")