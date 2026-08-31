"""
agent_cti.py (V9 - Few-Shot Prompting & Guardrail Anti-Hallucination)
Système Multi-Agents CTI avec Mémoire Vectorielle Continue.
"""

import os
import json
import asyncio
import logging
import aiohttp
import hashlib
import feedparser
import datetime
import numpy as np
import random
from pydantic import BaseModel, Field, field_validator, ValidationError
from pymongo import MongoClient
from typing import List, Any

from core_memory import LocalThreatMemory

# ============================================================
# CONFIGURATION ET CONSTANTES
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("agent-cti-rag")

# ============================================================
# AGENT GUARDRAIL (BLINDAGE ANTI-HALLUCINATION LLM)
# ============================================================
class CTIActualitySchema(BaseModel):
    titre_menace: str = Field(default="Menace non spécifiée", description="Titre clair")
    resume_ia: str = Field(default="Résumé non fourni.", description="Résumé exécutif")
    iocs_extraits: List[str] = Field(default_factory=list, description="Liste des IPs/domaines")
    regles_suricata: str = Field(default="N/A", description="Proposition de règle Suricata")
    fiabilite_score: int = Field(default=50, ge=0, le=100, description="Score 0 à 100")

    @field_validator('iocs_extraits', mode='before')
    @classmethod
    def nettoyer_iocs(cls, v: Any) -> List[str]:
        if not v: return []
        elements_invalides = {"N/A", "NONE", "NULL", "UNKNOWN", "NIL", "", "C2-MALWARE.COM", "API/V4/VULN"}
        if isinstance(v, str):
            v_clean = v.strip().upper()
            return [] if v_clean in elements_invalides else [v.strip()]
        if isinstance(v, list):
            return [str(item).strip() for item in v if str(item).strip().upper() not in elements_invalides]
        return []

    @field_validator('regles_suricata', mode='before')
    @classmethod
    def nettoyer_regle(cls, v: Any) -> str:
        # 1. Si l'IA hallucine et génère un dictionnaire JSON dans le champ
        if isinstance(v, dict):
            # On cherche désespérément une chaîne qui ressemble à une règle Suricata
            for key, val in v.items():
                if isinstance(val, str) and val.strip().startswith("alert"):
                    v = val
                    break
                elif isinstance(val, list) and len(val) > 0 and isinstance(val[0], str) and val[0].startswith("alert"):
                    v = val[0]
                    break
            else:
                return "N/A"
        
        # 2. Si l'IA renvoie une liste
        if isinstance(v, list):
            v = v[0] if (len(v) > 0 and isinstance(v[0], str)) else "N/A"

        # 3. Nettoyage final de la chaîne
        regle_propre = str(v).strip()
        if not regle_propre or regle_propre.upper() in ["N/A", "NONE", "NULL", ""]:
            return "N/A"
        
        # Transformation des simples quotes en doubles quotes pour Suricata
        return regle_propre.replace("'", '"')

    @field_validator('fiabilite_score', mode='before')
    @classmethod
    def nettoyer_score(cls, v: Any) -> int:
        try:
            if isinstance(v, str) and "/" in v: v = v.split("/")[0]
            return max(0, min(100, int(v)))
        except (ValueError, TypeError):
            return 50

# ============================================================
# FONCTIONS UTILITAIRES & MONGODB
# ============================================================
async def recuperer_sources_actives() -> list:
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(API_SOURCES_URL, timeout=5) as response:
                if response.status == 200: return await response.json()
    except Exception as e:
        logger.error(f"[-] Erreur API Sources : {e}")
    return []

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
        logger.info(f"[+] Actualité poussée vers MongoDB : {payload['titre_menace'][:40]}...")
        client.close()
    except Exception as e:
        logger.error(f"[-] Erreur MongoDB : {e}")

# ============================================================
# MOTEURS IA
# ============================================================
async def obtenir_vecteur(texte: str):
    texte_securise = texte[:4000]
    payload = {"model": MODELE_EMBEDDINGS, "prompt": texte_securise}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(OLLAMA_EMBEDDINGS, json=payload, timeout=60) as response:
                if response.status == 200:
                    data = await response.json()
                    return np.array(data.get("embedding", []), dtype=np.float32)
    except Exception as e:
        logger.error(f"[-] Erreur Vectorisation : {e}")
    return None

async def interroger_llm(prompt: str) -> dict:
    payload = {"model": MODELE_OLLAMA, "prompt": prompt, "stream": False, "format": "json"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(OLLAMA_GENERATE, json=payload, timeout=300) as response:
                if response.status == 200:
                    data = await response.json()
                    return json.loads(data.get("response", "{}"))
    except Exception as e:
        logger.error(f"[-] Erreur IA : {e}")
    return {}

# ============================================================
# ORCHESTRATEUR PRINCIPAL
# ============================================================
async def orchestrateur_veille_cti():
    logger.info("--- DÉMARRAGE DU PIPELINE MULTI-AGENTS (V9 - FEW-SHOT) ---")
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
                    items_a_traiter.append({
                        "lien": lien,
                        "titre": article.title,
                        "texte": f"Titre : {article.title}\nDesc : {article.description}"
                    })

        elif source.get('type_source') == "JSON":
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(source['url'], timeout=10) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            texte_brut = json.dumps(data, indent=2)[:4000]
                            hash_contenu = hashlib.md5(texte_brut.encode('utf-8')).hexdigest()
                            lien = f"{source['url']}#{hash_contenu}"
                            if not article_existe_deja(lien):
                                items_a_traiter.append({
                                    "lien": lien,
                                    "titre": "Flux Data JSON",
                                    "texte": texte_brut
                                })
            except Exception as e:
                logger.error(f"[-] Erreur lecture JSON : {e}")

        for item in items_a_traiter:
            logger.info(f"[ANALYSTE] Analyse de : {item['titre'][:50]}...")
            vecteur_actuel = await obtenir_vecteur(item['texte'])
            contexte_historique = ""

            if vecteur_actuel is not None and vecteur_actuel.size > 0:
                historique = memoire.recherche_semantique(vecteur_actuel, top_k=2)
                if historique:
                    contexte_historique = "CONTEXTE HISTORIQUE :\n" + "\n".join(historique) + "\n\n"

            sid_osint = random.randint(9000000, 9999999)

            # LE PROMPT FEW-SHOT (L'Exemple Parfait pour Llama 3B)
            system_prompt = (
                "Tu es un analyste CTI et un ingénieur NIDS Suricata Tier 3.\n"
                f"{contexte_historique}"
                "MISSION : Analyse le bulletin de sécurité et génère une réponse STRICTEMENT au format JSON.\n\n"
                "CONSIGNES POUR LES CHAMPS JSON :\n"
                "1. titre_menace : Donne un titre court et précis (ex: 'Faille critique GitLab').\n"
                "2. resume_ia : Résumé technique (2 ou 3 phrases max).\n"
                "3. iocs_extraits : Liste des IPs, domaines ou CVE présents dans le texte. Si aucun, renvoie [].\n"
                f"4. regles_suricata : Rédige UNE SEULE LIGNE de règle Suricata (utilise le SID {sid_osint}). "
                "Utilise des simples quotes (') pour msg et content, jamais de guillemets doubles. "
                "N'invente pas de dictionnaire JSON pour ce champ, écris juste la chaîne de caractères. Si aucune règle n'est possible, renvoie 'N/A'.\n"
                "5. fiabilite_score : Note de 0 à 100.\n\n"
                "EXEMPLE DE RÉPONSE EXACTEMENT ATTENDUE :\n"
                "{\n"
                "  \"titre_menace\": \"Exploitation de la faille Mattermost\",\n"
                "  \"resume_ia\": \"Une faille Web permet de contourner l'authentification.\",\n"
                "  \"iocs_extraits\": [\"CVE-2026-1234\"],\n"
                "  \"regles_suricata\": \"alert http $EXTERNAL_NET any -> $HTTP_SERVERS any (msg:'[OSINT CTI] Exploitation Web'; http.uri; content:'/api/v4'; classtype:web-application-attack; sid:9999999; rev:1;)\",\n"
                "  \"fiabilite_score\": 85\n"
                "}"
            )

            reponse_ia = await interroger_llm(f"{system_prompt}\nBULLETIN À ANALYSER:\n{item['texte']}")

            if reponse_ia:
                try:
                    rapport = CTIActualitySchema.model_validate(reponse_ia)
                    publier_actualite_mongodb(rapport.model_dump(), source['nom'], item['lien'])
                    logger.info("[GUARDRAIL] ✅ Format validé et exporté.")

                    if vecteur_actuel is not None and vecteur_actuel.size > 0:
                        ioc_cle = rapport.iocs_extraits[0] if rapport.iocs_extraits else item['lien'][-15:]
                        memoire.sauvegarder_menace(f"OSINT_{ioc_cle}", "BULLETIN", rapport.model_dump(), vecteur_actuel)

                except ValidationError as e:
                    logger.error(f"[GUARDRAIL] ❌ Erreur : {e}")

if __name__ == "__main__":
    asyncio.run(orchestrateur_veille_cti())