"""
train_lstm_vae_16f.py (PATCHED)
Architecture Deep LSTM-VAE optimisée (16 features universelles)
Entraînement strict sur le trafic BENIGN global (global_benign_train_16f.csv)

CORRECTIF appliqué : le script original ne calculait et ne sauvegardait que
"seuil_3sigma_baseline" dans metadata_modele.json. Or realtime_interface.py
et evaluate_global_model.py utilisent "seuil_1sigma_baseline" et
"feature_p98_thresholds", qui n'étaient JAMAIS produits par l'entraînement
-> ces scripts retombaient silencieusement sur une valeur par défaut/codée en
dur, potentiellement calibrée pour un modèle antérieur, jamais pour CELUI
qui vient d'être entraîné. Ce script calcule maintenant les deux et les
persiste à chaque entraînement.
"""

import os
import time
import json
import numpy as np
import pandas as pd
import joblib

import keras
from keras import layers, ops, Model
from keras.callbacks import EarlyStopping
from sklearn.preprocessing import MinMaxScaler

# ============================================================
# CONFIGURATION HYPERPARAMÈTRES
# ============================================================
TAILLE_FENETRE = 10
DIM_LATENTE = 16
EPOCHS_MAX = 50
PATIENCE = 10
BATCH_SIZE = 128
RATIO_VALIDATION = 0.2
PERCENTILE_VOTE = 98  # doit rester cohérent avec le vote par feature en production

CHEMIN_DONNEES_TRAIN = "global_benign_train_16f.csv"
SCHEMA_FEATURES = "selected_features_global.json"
DOSSIER_SORTIE = "modele_deep_lstm_vae_16features"

# ============================================================
# CHARGEMENT DU SCHÉMA ET VÉRIFICATION
# ============================================================
if not os.path.exists(SCHEMA_FEATURES):
    raise FileNotFoundError(f"Le fichier {SCHEMA_FEATURES} est introuvable. Exécutez le script de sélection d'abord.")

with open(SCHEMA_FEATURES, "r") as f:
    FEATURES = json.load(f)  # Liste des 16 features universelles

NB_FEATURES = len(FEATURES)
print(f"[*] Contrat de features chargé : {NB_FEATURES} variables universelles.")
assert NB_FEATURES == 16, f"Erreur fatale : 16 features attendues, mais {NB_FEATURES} trouvées."


# ============================================================
# PRÉPARATION DES DONNÉES
# ============================================================
def charger_et_normaliser(chemin_csv, scaler=None):
    df = pd.read_csv(chemin_csv)

    missing = [f for f in FEATURES if f not in df.columns]
    if missing:
        raise ValueError(f"Features absentes du dataset : {missing}")

    df = df[FEATURES]
    features_brutes = df.values.astype(np.float32)

    if scaler is None:
        scaler = MinMaxScaler()
        features_norm = scaler.fit_transform(features_brutes)
    else:
        features_norm = scaler.transform(features_brutes)

    return np.clip(features_norm, 0.0, 1.0), scaler


def construire_sequences(data, taille_fenetre):
    nb_sequences = len(data) - taille_fenetre + 1
    if nb_sequences <= 0:
        return np.array([])
    sequences = np.zeros((nb_sequences, taille_fenetre, data.shape[1]), dtype=np.float32)
    for i in range(nb_sequences):
        sequences[i] = data[i : i + taille_fenetre]
    return sequences


# ============================================================
# ARCHITECTURE DU MODÈLE (Déterministe à l'inférence)
# ============================================================
@keras.utils.register_keras_serializable()
class CoucheEchantillonnage(layers.Layer):
    def call(self, inputs, training=False):
        z_mean, z_log_var = inputs
        if training:
            epsilon = keras.random.normal(shape=ops.shape(z_mean))
            return z_mean + ops.exp(0.5 * z_log_var) * epsilon
        return z_mean


@keras.utils.register_keras_serializable()
class CoucheVAELoss(layers.Layer):
    def call(self, inputs):
        x, x_reconstruit, z_mean, z_log_var = inputs
        loss_reconstruction = ops.mean(ops.square(x - x_reconstruit))
        loss_kl = -0.5 * ops.mean(1 + z_log_var - ops.square(z_mean) - ops.exp(z_log_var))
        self.add_loss(loss_reconstruction + loss_kl)
        return x_reconstruit


def construire_modele(taille_fenetre, nb_features, dim_latente):
    entree = layers.Input(shape=(taille_fenetre, nb_features), name="sequence_entree")

    x = layers.LSTM(64, activation="tanh", return_sequences=True)(entree)
    x = layers.LSTM(32, activation="tanh", return_sequences=False)(x)

    z_mean = layers.Dense(dim_latente, name="z_mean")(x)
    z_log_var = layers.Dense(dim_latente, name="z_log_var")(x)
    z = CoucheEchantillonnage()([z_mean, z_log_var])

    x = layers.RepeatVector(taille_fenetre)(z)
    x = layers.LSTM(32, activation="tanh", return_sequences=True)(x)
    x = layers.LSTM(64, activation="tanh", return_sequences=True)(x)

    sortie = layers.TimeDistributed(layers.Dense(nb_features, activation="sigmoid"))(x)
    sortie_avec_loss = CoucheVAELoss()([entree, sortie, z_mean, z_log_var])

    modele = Model(entree, sortie_avec_loss)
    modele.compile(optimizer="adam")
    return modele


def calculer_erreurs_mse(modele, sequences, batch_size=512):
    """Erreur MSE globale par séquence (moyenne sur temps ET features), x1000."""
    reconstructions = modele.predict(sequences, batch_size=batch_size, verbose=0)
    erreurs = np.mean(np.square(sequences - reconstructions), axis=(1, 2))
    return erreurs * 1000.0


def calculer_erreurs_par_feature(modele, sequences, batch_size=512):
    """Erreur de reconstruction PAR FEATURE (moyenne sur le temps seulement), x1000.
    IDENTIQUE au calcul de feature_errors dans realtime_interface.py -- nécessaire
    pour que feature_p98_thresholds soit sur la même échelle que le vote en prod."""
    reconstructions = modele.predict(sequences, batch_size=batch_size, verbose=0)
    return np.mean(np.square(sequences - reconstructions), axis=1) * 1000.0


# ============================================================
# MAIN
# ============================================================
def main():
    os.makedirs(DOSSIER_SORTIE, exist_ok=True)

    print("[1/6] Chargement et normalisation (Validation du Contrat JSON)...")
    features_norm, scaler = charger_et_normaliser(CHEMIN_DONNEES_TRAIN)

    print("[2/6] Split Train/Val AVANT la création des séquences (Anti-Fuite)...")
    idx_split = int(len(features_norm) * (1 - RATIO_VALIDATION))
    features_train = features_norm[:idx_split]
    features_val = features_norm[idx_split:]

    print("[3/6] Construction séquences...")
    sequences_train = construire_sequences(features_train, TAILLE_FENETRE)
    sequences_val = construire_sequences(features_val, TAILLE_FENETRE)

    print("[4/6] Entraînement du Deep LSTM-VAE (16 Features)...")
    modele = construire_modele(TAILLE_FENETRE, NB_FEATURES, DIM_LATENTE)
    arbitre = EarlyStopping(monitor="val_loss", patience=PATIENCE, restore_best_weights=True)

    t0 = time.time()
    historique = modele.fit(
        sequences_train, sequences_train,
        validation_data=(sequences_val, sequences_val),
        epochs=EPOCHS_MAX, batch_size=BATCH_SIZE, callbacks=[arbitre], verbose=1
    )
    duree = time.time() - t0

    print("[5/6] Calcul des seuils de calibration (global 1-sigma/3-sigma + P98 par feature)...")
    erreurs_val_globales = calculer_erreurs_mse(modele, sequences_val)
    mu = float(np.mean(erreurs_val_globales))
    sigma = float(np.std(erreurs_val_globales))
    seuil_1sigma = mu + 1 * sigma
    seuil_3sigma = mu + 3 * sigma
    print(f"        -> mu={mu:.4f}  sigma={sigma:.4f}")
    print(f"        -> Baseline 1-Sigma (utilisée en production) : {seuil_1sigma:.4f}")
    print(f"        -> Baseline 3-Sigma (référence)               : {seuil_3sigma:.4f}")

    erreurs_val_par_feature = calculer_erreurs_par_feature(modele, sequences_val)
    feature_p98_thresholds = np.percentile(erreurs_val_par_feature, PERCENTILE_VOTE, axis=0).tolist()
    print(f"        -> {len(feature_p98_thresholds)} seuils P98 par feature calculés.")

    print("[6/6] Exportation des artefacts industriels...")
    modele.save(os.path.join(DOSSIER_SORTIE, "deep_lstm_vae_16f.keras"))
    joblib.dump(scaler, os.path.join(DOSSIER_SORTIE, "global_scaler_16f.pkl"))

    metadata = {
        "architecture": f"LSTM-VAE (64-32-{DIM_LATENTE}-32-64)",
        "taille_fenetre": TAILLE_FENETRE,
        "nb_features": NB_FEATURES,
        "mu_validation": mu,
        "sigma_validation": sigma,
        "seuil_1sigma_baseline": seuil_1sigma,
        "seuil_3sigma_baseline": seuil_3sigma,
        "feature_p98_thresholds": feature_p98_thresholds,
        "duree_entrainement_sec": round(duree, 2),
    }
    with open(os.path.join(DOSSIER_SORTIE, "metadata_modele.json"), "w") as f:
        json.dump(metadata, f, indent=4)

    print("\n[+] Entraînement 16-features terminé avec succès !")
    print("[+] metadata_modele.json contient désormais seuil_1sigma_baseline ET")
    print("    feature_p98_thresholds, calculés pour CE modèle exact -- plus de")
    print("    dépendance à une valeur codée en dur ou héritée d'un run précédent.")


if __name__ == "__main__":
    main()