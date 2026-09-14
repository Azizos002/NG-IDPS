"""
edge_collector.py (Mis à jour pour 32 Features)
Producer Kafka temps réel : lit eve.json en continu (tail -f),
charge le contrat selected_features.json, et transmet un vecteur
complet de 32 features par flux vers Kafka.
"""
import os
import json
import time
import logging
from kafka import KafkaProducer

# ============================================================
# CONFIGURATION
# ============================================================
CHEMIN_EVE_JSON = "/var/log/suricata/eve.json"
KAFKA_BOOTSTRAP_SERVERS = "192.168.56.130:9092"
KAFKA_TOPIC = "network-features"
KAFKA_TOPIC_ALERTS = "suricata-alerts"
SCHEMA_FEATURES = "selected_features.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("edge-collector")

# Chargement du contrat des 32 features
if not os.path.exists(SCHEMA_FEATURES):
    raise FileNotFoundError(f"Le fichier {SCHEMA_FEATURES} est introuvable sur vm-edge !")

with open(SCHEMA_FEATURES, "r") as f:
    schema = json.load(f)

FEATURES_ORDRE = schema["features"]


def extraire_features(evenement: dict):
    """
    Extrait et mappe les données d'un événement EVE JSON 'flow' de Suricata
    vers le format des 32 features attendu par le modèle LSTM-VAE.
    """
    if evenement.get("event_type") != "flow":
        return None

    flow = evenement.get("flow")
    src_ip = evenement.get("src_ip")
    if not flow or not src_ip:
        return None

    try:
        # Dictionnaire de base avec les champs natifs de Suricata
        # (Les champs statistiques complexes non fournis par Suricata sont initialisés à 0.0)
        donnees_brutes = {
            "Destination Port": float(evenement.get("dest_port", 0)),
            "Flow Duration": float(flow.get("age", 1) * 1000000.0), # Estimation en microsecondes
            "Total Fwd Packets": float(flow.get("pkts_toserver", 0)),
            "Fwd Packet Length Max": float(flow.get("bytes_toserver", 0)), # Approximation sécurisée
            "Fwd Packet Length Min": 0.0,
            "Fwd Packet Length Mean": 0.0,
            "Bwd Packet Length Max": float(flow.get("bytes_toclient", 0)),
            "Bwd Packet Length Min": 0.0,
            "Flow Bytes/s": float(flow.get("bytes_toserver", 0) + flow.get("bytes_toclient", 0)),
            "Flow Packets/s": float(flow.get("pkts_toserver", 0) + flow.get("pkts_toclient", 0)),
            "Flow IAT Mean": 0.0,
            "Flow IAT Std": 0.0,
            "Flow IAT Min": 0.0,
            "Fwd IAT Std": 0.0,
            "Bwd IAT Std": 0.0,
            "Fwd PSH Flags": 0.0,
            "Fwd Header Length": 0.0,
            "Bwd Header Length": 0.0,
            "Bwd Packets/s": float(flow.get("pkts_toclient", 0)),
            "Min Packet Length": 0.0,
            "FIN Flag Count": 0.0,
            "PSH Flag Count": 0.0,
            "ACK Flag Count": 0.0,
            "URG Flag Count": 0.0,
            "Down/Up Ratio": 0.0,
            "Init_Win_bytes_forward": 0.0,
            "Init_Win_bytes_backward": 0.0,
            "min_seg_size_forward": 0.0,
            "Active Mean": 0.0,
            "Active Std": 0.0,
            "Active Max": 0.0,
            "Idle Std": 0.0,
            "src_ip": src_ip,
            "timestamp": time.time()
        }

        # Construction du dictionnaire final respectant STRICTEMENT l'ordre des 32 features du JSON
        message_final = {cle: donnees_brutes.get(cle, 0.0) for cle in FEATURES_ORDRE}
        message_final["src_ip"] = src_ip # S'assure que l'IP est bien présente pour le regroupement

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
    logger.info(f"Connexion au broker Kafka {KAFKA_BOOTSTRAP_SERVERS}...")
    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        linger_ms=0,
    )
    logger.info(f"Suivi du fichier {CHEMIN_EVE_JSON} en continu...")

    nb_envoyes = 0
    nb_ignores = 0

    try:
        for ligne in suivre_fichier(CHEMIN_EVE_JSON):
            try:
                evenement = json.loads(ligne)
            except json.JSONDecodeError:
                nb_ignores += 1
                continue

            features = extraire_features(evenement)
            if features is not None:
                producer.send(KAFKA_TOPIC, features)
                nb_envoyes += 1

            alerte = extraire_alerte(evenement)
            if alerte is not None:
                producer.send(KAFKA_TOPIC_ALERTS, alerte)
                logger.info(f"Alerte Suricata transmise : {alerte['signature']} (IP={alerte['src_ip']})")

            if features is None and alerte is None:
                nb_ignores += 1

            if nb_envoyes % 100 == 0 and nb_envoyes > 0:
                logger.info(f"Envoyés: {nb_envoyes} | Ignorés: {nb_ignores}")

    except KeyboardInterrupt:
        logger.info("Arrêt demandé par l'utilisateur.")
    finally:
        producer.flush()
        producer.close()
        logger.info(f"Total final -> Envoyés: {nb_envoyes} | Ignorés: {nb_ignores}")


if __name__ == "__main__":
    main()