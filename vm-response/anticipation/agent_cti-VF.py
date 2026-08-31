"""
agent_cti.py (V11 - GOD'S MODE : RAG Syntaxique + Double Cerveau FAISS)
Système Multi-Agents CTI avec anticipation par analogie.
"""

import os
import json
import asyncio
import logging
import aiohttp
import hashlib
import feedparser
import datetime
import sqlite3
import numpy as np
import faiss
import random
from pydantic import BaseModel, Field, field_validator, ValidationError
from pymongo import MongoClient
from typing import List, Any

from core_memory import LocalThreatMemory

# ============================================================
# CONFIGURATION PRO MAX
# ============================================================
OLLAMA_GENERATE = "http://192.168.56.1:11434/api/generate"
OLLAMA_EMBEDDINGS = "http://192.168.56.1:11434/api/embeddings"

MODELE_OLLAMA = "llama3.2:3b"
MODELE_EMBEDDINGS = "nomic-embed-text"
DIMENSION_EMBEDDING = 768

MONGO_URI = "mongodb://192.168.56.1:27017/"
DB_NAME = "soc_dashboard"
COLLECTION_NAME = "ctiactualities"
API_SOURCES_URL = "http://192.168.56.1:4000/api/cti-sources"

RAG_INDEX_PATH = "rag_suricata.index"
RAG_DB_PATH = "rag_suricata.sqlite"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("agent-cti-v11")

# ============================================================
# CHARGEMENT DU CERVEAU SYNTAXIQUE (LES 49K RÈGLES)
# ============================================================
try:
    index_suricata = faiss.read_index(RAG_INDEX_PATH)
    conn = sqlite3.connect(RAG_DB_PATH)
    cursor = conn.cursor()
    # On charge les règles brutes en mémoire (Très léger, ~5 Mo de RAM)
    cursor.execute("SELECT raw_rule FROM rules ORDER BY id ASC")
    REFERENCE_RULES = [row[0] for row in cursor.fetchall()]
    conn.close()
    logger.info(f"[+] CERVEAU SYNTAXIQUE CHARGÉ : {len(REFERENCE_RULES)} règles de référence.")
except Exception as e:
    logger.error(f"[-] Erreur chargement RAG Syntaxique : {e}")
    REFERENCE_RULES = []
    index_suricata = None

def get_reference_rules(vector: np.ndarray, top_k=2) -> List[str]:
    if index_suricata is None or vector is None or not REFERENCE_RULES:
        return []
    # Recherche vectorielle ultra-rapide
    vec_reshaped = np.array([vector], dtype=np.float32)
    distances, indices = index_suricata.search(vec_reshaped, top_k)
    
    results = []
    for idx in indices[0]:
        if 0 <= idx < len(REFERENCE_RULES):
            results.append(REFERENCE_RULES[idx])
    return results

# ============================================================
# AGENT GUARDRAIL (PYDANTIC)
# ============================================================
class CTIActualitySchema(BaseModel):
    titre_menace: str = Field(default="Menace détectée")
    resume_ia: str = Field(default="Résumé non fourni.")
    iocs_extraits: List[str] = Field(default_factory=list)
    regles_suricata: str = Field(default="N/A")
    fiabilite_score: int = Field(default=50, ge=0, le=100)

    @field_validator('iocs_extraits', mode='before')
    @classmethod
    def nettoyer_iocs(cls, v: Any) -> List[str]:
        if not v: return []
        if isinstance(v, str): return [v.strip()]
        if isinstance(v, list): return [str(item).strip() for item in v if str(item).strip()]
        return []

    @field_validator('regles_suricata', mode='before')
    @classmethod
    def nettoyer_regle(cls, v: Any) -> str:
        if isinstance(v, dict):
            for val in v.values():
                if isinstance(val, str) and "alert " in val:
                    v = val
                    break
            else: return "N/A"
        
        if isinstance(v, list):
            v = v[0] if (len(v) > 0 and isinstance(v[0], str)) else "N/A"

        regle_propre = str(v).strip()
        if "alert " in regle_propre:
            regle_propre = regle_propre[regle_propre.index("alert "):].split('\n')[0].strip()
        else:
            return "N/A"
        
        return regle_propre.replace("'", '"')

# ============================================================
# FONCTIONS UTILITAIRES & MONGODB
# ============================================================
async def recuperer_sources_actives() -> list:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(API_SOURCES_URL, timeout=5) as response:
                if response.status == 200: return await response.json()
    except: return []

def article_existe_deja(url_article: str) -> bool:
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
        existe = client[DB_NAME][COLLECTION_NAME].find_one({"url_article": url_article}) is not None
        client.close()
        return existe
    except: return False

def publier_actualite_mongodb(rapport: dict, nom_source: str, url_article: str):
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
        payload = {
            "titre_menace": rapport.get("titre_menace", "Menace détectée"),
            "source_osint": nom_source,
            "url_article": url_article,
            "resume_ia": rapport.get("resume_ia"),
            "iocs_extraits": rapport.get("iocs_extraits", []),
            "regles_suricata": rapport.get("regles_suricata", "N/A"),
            "fiabilite_score": rapport.get("fiabilite_score", 50),
            "date_publication": datetime.datetime.now(datetime.timezone.utc)
        }
        client[DB_NAME][COLLECTION_NAME].insert_one(payload)
        logger.info(f"[+] Poussé vers MongoDB : {payload['titre_menace'][:40]}...")
        client.close()
    except Exception as e:
        logger.error(f"[-] Erreur MongoDB : {e}")

# ============================================================
# MOTEURS IA
# ============================================================
async def obtenir_vecteur(texte: str):
    payload = {"model": MODELE_EMBEDDINGS, "prompt": texte[:4000]}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(OLLAMA_EMBEDDINGS, json=payload, timeout=60) as response:
                if response.status == 200:
                    data = await response.json()
                    return np.array(data.get("embedding", []), dtype=np.float32)
    except: pass
    return None

async def interroger_llm(prompt: str) -> dict:
    payload = {"model": MODELE_OLLAMA, "prompt": prompt, "stream": False, "format": "json"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(OLLAMA_GENERATE, json=payload, timeout=300) as response:
                if response.status == 200:
                    data = await response.json()
                    return json.loads(data.get("response", "{}"))
    except: pass
    return {}

# ============================================================
# ORCHESTRATEUR PRINCIPAL (DOUBLE RAG)
# ============================================================
async def orchestrateur_veille_cti():
    logger.info("--- DÉMARRAGE DU PIPELINE (V11 - GOD'S MODE / DOUBLE RAG) ---")
    sources = await recuperer_sources_actives()
    if not sources: return

    memoire = LocalThreatMemory(embedding_dim=DIMENSION_EMBEDDING)

    for source in sources:
        logger.info(f"\n[*] === Analyse de la source : {source['nom']} ===")
        items_a_traiter = []

        if source.get('type_source') == "RSS":
            flux = feedparser.parse(source['url'])
            for article in flux.entries[:3]:
                lien = article.get('link', article.title)
                if not article_existe_deja(lien):
                    items_a_traiter.append({"lien": lien, "titre": article.title, "texte": f"Titre : {article.title}\nDesc : {article.description}"})

        for item in items_a_traiter:
            logger.info(f"[ANALYSTE] Analyse de : {item['titre'][:50]}...")
            vecteur_actuel = await obtenir_vecteur(item['texte'])
            
            contexte_historique = ""
            regles_references = ""

            if vecteur_actuel is not None and vecteur_actuel.size > 0:
                # 1er RAG : Mémoire historique (Alertes précédentes)
                historique = memoire.recherche_semantique(vecteur_actuel, top_k=1)
                if historique:
                    contexte_historique = "HISTORIQUE SOC :\n" + "\n".join(historique) + "\n\n"
                
                # 2ème RAG : Cerveau Syntaxique (Les 49k règles de Production)
                refs = get_reference_rules(vecteur_actuel, top_k=2)
                if refs:
                    regles_references = "RÈGLES SURICATA DE RÉFÉRENCE (Utilise l'une d'elles comme modèle parfait) :\n"
                    regles_references += "\n".join([f"- {r}" for r in refs]) + "\n\n"

            sid_osint = random.randint(9000000, 9999999)

            # PROMPT GOD'S MODE : L'IA ne devine plus, elle adapte !
            system_prompt = (
                "Tu es un ingénieur SOC Niveau 3.\n"
                f"{contexte_historique}"
                f"{regles_references}"
                "MISSION : Analyse cette menace et génère une réponse STRICTEMENT au format JSON avec ces clés :\n"
                "1. titre_menace (string): Titre clair.\n"
                "2. resume_ia (string): Résumé en 2 phrases.\n"
                "3. iocs_extraits (array de strings): Liste des domaines, IPs ou CVE (ex: ['cve-2026-1234', 'bad-domain.com']). Sinon [].\n"
                f"4. regles_suricata (string): ADAPTE l'une des 'RÈGLES SURICATA DE RÉFÉRENCE' ci-dessus pour contrer cette nouvelle menace. "
                f"Remplace le champ 'msg' et le champ 'content' par les nouveaux IoC. Utilise des SIMPLES QUOTES ('). Utilise le sid:{sid_osint}. "
                "Ne génère PAS de dictionnaire ici, juste la chaîne de la règle qui commence par 'alert'.\n"
                "5. fiabilite_score (int): 0 à 100.\n"
            )

            reponse_ia = await interroger_llm(f"{system_prompt}\nBULLETIN:\n{item['texte']}")

            if reponse_ia:
                try:
                    rapport = CTIActualitySchema.model_validate(reponse_ia)
                    publier_actualite_mongodb(rapport.model_dump(), source['nom'], item['lien'])
                    logger.info("[GUARDRAIL] ✅ Règle générée par Analogie Syntaxique !")

                    if vecteur_actuel is not None and vecteur_actuel.size > 0:
                        ioc_cible = rapport.iocs_extraits[0] if rapport.iocs_extraits else item['lien'][-15:]
                        memoire.sauvegarder_menace(f"OSINT_{ioc_cible}", "BULLETIN", rapport.model_dump(), vecteur_actuel)

                except ValidationError as e:
                    logger.error(f"[GUARDRAIL] ❌ Erreur : {e}")

if __name__ == "__main__":
    asyncio.run(orchestrateur_veille_cti())