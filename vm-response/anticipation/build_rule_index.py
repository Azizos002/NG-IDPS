"""
build_rule_index.py (Architecture RAG Syntaxique - Ingestion)
Script d'indexation vectorielle massif pour 65k+ règles Suricata.
"""

import os
import re
import sqlite3
import asyncio
import aiohttp
import numpy as np
import faiss
import time
import logging

# ============================================================
# CONFIGURATION PRO MAX
# ============================================================
OLLAMA_EMBEDDINGS = "http://192.168.56.1:11434/api/embeddings"
MODEL_EMBEDDINGS = "nomic-embed-text"
DIMENSION = 768

RULES_FILE = "suricata.rules"
DB_PATH = "rag_suricata.sqlite"
FAISS_PATH = "rag_suricata.index"

# Limite de requêtes simultanées pour protéger la RTX 3050 (4Go VRAM)
MAX_CONCURRENT_REQUESTS = 15 

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ingestion-rag")

# Regex scientifique pour parser les règles Suricata actives
REGEX_RULE = re.compile(
    r'^(alert\s+(?P<proto>\w+)\s+.*?\(\s*msg:\s*"(?P<msg>[^"]+)".*?(?:classtype:\s*(?P<classtype>[^;]+);)?.*?sid:\s*(?P<sid>\d+);.*?)$',
    re.IGNORECASE
)

# ============================================================
# INITIALISATION DES BASES DE DONNÉES (SQLITE & FAISS)
# ============================================================
def init_databases():
    # 1. Base relationnelle pour stocker la règle brute
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS rules (
            id INTEGER PRIMARY KEY,
            sid INTEGER UNIQUE,
            protocol TEXT,
            classtype TEXT,
            message TEXT,
            raw_rule TEXT
        )
    ''')
    conn.commit()
    
    # 2. Base vectorielle (Exact L2 Distance pour une précision maximale)
    index = faiss.IndexFlatL2(DIMENSION)
    return conn, cursor, index

# ============================================================
# MOTEUR DE VECTORISATION ASYNCHRONE
# ============================================================
async def get_embedding(session, text, semaphore):
    async with semaphore:
        payload = {"model": MODEL_EMBEDDINGS, "prompt": text}
        try:
            async with session.post(OLLAMA_EMBEDDINGS, json=payload, timeout=30) as response:
                if response.status == 200:
                    data = await response.json()
                    return np.array(data.get("embedding", []), dtype=np.float32)
        except Exception as e:
            pass
    return None

async def process_rules_batch(session, batch, semaphore, cursor, index):
    tasks = []
    valid_rules = []
    
    # Stratégie de "Semantic Bridge" : On vectorise l'intention, pas la syntaxe brute
    for rule in batch:
        semantic_text = f"Attack Type: {rule['classtype']}. Target Protocol: {rule['proto']}. Threat Description: {rule['msg']}."
        tasks.append(get_embedding(session, semantic_text, semaphore))
        valid_rules.append(rule)
        
    embeddings = await asyncio.gather(*tasks)
    
    # Filtrer les succès et insérer dans les bases
    vectors_to_add = []
    for i, emb in enumerate(embeddings):
        if emb is not None and emb.shape[0] == DIMENSION:
            rule = valid_rules[i]
            # Insertion SQLite
            try:
                cursor.execute(
                    "INSERT OR IGNORE INTO rules (sid, protocol, classtype, message, raw_rule) VALUES (?, ?, ?, ?, ?)",
                    (rule['sid'], rule['proto'], rule['classtype'], rule['msg'], rule['raw'])
                )
                db_id = cursor.lastrowid
                if db_id: # Si l'insertion a réussi (pas de doublon SID)
                    vectors_to_add.append(emb)
            except sqlite3.IntegrityError:
                pass
                
    # Insertion FAISS en bloc (Ultra performant)
    if vectors_to_add:
        index.add(np.array(vectors_to_add, dtype=np.float32))

# ============================================================
# ORCHESTRATEUR PRINCIPAL D'INGESTION
# ============================================================
async def main():
    if not os.path.exists(RULES_FILE):
        logger.error(f"[-] Fichier {RULES_FILE} introuvable. Transférez-le depuis la vm-edge !")
        return

    conn, cursor, index = init_databases()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    
    logger.info("[*] Lecture et parsing du fichier suricata.rules (65k+ lignes estimées)...")
    parsed_rules = []
    
    with open(RULES_FILE, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue # On ignore les commentaires et lignes vides
                
            match = REGEX_RULE.match(line)
            if match:
                parsed_rules.append({
                    "raw": match.group(1),
                    "proto": match.group("proto"),
                    "msg": match.group("msg"),
                    "classtype": match.group("classtype") or "unknown",
                    "sid": int(match.group("sid"))
                })

    total_rules = len(parsed_rules)
    logger.info(f"[+] Parsing terminé : {total_rules} règles actives détectées.")
    logger.info("[*] Démarrage de la vectorisation IA par lots (Batch Processing)...")

    start_time = time.time()
    batch_size = 500
    
    async with aiohttp.ClientSession() as session:
        for i in range(0, total_rules, batch_size):
            batch = parsed_rules[i:i+batch_size]
            await process_rules_batch(session, batch, semaphore, cursor, index)
            conn.commit()
            
            progression = min(i + batch_size, total_rules)
            pourcentage = (progression / total_rules) * 100
            logger.info(f"    -> Progression : {progression}/{total_rules} règles vectorisées ({pourcentage:.1f}%)")

    # Sauvegarde de l'index vectoriel sur le disque
    faiss.write_index(index, FAISS_PATH)
    conn.close()
    
    elapsed = time.time() - start_time
    logger.info(f"[🏆] INGESTION TERMINÉE EN {elapsed:.2f} SECONDES !")
    logger.info(f"[+] Base SQLite générée : {DB_PATH}")
    logger.info(f"[+] Index Vectoriel généré : {FAISS_PATH}")

if __name__ == "__main__":
    asyncio.run(main())