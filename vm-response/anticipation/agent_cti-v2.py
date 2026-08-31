"""
agent_cti.py (V6 - Architecture Dual-Model : Llama 3.2 + Nomic)
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
from pydantic import BaseModel, Field, field_validator, ValidationError
from pymongo import MongoClient
from typing import List, Any

from core_memory import LocalThreatMemory

# ============================================================
# CONFIGURATION ET CONSTANTES (DUAL-MODEL ARCHITECTURE)
# ============================================================
OLLAMA_GENERATE = "http://192.168.56.1:11434/api/generate"
OLLAMA_EMBEDDINGS = "http://192.168.56.1:11434/api/embeddings"

MODELE_OLLAMA = "llama3.2:3b"                # Le Cerveau (Génération)
MODELE_EMBEDDINGS = "nomic-embed-text"       # Le Bibliothécaire (Vectorisation)
DIMENSION_EMBEDDING = 768                    # Dimension exacte de Nomic

MONGO_URI = "mongodb://192.168.56.1:27017/"
DB_NAME = "soc_dashboard"
COLLECTION_NAME = "ctiactualities"
API_SOURCES_URL = "http://192.168.56.1:4000/api/cti-sources"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("agent-cti-rag")

# ============================================================
# AGENT GUARDRAIL
# ============================================================
class CTIActualitySchema(BaseModel):
    titre_menace: str = Field(default="Menace non spécifiée", description="Titre clair")
    resume_ia: str = Field(default="Résumé non fourni par l'IA.", description="Résumé exécutif")
    iocs_extraits: List[str] = Field(default_factory=list, description="Liste des IPs/domaines")
    regles_suricata: str = Field(default="N/A", description="Proposition de règle Suricata")
    fiabilite_score: int = Field(default=50, ge=0, le=100, description="Score 0 à 100")

    @field_validator('iocs_extraits', mode='before')
    @classmethod
    def nettoyer_iocs(cls, v: Any) -> List[str]:
        if isinstance(v, str):
            v = v.strip().upper()
            if v in ["N/A", "NONE", "NULL", ""]: return []
            return [v]
        if isinstance(v, list):
            return [str(item) for item in v]
        return []

    @field_validator('regles_suricata', mode='before')
    @classmethod
    def nettoyer_regle(cls, v: Any) -> str:
        if isinstance(v, list):
            return str(v[0]) if len(v) > 0 else "N/A"
        if not v: return "N/A"
        return str(v)

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
        logger.error(f"[-] Impossible de joindre l'API des sources : {e}")
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
            "titre_menace": rapport.get("titre_menace"),
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
# MOTEURS IA (SÉPARÉS)
# ============================================================
async def obtenir_vecteur(texte: str):
    """Génère l'empreinte mathématique via le modèle spécialisé Nomic."""
    # Nomic gère 8192 tokens, on peut lui envoyer plus de texte sans crasher !
    texte_securise = texte[:4000] 
    payload = {"model": MODELE_EMBEDDINGS, "prompt": texte_securise} # <-- On utilise Nomic ici
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(OLLAMA_EMBEDDINGS, json=payload, timeout=60) as response:
                if response.status == 200:
                    data = await response.json()
                    return np.array(data.get("embedding", []), dtype=np.float32)
                else:
                    erreur = await response.text()
                    logger.error(f"[-] API Ollama Embeddings refusée (Code {response.status}): {erreur}")
    except Exception as e:
        logger.error(f"[-] Erreur de Vectorisation : {e}")
    return None

async def interroger_llm(prompt: str) -> dict:
    """Génère la réflexion et le JSON via le LLM Llama 3.2."""
    payload = {"model": MODELE_OLLAMA, "prompt": prompt, "stream": False, "format": "json"} # <-- On utilise Llama ici
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
    logger.info("--- DÉMARRAGE DU PIPELINE MULTI-AGENTS (DUAL-MODEL RAG) ---")

    sources = await recuperer_sources_actives()
    if not sources:
        logger.warning("[!] Aucune source active trouvée. Fin de la ronde.")
        return

    memoire = LocalThreatMemory(embedding_dim=DIMENSION_EMBEDDING)
    logger.info(f"[MÉMOIRE] Base FAISS initialisée (Dimension: {DIMENSION_EMBEDDING}).")

    for source in sources:
        logger.info(f"\n[*] === Analyse de la source : {source['nom']} (Type: {source.get('type_source')}) ===")
        
        items_a_traiter = []

        if source.get('type_source') == "RSS":
            flux = feedparser.parse(source['url'])
            for article in flux.entries[:3]:
                lien_article = article.get('link', article.title)
                if article_existe_deja(lien_article):
                    logger.info(f"[FAST PATH] ⚡ Déjà connu : {article.title[:40]}...")
                    continue
                
                items_a_traiter.append({
                    "lien": lien_article,
                    "titre_log": article.title,
                    "texte": f"Titre : {article.title}\nDescription : {article.description}"
                })

        elif source.get('type_source') == "JSON":
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(source['url'], timeout=10) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            texte_brut = json.dumps(data, indent=2)[:4000]
                            hash_contenu = hashlib.md5(texte_brut.encode('utf-8')).hexdigest()
                            lien_article = f"{source['url']}#{hash_contenu}"
                            
                            if article_existe_deja(lien_article):
                                logger.info(f"[FAST PATH] ⚡ Flux JSON non modifié. Ignoré.")
                            else:
                                items_a_traiter.append({
                                    "lien": lien_article,
                                    "titre_log": "Flux Data JSON",
                                    "texte": texte_brut
                                })
            except Exception as e:
                logger.error(f"[-] Erreur lecture JSON : {e}")

        for item in items_a_traiter:
            logger.info(f"[ANALYSTE] Encodage et résumé en cours pour : {item['titre_log'][:50]}...")

            vecteur_actuel = await obtenir_vecteur(item['texte'])
            contexte_historique = ""

            if vecteur_actuel is not None and vecteur_actuel.size > 0:
                historique = memoire.recherche_semantique(vecteur_actuel, top_k=2)
                if historique:
                    logger.info("[RAG] 🧠 Des incidents similaires ont été retrouvés dans la mémoire locale !")
                    contexte_historique = "CONTEXTE HISTORIQUE (Anciennes alertes SOC) :\n" + "\n".join(historique) + "\n\n"
            else:
                logger.warning("[!] Échec de la vectorisation Nomic. Le RAG sera ignoré pour cet article.")

            system_prompt = (
                "Tu es un analyste de Cyber Threat Intelligence de niveau 3. "
                "Analyse ce nouveau bulletin de sécurité.\n"
                f"{contexte_historique}"
                "INSTRUCTIONS STRICTES :\n"
                "1. resume_ia : Rédige un résumé exécutif complet (min. 3 phrases).\n"
                "2. regles_suricata : Tu DOIS écrire une règle Suricata stricte sur UNE SEULE LIGNE. "
                "Exemple exact: alert tcp $EXTERNAL_NET any -> $HOME_NET any (msg:'OSINT - Menace'; flow:established; sid:1000001; rev:1;) "
                "N'utilise JAMAIS de sauts de ligne (\\n) ou de format 'action:drop'. Si l'article ne donne pas de détails réseaux précis (IP, port, domaine), renvoie OBLIGATOIREMENT 'N/A'.\n"
                "3. fiabilite_score : Évalue la criticité sur 100 selon ce barème : "
                "90-100 (Attaque active), 70-89 (Vulnérabilité technique), 40-69 (Actualité SOC), 0-39 (Info générale).\n\n"
                "Réponds UNIQUEMENT en JSON avec les clés : titre_menace, resume_ia, iocs_extraits, regles_suricata, fiabilite_score."
            )

            reponse_ia = await interroger_llm(f"{system_prompt}\n\nNOUVEAU BULLETIN :\n{item['texte']}")

            if reponse_ia:
                try:
                    rapport_valide = CTIActualitySchema.model_validate(reponse_ia)
                    logger.info("[GUARDRAIL] ✅ Format JSON validé.")

                    publier_actualite_mongodb(rapport_valide.model_dump(), source['nom'], item['lien'])

                    if vecteur_actuel is not None and vecteur_actuel.size > 0:
                        ioc_cle = rapport_valide.iocs_extraits[0] if rapport_valide.iocs_extraits else item['lien']
                        memoire.sauvegarder_menace(
                            ioc_value=ioc_cle,
                            ioc_type="DOMAINE/IP",
                            rapport_json=rapport_valide.model_dump(),
                            vecteur_numpy=vecteur_actuel
                        )
                        logger.info(f"[MÉMOIRE] 💾 Empreinte Nomic ajoutée à FAISS pour l'ID : {ioc_cle[:30]}...")

                except ValidationError as e:
                    logger.error(f"[GUARDRAIL] ❌ Erreur critique de formatage IA : {e}")
                except Exception as e:
                    logger.error(f"[-] Erreur inattendue lors de la sauvegarde : {e}")

if __name__ == "__main__":
    asyncio.run(orchestrateur_veille_cti())