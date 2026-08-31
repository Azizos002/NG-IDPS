"""
agent_cti.py (V12 - GOD'S MODE : Triage CTI & Aiguillage Hybride)
Routage intelligent : Menaces Réseau (Suricata) vs Sensibilisation Humaine (Micro-Learning)
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
from typing import List, Any
from pydantic import BaseModel, Field, field_validator, ValidationError
from pymongo import MongoClient

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
logger = logging.getLogger("agent-cti-v12")

# ============================================================
# CHARGEMENT DU CERVEAU SYNTAXIQUE (49K RÈGLES DE RÉFÉRENCE)
# ============================================================
try:
    index_suricata = faiss.read_index(RAG_INDEX_PATH)
    conn = sqlite3.connect(RAG_DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT raw_rule FROM rules ORDER BY id ASC")
    REFERENCE_RULES = [row[0] for row in cursor.fetchall()]
    conn.close()
    logger.info(f"[+] CERVEAU SYNTAXIQUE CHARGÉ : {len(REFERENCE_RULES)} règles de référence prêtes.")
except Exception as e:
    logger.error(f"[-] Erreur chargement RAG Syntaxique : {e}")
    REFERENCE_RULES = []
    index_suricata = None

def get_reference_rules(vector: np.ndarray, top_k=2) -> List[str]:
    if index_suricata is None or vector is None or not REFERENCE_RULES:
        return []
    vec_reshaped = np.array([vector], dtype=np.float32)
    distances, indices = index_suricata.search(vec_reshaped, top_k)

    results = []
    for idx in indices[0]:
        if 0 <= idx < len(REFERENCE_RULES):
            results.append(REFERENCE_RULES[idx])
    return results

# ============================================================
# AGENT GUARDRAIL (PYDANTIC V2)
# ============================================================
class CTIActualitySchema(BaseModel):
    type_article: str = Field(default="TECHNICAL_THREAT") # TECHNICAL_THREAT, AWARENESS, NOISE
    titre_menace: str = Field(default="Menace détectée")
    resume_ia: str = Field(default="Résumé non fourni.")
    iocs_extraits: List[str] = Field(default_factory=list)
    regles_suricata: str = Field(default="N/A")
    fiabilite_score: int = Field(default=50, ge=0, le=100)

    @field_validator('type_article', mode='before')
    @classmethod
    def valider_type(cls, v: Any) -> str:
        val = str(v).upper().strip()
        if "NOISE" in val or "PUB" in val or "COMMERCIAL" in val:
            raise ValueError("Rejet : Contenu publicitaire ou hors-périmètre (NOISE).")
        if "AWARENESS" in val or "FORMATION" in val or "HUMAIN" in val:
            return "AWARENESS"
        return "TECHNICAL_THREAT"

    @field_validator('fiabilite_score', mode='before')
    @classmethod
    def valider_score(cls, v: Any) -> int:
        if v is None:
            return 50
        try:
            val = int(v)
            if val < 0:
                raise ValueError("Score négatif : Signal rejeté.")
            return max(0, min(100, val))
        except (TypeError, ValueError):
            return 50

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
        if not v or v == "N/A": return "N/A"
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
        
        # Aiguillage du statut initial
        type_art = rapport.get("type_article", "TECHNICAL_THREAT")
        initial_status = "PENDING_FORMATION" if type_art == "AWARENESS" else "PENDING"
        
        payload = {
            "titre_menace": rapport.get("titre_menace", "Menace détectée"),
            "source_osint": nom_source,
            "url_article": url_article,
            "type_article": type_art,
            "resume_ia": rapport.get("resume_ia"),
            "iocs_extraits": rapport.get("iocs_extraits", []),
            "regles_suricata": rapport.get("regles_suricata", "N/A"),
            "fiabilite_score": rapport.get("fiabilite_score", 50),
            "date_publication": datetime.datetime.now(datetime.timezone.utc),
            "status": initial_status,
            "formation_data": None
        }
        client[DB_NAME][COLLECTION_NAME].insert_one(payload)
        logger.info(f"[+] Poussé vers MongoDB [{type_art} | {initial_status}] : {payload['titre_menace'][:45]}...")
        client.close()
    except Exception as e:
        logger.error(f"[-] Erreur insertion MongoDB : {e}")

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
# ORCHESTRATEUR PRINCIPAL (TRIAGE CTI INDUSTRIEL)
# ============================================================
async def orchestrateur_veille_cti():
    logger.info("--- DÉMARRAGE DU PIPELINE (V12 - TRIAGE CTI INDUSTRIEL) ---")
    sources = await recuperer_sources_actives()
    if not sources:
        logger.warning("[-] Aucune source OSINT active trouvée.")
        return

    memoire = LocalThreatMemory(embedding_dim=DIMENSION_EMBEDDING)

    for source in sources:
        logger.info(f"\n[*] === Analyse de la source : {source['nom']} ===")
        items_a_traiter = []

        if source.get('type_source') == "RSS":
            flux = feedparser.parse(source['url'])
            for article in flux.entries[:3]:
                lien = article.get('link', article.title)
                if not article_existe_deja(lien):
                    items_a_traiter.append({
                        "lien": lien,
                        "titre": article.title,
                        "texte": f"Titre : {article.title}\nDesc : {article.get('description', '')}"
                    })

        for item in items_a_traiter:
            logger.info(f"[ANALYSTE] Examen : {item['titre'][:55]}...")
            vecteur_actuel = await obtenir_vecteur(item['texte'])

            contexte_historique = ""
            regles_references = ""

            if vecteur_actuel is not None and vecteur_actuel.size > 0:
                # Mémoire sémantique des précédentes alertes
                historique = memoire.recherche_semantique(vecteur_actuel, top_k=1)
                if historique:
                    contexte_historique = "HISTORIQUE SOC SIMILAIRE :\n" + "\n".join(historique) + "\n\n"

                # RAG Syntaxique : Règles de référence pour les menaces techniques
                refs = get_reference_rules(vecteur_actuel, top_k=2)
                if refs:
                    regles_references = "MODÈLES DE RÈGLES SURICATA DE RÉFÉRENCE :\n"
                    regles_references += "\n".join([f"- {r}" for r in refs]) + "\n\n"

            sid_osint = random.randint(9000000, 9999999)

            # PROMPT GOD'S MODE : TRIAGE & BRANCHEMENT CONDITIONNEL
            system_prompt = (
                "Tu es un Expert Triage SOC & CISO.\n"
                f"{contexte_historique}"
                f"{regles_references}"
                "MISSION : Analyse cet article et effectue un TRIAGE STRICT au format JSON avec ces clés :\n"
                "1. type_article (string): Choisis STRICTEMENT parmi :\n"
                "   - 'TECHNICAL_THREAT' : Si l'article traite d'une faille logicielle (CVE), d'un exploit réseau, malware, botnet, DDoS ou C2.\n"
                "   - 'AWARENESS' : Si l'article traite de sensibilisation, bonnes pratiques (2FA/MFA, mots de passe), phishing ciblant l'humain, ou vol de session.\n"
                "   - 'NOISE' : Si c'est une publicité, un sponsor, une offre d'emploi, un cours payant ou un webinaire marketing.\n"
                "2. titre_menace (string): Titre clair et précis.\n"
                "3. resume_ia (string): Résumé en 2 phrases vulgarisées.\n"
                "4. iocs_extraits (array de strings): Liste des IPs, domaines, hash ou CVE. Sinon [].\n"
                f"5. regles_suricata (string): \n"
                f"   - Si type_article == 'TECHNICAL_THREAT' : ADAPTE un des 'MODÈLES SURICATA DE RÉFÉRENCE' avec les nouveaux IoC, msg clair, et sid:{sid_osint}.\n"
                f"   - Si type_article == 'AWARENESS' ou 'NOISE' : Renvoie STRICTEMENT 'N/A'.\n"
                "6. fiabilite_score (int): Score de sévérité/pertinence (0 à 100). Si NOISE, renvoie -1.\n"
            )

            reponse_ia = await interroger_llm(f"{system_prompt}\nARTICLE BRUT :\n{item['texte']}")

            if reponse_ia:
                try:
                    rapport = CTIActualitySchema.model_validate(reponse_ia)
                    publier_actualite_mongodb(rapport.model_dump(), source['nom'], item['lien'])
                    logger.info(f"[GUARDRAIL] ✅ Article qualifié avec succès : [{rapport.type_article}]")

                    if vecteur_actuel is not None and vecteur_actuel.size > 0:
                        ioc_cible = rapport.iocs_extraits[0] if rapport.iocs_extraits else item['lien'][-15:]
                        memoire.sauvegarder_menace(f"OSINT_{ioc_cible}", rapport.type_article, rapport.model_dump(), vecteur_actuel)

                except ValidationError as e:
                    logger.warning(f"[GUARDRAIL] 🛑 Contenu filtré ou invalide : {e.errors()[0]['msg']}")

if __name__ == "__main__":
    asyncio.run(orchestrateur_veille_cti())