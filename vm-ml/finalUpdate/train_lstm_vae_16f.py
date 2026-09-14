import os
import json
import time
import logging
from collections import defaultdict, deque

import numpy as np
import joblib
import tensorflow as tf
import keras
from keras import layers, ops
from kafka import KafkaConsumer, KafkaProducer

# ============================================================
# CONFIGURATION
# ============================================================
KAFKA_BOOTSTRAP_SERVERS = "192.168.56.130:9092"
KAFKA_TOPIC = "network-features"
KAFKA_TOPIC_ALERTS = "ml-alerts"
KAFKA_GROUP_ID = "realtime-interface"

DOSSIER_MODELE = "modele_deep_lstm_vae_16features"
CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "deep_lstm_vae_16f.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "global_scaler_16f.pkl")
CHEMIN_METADATA = os.path.join(DOSSIER_MODELE, "metadata_modele.json")
SCHEMA_FEATURES = "selected_features_global.json"
CHEMIN_ACTIFS_CRITIQUES = "actifs_critiques.json"  # Fichier externe de la whitelist

TAILLE_FENETRE = 10
SEUIL_PERSISTANCE = 3  # Nombre de dépassements consécutifs avant alerte réelle

# --- GESTION DU CACHE D'AUTO-BLOCAGE (Cooldown) ---
ips_deja_bloquees = {}
COOLDOWN_BLOCAGE_SEC = 300  # 5 minutes de silence avant de pouvoir re-bloquer la même IP

# --- DÉTECTION GLOBALE ANTI-SPOOFING (BOUCLIER DDOS) ---
historique_global_paquets = deque()
SEUIL_GLOBAL_FLOOD = 300  # Plus de 300 paquets reçus (toutes IPs) en 2 sec = DDoS distribué
derniere_alerte_globale = 0.0

# --- CHARGEMENT DYNAMIQUE DE LA WHITELIST (Actifs Critiques) ---
WHITELIST_IPS = set()
if os.path.exists(CHEMIN_ACTIFS_CRITIQUES):
    try:
        with open(CHEMIN_ACTIFS_CRITIQUES, "r") as f:
            data_actifs = json.load(f)
            # Gestion flexible selon la structure du JSON
            if isinstance(data_actifs, list):
                WHITELIST_IPS = set(data_actifs)
            elif isinstance(data_actifs, dict):
                for val in data_actifs.values():
                    if isinstance(val, list):
                        WHITELIST_IPS.update(val)
                    elif isinstance(val, str):
                        WHITELIST_IPS.add(val)
        print(f"[+] Whitelist chargée avec succès : {len(WHITELIST_IPS)} actifs protégés.")
    except Exception as e:
        print(f"[-] Erreur lors du chargement de {CHEMIN_ACTIFS_CRITIQUES} : {e}")
else:
    print(f"[-] Attention : Le fichier {CHEMIN_ACTIFS_CRITIQUES} est introuvable. Aucune whitelist active.")

FENETRE_TEMPORELLE_SEC = 2.0  # Fenêtre courte d'analyse de burst
SEUIL_SPAM_PAQUETS = 80       # Plus de 80 paquets en 2 secondes par IP = Spam suspect

# Stockage de l'historique temporel par IP pour le rate-limiting
historique_paquets_ip = defaultdict(list)

# Chargement dynamique du contrat des 32 features
if not os.path.exists(SCHEMA_FEATURES):
    raise FileNotFoundError(f"Le fichier {SCHEMA_FEATURES} est introuvable. Exécute feature_selector.py d'abord.")

with open(SCHEMA_FEATURES, "r") as f:
    schema = json.load(f)

# Gérer les deux formats: liste ou dict
if isinstance(schema, list):
    FEATURES_ORDRE = schema
elif isinstance(schema, dict) and "features" in schema:
    FEATURES_ORDRE = schema["features"]
else:
    FEATURES_ORDRE = schema

NB_FEATURES = len(FEATURES_ORDRE)  # 16

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("realtime-interface")


# ============================================================
# Couches personnalisées (Modèle Deep LSTM-VAE)
# ============================================================
@keras.saving.register_keras_serializable()
class CoucheEchantillonnage(layers.Layer):
    """Inférence déterministe hors entraînement (z_mean)"""
    def call(self, inputs, training=False):
        z_mean, z_log_var = inputs
        if training:
            epsilon = keras.random.normal(shape=ops.shape(z_mean))
            return z_mean + ops.exp(0.5 * z_log_var) * epsilon
        return z_mean


@keras.saving.register_keras_serializable()
class CoucheVAELoss(layers.Layer):
    """Calcule la loss VAE (reconstruction MSE + divergence KL) via add_loss."""
    def call(self, inputs):
        x, x_reconstruit, z_mean, z_log_var = inputs
        loss_reconstruction = ops.mean(ops.square(x - x_reconstruit))
        loss_kl = -0.5 * ops.mean(1 + z_log_var - ops.square(z_mean) - ops.exp(z_log_var))
        self.add_loss(loss_reconstruction + loss_kl)
        return x_reconstruit


CUSTOM_OBJECTS = {
    "CoucheEchantillonnage": CoucheEchantillonnage,
    "CoucheVAELoss": CoucheVAELoss,
}


# ============================================================
# Chargement du modèle, du scaler et du seuil optimal calibré
# ============================================================
def charger_artefacts():
    logger.info("Chargement du modèle, du scaler et des seuils...")

    modele = keras.models.load_model(
        CHEMIN_MODELE,
        custom_objects=CUSTOM_OBJECTS,
        safe_mode=False,
    )
    scaler = joblib.load(CHEMIN_SCALER)

    with open(CHEMIN_METADATA) as f:
        metadata = json.load(f)

    # Récupération du seuil global 1-sigma et des seuils individuels
    seuil_1sigma_baseline = float(metadata.get("seuil_1sigma_baseline", 26.095900))
    seuil = np.array(metadata.get("feature_p98_thresholds", [seuil_1sigma_baseline]*NB_FEATURES), dtype=np.float32)

    logger.info(f"Modèle chargé avec succès. {NB_FEATURES} features attendues.")
    logger.info(f"Stratégie active : Hybride (Votes >= 4 OU MSE global >= {seuil_1sigma_baseline:.2f})")
    return modele, scaler, seuil, seuil_1sigma_baseline


@tf.function(reduce_retracing=True)
def inference_compilee(modele, x):
    return modele(x, training=False)


def warm_up(modele):
    """Force la compilation du graphe avant de traiter du vrai trafic."""
    logger.info("Warm-up du modèle en cours...")
    exemple_factice = np.zeros((1, TAILLE_FENETRE, NB_FEATURES), dtype=np.float32)
    _ = inference_compilee(modele, exemple_factice)
    logger.info("Warm-up terminé.")


# ============================================================
# État par IP source (buffer glissant + compteur de persistance)
# ============================================================
buffers_par_ip = defaultdict(lambda: deque(maxlen=TAILLE_FENETRE))
# Stockage de l'historique des 5 dernières évaluations par IP (fenêtre glissante)
historique_evaluations_ip = defaultdict(lambda: deque(maxlen=5))


def extraire_features(message: dict):
    """Extrait le vecteur des 32 features dans le bon ordre depuis un message Kafka."""
    try:
        premier_champ = message.get(FEATURES_ORDRE[0])
        if premier_champ == FEATURES_ORDRE[0] or str(premier_champ).strip().isalpha():
            return None  # Ignore l'en-tête proprement

        return [float(message[cle]) for cle in FEATURES_ORDRE]
    except (KeyError, TypeError, ValueError) as e:
        return None


def traiter_message(message: dict, modele, scaler, feature_thresholds, seuil_1sigma_baseline, producer_alertes):
    global derniere_alerte_globale
    src_ip = message.get("src_ip")
    if not src_ip:
        return

    temps_actuel = time.time()

    # =================================================================
    # 1. PRÉ-FILTRE VOLUMÉTRIQUE GLOBAL (Avant l'IA)
    # =================================================================
    historique_global_paquets.append(temps_actuel)
    while len(historique_global_paquets) > 0 and (temps_actuel - historique_global_paquets[0]) > 2.0:
        historique_global_paquets.popleft()

    if len(historique_global_paquets) > SEUIL_GLOBAL_FLOOD:
        if (temps_actuel - derniere_alerte_globale) > 30.0:
            derniere_alerte_globale = temps_actuel
            logger.critical("🚨 ATTAQUE DDOS DISTRIBUÉE DÉTECTÉE ! DÉCLENCHEMENT DU BOUCLIER SOAR 🚨")

            producer_alertes.send(KAFKA_TOPIC_ALERTS, {
                "action": "ENABLE_DDOS_SHIELD",
                "source": "hybrid-global-burst-engine",
                "src_ip": "MULTIPLE_SPOOFED_IPS",
                "threatType": "DDoS Volumétrique par Usurpation d'IP (Spoofing)",
                "timestamp": temps_actuel,
                "mse": 99.99,
                "seuil": float(seuil_1sigma_baseline)
            })
            producer_alertes.flush()
        return

    # =================================================================
    # 2. ANALYSE COMPORTEMENTALE IA (LSTM-VAE) & HYBRID VOTING (OR LOGIC)
    # =================================================================
    features = extraire_features(message)
    if features is None:
        return

    # --- RATE-LIMITING PAR IP ---
    historique_paquets_ip[src_ip] = [t for t in historique_paquets_ip[src_ip] if (temps_actuel - t) <= FENETRE_TEMPORELLE_SEC]
    historique_paquets_ip[src_ip].append(temps_actuel)

    nb_paquets_recents = len(historique_paquets_ip[src_ip])
    spam_detecte = nb_paquets_recents >= SEUIL_SPAM_PAQUETS

    # --- BUFFER GLISSANT ---
    buffer = buffers_par_ip[src_ip]
    buffer.append(features)

    if len(buffer) < TAILLE_FENETRE:
        return

    # --- Normalisation et inférence ---
    sequence_brute = np.array(buffer, dtype=np.float32)
    sequence_norm = np.clip(scaler.transform(sequence_brute), 0.0, 1.0)
    sequence_norm = sequence_norm.reshape(1, TAILLE_FENETRE, NB_FEATURES).astype(np.float32)

    debut = time.time()
    reconstruction = inference_compilee(modele, sequence_norm)
    latence_ms = (time.time() - debut) * 1000

    # --- CALCUL HYBRIDE (VOTES + SEUIL GLOBAL 1-SIGMA) ---
    reconstructed_array = np.array(reconstruction) # shape (1, 10, 16)

    # Erreur MSE feature par feature sur la fenêtre temporelle -> shape (16,)
    feature_errors = np.mean(np.square(sequence_norm - reconstructed_array), axis=1)[0] * 1000.0

    # MSE global pour les logs
    mse_global = float(np.mean(feature_errors))

    # Vote de consensus : au moins 4 features violent leurs seuils individuels
    exceed_matrix = feature_errors > feature_thresholds
    vote_count = int(np.sum(exceed_matrix))

    # --- CONDITION HYBRIDE (OR logique) ---
    anomalie_ml_stricte = (vote_count >= 4) or (mse_global >= seuil_1sigma_baseline)

    # --- LOGIQUE DE CORRÉLATION HYBRIDE (Fenêtre Glissante) ---
    anomalie_actuelle = 1 if (anomalie_ml_stricte or spam_detecte) else 0

    if spam_detecte and not anomalie_ml_stricte:
        logger.warning(f"[RATE-LIMITER] Trafic anormalement massif détecté sur {src_ip} ({nb_paquets_recents} p/2s) !")

    # Ajout du statut du paquet actuel dans l'historique de l'IP (max 5 éléments)
    historique_evaluations_ip[src_ip].append(anomalie_actuelle)

    # Le score de persistance est le nombre total d'anomalies dans la fenêtre récente
    score_persistance = sum(historique_evaluations_ip[src_ip])

    logger.info(
        f"IP={src_ip} | MSE_global={mse_global:.4f} (Seuil 1σ={seuil_1sigma_baseline:.2f}) | "
        f"Votes={vote_count}/16 features | paquets_2s={nb_paquets_recents} | "
        f"Anomalies récentes={score_persistance}/5 | latence={latence_ms:.3f}ms"
    )

    # --- DÉCLENCHEMENT DE L'ALERTE / AUTO-BLOCAGE ---
    # Si l'IP cumule au moins SEUIL_PERSISTANCE (ex: 3) anomalies sur ses 5 derniers paquets
    if score_persistance >= SEUIL_PERSISTANCE:
        if src_ip in WHITELIST_IPS:
            logger.error(f"*** SÉCURITÉ WHITELIST *** IP critique {src_ip} signalée suspecte mais PROTÉGÉE du blocage !")
        else:
            executer_auto_block(src_ip, mse_global, seuil_1sigma_baseline, latence_ms, producer_alertes)

        # Réinitialiser l'historique de cette IP après déclenchement du blocage
        historique_evaluations_ip[src_ip].clear()


def executer_auto_block(src_ip, mse, seuil, latence_ms, producer_alertes):
    temps_actuel = time.time()

    # Vérifie si l'IP a été bloquée récemment (mécanisme de Cooldown anti-spam)
    if src_ip in ips_deja_bloquees:
        temps_ecoule = temps_actuel - ips_deja_bloquees[src_ip]
        if temps_ecoule < COOLDOWN_BLOCAGE_SEC:
            return  # On ignore silencieusement, l'IP est encore sous cooldown

    # On enregistre (ou met à jour) le moment du blocage
    ips_deja_bloquees[src_ip] = temps_actuel

    logger.critical(
        f"*** AUTO-BLOCK DÉCLENCHÉ *** Isolation de l'IP malveillante : {src_ip} | MSE={mse:.4f} "
        f"(seuil={seuil:.4f}) | latence={latence_ms:.3f}ms"
    )
    producer_alertes.send(KAFKA_TOPIC_ALERTS, {
        "action": "AUTO_BLOCK_IP",
        "source": "hybrid-lstm-vae-burst-engine",
        "src_ip": src_ip,
        "mse": mse,
        "seuil": seuil,
        "timestamp": temps_actuel,
    })
    producer_alertes.flush()


# ============================================================
# MAIN — boucle de consommation Kafka
# ============================================================
def main():
    modele, scaler, feature_thresholds, seuil_1sigma_baseline = charger_artefacts()
    warm_up(modele)

    producer_alertes = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )

    logger.info(f"Connexion au topic Kafka '{KAFKA_TOPIC}'...")
    consumer = KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id=KAFKA_GROUP_ID,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        auto_offset_reset="latest",
    )
    logger.info("Interface temps réel démarrée. En attente de messages Kafka... (Ctrl+C pour arrêter)")

    try:
        for record in consumer:
            traiter_message(
                record.value,
                modele,
                scaler,
                feature_thresholds,
                seuil_1sigma_baseline,
                producer_alertes
            )
    except KeyboardInterrupt:
        logger.info("Arrêt demandé par l'utilisateur.")
    finally:
        consumer.close()
        producer_alertes.close()


if __name__ == "__main__":
    main()