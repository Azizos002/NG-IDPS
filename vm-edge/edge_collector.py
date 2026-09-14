"""
edge_collector.py (Mis à jour pour 16 FEATURES - LSTM-VAE Optimized)
Producer Kafka temps réel : lit eve.json en continu (tail -f),
charge le contrat selected_features_global.json (16 features),
et transmet un vecteur complet de 16 features vers Kafka.

CHANGEMENTS:
- Passage de 32 features → 16 features (SelectKBest ANOVA)
- Schéma: selected_features.json → selected_features_global.json
- Extraction optimisée pour detecter zéro-day attacks
"""

import os
import json
import time
import logging
import numpy as np
from kafka import KafkaProducer
from collections import defaultdict

# ============================================================
# CONFIGURATION
# ============================================================
CHEMIN_EVE_JSON = "/var/log/suricata/eve.json"
KAFKA_BOOTSTRAP_SERVERS = "192.168.56.130:9092"
KAFKA_TOPIC = "network-features"  # Nouveau topic pour 16 features
KAFKA_TOPIC_ALERTS = "suricata-alerts"
KAFKA_TOPIC_LSTM_SCORES = "lstm-vae-scores"  # Topic pour les scores LSTM-VAE

SCHEMA_FEATURES = "selected_features_global.json"  # Nouveau fichier features

# Buffer pour agréger les statistiques des flows
FLOW_BUFFER_SIZE = 1000
flow_stats_buffer = defaultdict(lambda: {
    "packets_sizes": [],
    "inter_arrival_times": [],
    "last_seen": time.time()
})

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("edge-collector-16f")

# ============================================================
# CHARGEMENT DU CONTRAT DES 16 FEATURES
# ============================================================
if not os.path.exists(SCHEMA_FEATURES):
    raise FileNotFoundError(f"Le fichier {SCHEMA_FEATURES} est introuvable sur vm-edge !")

with open(SCHEMA_FEATURES, "r") as f:
    schema = json.load(f)

# Gérer les deux formats (liste ou dict)
if isinstance(schema, list):
    FEATURES_ORDRE = schema
elif isinstance(schema, dict) and "features" in schema:
    FEATURES_ORDRE = schema["features"]
else:
    FEATURES_ORDRE = schema

logger.info(f"[✓] {len(FEATURES_ORDRE)} features chargées depuis {SCHEMA_FEATURES}")
logger.info(f"    Features: {FEATURES_ORDRE}")

# ============================================================
# VALIDATION DES 16 FEATURES ATTENDUES
# ============================================================
EXPECTED_16_FEATURES = [
    'Bwd Packet Length Max', 'Bwd Packet Length Mean', 'Bwd Packet Length Std',
    'Flow IAT Std', 'Flow IAT Max', 'Fwd IAT Std', 'Fwd IAT Max',
    'Max Packet Length', 'Packet Length Mean', 'Packet Length Std',
    'Packet Length Variance', 'Average Packet Size', 'Avg Bwd Segment Size',
    'Idle Mean', 'Idle Max', 'Idle Min'
]

if len(FEATURES_ORDRE) != 16:
    logger.warning(f"[!] Attention: {len(FEATURES_ORDRE)} features trouvées, attendu 16")

# ============================================================
# EXTRACTION OPTIMISÉE DES 16 FEATURES
# ============================================================
def extraire_features(evenement: dict):
    """
    Extrait et mappe les données d'un événement EVE JSON 'flow' de Suricata
    vers le format des 16 features optimales pour LSTM-VAE.
    
    Les 16 features sélectionnées par SelectKBest ANOVA capturent:
    - Tailles de paquets (max, mean, std, variance)
    - Timing patterns (inter-arrival times, idle times)
    - Statistiques bidirectionnelles
    """
    if evenement.get("event_type") != "flow":
        return None

    flow = evenement.get("flow")
    src_ip = evenement.get("src_ip")
    dest_ip = evenement.get("dest_ip")
    src_port = evenement.get("src_port", 0)
    dest_port = evenement.get("dest_port", 0)
    
    if not flow or not src_ip:
        return None

    try:
        # Extraction des données brutes depuis Suricata
        pkts_toserver = float(flow.get("pkts_toserver", 0))
        pkts_toclient = float(flow.get("pkts_toclient", 0))
        bytes_toserver = float(flow.get("bytes_toserver", 0))
        bytes_toclient = float(flow.get("bytes_toclient", 0))
        age = float(flow.get("age", 1)) * 1000000.0  # En microsecondes
        
        # Calculs statistiques pour les 16 features
        total_bytes = bytes_toserver + bytes_toclient
        total_packets = pkts_toserver + pkts_toclient
        
        # Packet length statistics (approximations à partir des bytes)
        avg_packet_size = (total_bytes / total_packets) if total_packets > 0 else 0.0
        
        # Bwd statistics
        avg_bwd_size = (bytes_toclient / pkts_toclient) if pkts_toclient > 0 else 0.0
        
        # Idle time estimation (basé sur age et packets)
        idle_mean = age / (total_packets + 1) if total_packets > 0 else age
        idle_max = age
        idle_min = 0.0
        
        # Flow IAT (Inter-Arrival Time)
        flow_iat_mean = age / (total_packets + 1) if total_packets > 0 else 0.0
        flow_iat_std = flow_iat_mean * 0.5  # Approximation conservative
        flow_iat_max = age
        
        # Fwd/Bwd IAT
        fwd_iat_std = flow_iat_mean * 0.4 if pkts_toserver > 0 else 0.0
        fwd_iat_max = age if pkts_toserver > 0 else 0.0
        
        # Max packet length (approximation)
        max_packet_length = avg_packet_size * 2 if avg_packet_size > 0 else 0.0
        
        # Dictionnaire avec ALL les features possibles
        donnees_brutes = {
            # Les 16 features optimales SelectKBest
            "Bwd Packet Length Max": bytes_toclient if pkts_toclient > 0 else 0.0,
            "Bwd Packet Length Mean": avg_bwd_size,
            "Bwd Packet Length Std": avg_bwd_size * 0.3,  # Approximation
            "Flow IAT Std": flow_iat_std,
            "Flow IAT Max": flow_iat_max,
            "Fwd IAT Std": fwd_iat_std,
            "Fwd IAT Max": fwd_iat_max,
            "Max Packet Length": max_packet_length,
            "Packet Length Mean": avg_packet_size,
            "Packet Length Std": avg_packet_size * 0.4,  # Approximation
            "Packet Length Variance": (avg_packet_size * 0.4) ** 2,  # Approximation
            "Average Packet Size": avg_packet_size,
            "Avg Bwd Segment Size": avg_bwd_size,
            "Idle Mean": idle_mean,
            "Idle Max": idle_max,
            "Idle Min": idle_min,
            
            # Metadata (not part of 16 features but useful for logging)
            "src_ip": src_ip,
            "dest_ip": dest_ip,
            "src_port": src_port,
            "dest_port": dest_port,
            "timestamp": time.time()
        }

        # Construction du dictionnaire final respectant STRICTEMENT l'ordre des 16 features
        message_final = {cle: donnees_brutes.get(cle, 0.0) for cle in FEATURES_ORDRE}
        message_final["src_ip"] = src_ip
        message_final["dest_ip"] = dest_ip
        message_final["timestamp"] = time.time()

        return message_final

    except (TypeError, ValueError) as e:
        logger.warning(f"Événement mal formé, ignoré : {e}")
        return None


def extraire_alerte(evenement: dict):
    """Extrait les infos utiles d'un événement EVE JSON de type 'alert'."""
    if evenement.get("event_type") != "alert":
        return None

    alert = evenement.get("alert")
    src_ip = evenement.get("src_ip")
    if not alert or not src_ip:
        return None

    return {
        "source": "suricata",
        "src_ip": src_ip,
        "signature": alert.get("signature", ""),
        "severity": alert.get("severity", 3),
        "category": alert.get("category", ""),
        "timestamp": time.time(),
    }


def suivre_fichier(chemin_fichier):
    """Suit le fichier eve.json en temps réel (tail -f equivalent)."""
    import os
    if not os.path.exists(chemin_fichier):
        logger.error(f"Fichier introuvable : {chemin_fichier}. Suricata tourne-t-il ?")
        time.sleep(5)
        return

    with open(chemin_fichier, "r") as f:
        f.seek(0, 2)  # Aller à la fin du fichier
        while True:
            ligne = f.readline()
            if not ligne:
                time.sleep(0.1)
                continue
            yield ligne


def main():
    logger.info("="*70)
    logger.info("[EDGE COLLECTOR] 16-Feature LSTM-VAE Edition")
    logger.info("="*70)
    
    logger.info(f"[*] Connexion au broker Kafka {KAFKA_BOOTSTRAP_SERVERS}...")
    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        linger_ms=0,
        acks='all',
        retries=3
    )
    logger.info(f"[✓] Connecté à Kafka")
    logger.info(f"[*] Suivi du fichier {CHEMIN_EVE_JSON} en continu...")
    logger.info(f"[*] Topic output: {KAFKA_TOPIC}")
    logger.info("")

    nb_envoyes = 0
    nb_ignores = 0
    nb_alertes = 0

    try:
        for ligne in suivre_fichier(CHEMIN_EVE_JSON):
            try:
                evenement = json.loads(ligne)
            except json.JSONDecodeError:
                nb_ignores += 1
                continue

            # Extraction des 16 features
            features = extraire_features(evenement)
            if features is not None:
                producer.send(KAFKA_TOPIC, features)
                nb_envoyes += 1

            # Extraction des alertes Suricata
            alerte = extraire_alerte(evenement)
            if alerte is not None:
                producer.send(KAFKA_TOPIC_ALERTS, alerte)
                nb_alertes += 1
                logger.info(f"[🚨 ALERTE] {alerte['signature']} (src={alerte['src_ip']})")

            if features is None and alerte is None:
                nb_ignores += 1

            # Log périodique (tous les 100 events)
            if nb_envoyes % 100 == 0 and nb_envoyes > 0:
                logger.info(f"[STATS] Envoyés: {nb_envoyes} | Alertes: {nb_alertes} | Ignorés: {nb_ignores}")

    except KeyboardInterrupt:
        logger.info("\n[*] Arrêt demandé par l'utilisateur.")
    finally:
        producer.flush()
        producer.close()
        logger.info("")
        logger.info("="*70)
        logger.info("[FINAL STATS]")
        logger.info(f"  Total envoyés: {nb_envoyes}")
        logger.info(f"  Total alertes: {nb_alertes}")
        logger.info(f"  Total ignorés: {nb_ignores}")
        logger.info("="*70)


if __name__ == "__main__":
    main()