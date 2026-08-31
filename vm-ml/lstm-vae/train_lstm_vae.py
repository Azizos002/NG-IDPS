"""
train_lstm_vae.py
Architecture Deep LSTM-VAE (Entraînement stricte sur le Lundi BENIGN)
"""

import os
import time
import json
import numpy as np
import pandas as pd
import joblib
import matplotlib.pyplot as plt

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

CHEMIN_DONNEES_TRAIN = "dataset_optimal_features.csv"
SCHEMA_FEATURES = "selected_features.json"
DOSSIER_SORTIE = "modele_deep_lstm_vae_32features"

# ============================================================
# CHARGEMENT DU SCHÉMA ET VÉRIFICATION
# ============================================================
if not os.path.exists(SCHEMA_FEATURES):
    raise FileNotFoundError(f"Le fichier {SCHEMA_FEATURES} est introuvable. Exécute feature_selector.py d'abord.")

with open(SCHEMA_FEATURES, "r") as f:
    feature_metadata = json.load(f)

FEATURES = feature_metadata["features"]
NB_FEATURES = feature_metadata["n_features"]

print(f"[*] Contrat de features chargé : {NB_FEATURES} variables.")
assert NB_FEATURES == 32, f"Erreur fatale : 32 features attendues, mais {NB_FEATURES} trouvées."

# ============================================================
# PRÉPARATION DES DONNÉES
# ============================================================
def charger_et_normaliser(chemin_csv, scaler=None):
    df = pd.read_csv(chemin_csv)

    # Vérification stricte des colonnes attendues
    missing = [f for f in FEATURES if f not in df.columns]
    if missing:
        raise ValueError(f"Features absentes du dataset : {missing}")

    df = df[FEATURES] # Force le bon ordre et la bonne sélection
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
# ARCHITECTURE DU MODÈLE
# ============================================================
@keras.utils.register_keras_serializable()
class CoucheEchantillonnage(layers.Layer):
    def call(self, inputs, training=False):
        z_mean, z_log_var = inputs
        # Utilisation de l'astuce de reparamétrisation uniquement pendant l'entraînement
        if training:
            epsilon = keras.random.normal(shape=ops.shape(z_mean))
            return z_mean + ops.exp(0.5 * z_log_var) * epsilon
        # En phase de test/évaluation, on retourne strictement la moyenne (déterministe)
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
    reconstructions = modele.predict(sequences, batch_size=batch_size, verbose=0)
    erreurs = np.mean(np.square(sequences - reconstructions), axis=(1, 2))
    return erreurs * 1000.0

# ============================================================
# MAIN
# ============================================================
def main():
    os.makedirs(DOSSIER_SORTIE, exist_ok=True)

    print("[1/6] Chargement et normalisation (Validation du Schéma JSON)...")
    features_norm, scaler = charger_et_normaliser(CHEMIN_DONNEES_TRAIN)

    print("[2/6] Split Train/Val AVANT la création des séquences (Anti-Fuite)...")
    idx_split = int(len(features_norm) * (1 - RATIO_VALIDATION))
    features_train = features_norm[:idx_split]
    features_val = features_norm[idx_split:]

    print("[3/6] Construction séquences...")
    sequences_train = construire_sequences(features_train, TAILLE_FENETRE)
    sequences_val = construire_sequences(features_val, TAILLE_FENETRE)

    print("[4/6] Entraînement du Deep LSTM-VAE...")
    modele = construire_modele(TAILLE_FENETRE, NB_FEATURES, DIM_LATENTE)
    arbitre = EarlyStopping(monitor="val_loss", patience=PATIENCE, restore_best_weights=True)

    t0 = time.time()
    historique = modele.fit(
        sequences_train, sequences_train,
        validation_data=(sequences_val, sequences_val),
        epochs=EPOCHS_MAX, batch_size=BATCH_SIZE, callbacks=[arbitre], verbose=1
    )
    duree = time.time() - t0

    print("[5/6] Calcul de la Baseline Statistique (3 Sigma)...")
    erreurs_val = calculer_erreurs_mse(modele, sequences_val)
    mu = float(np.mean(erreurs_val))
    sigma = float(np.std(erreurs_val))
    seuil_baseline = mu + 3 * sigma
    print(f"        -> Baseline 3-Sigma : {seuil_baseline:.4f}")

    print("[6/6] Exportation des artefacts industriels...")
    modele.save(os.path.join(DOSSIER_SORTIE, "deep_lstm_vae.keras"))
    joblib.dump(scaler, os.path.join(DOSSIER_SORTIE, "global_scaler.pkl"))

    metadata = {
        "architecture": f"LSTM-VAE (64-32-{DIM_LATENTE}-32-64)",
        "taille_fenetre": TAILLE_FENETRE,
        "nb_features": NB_FEATURES,
        "seuil_3sigma_baseline": seuil_baseline, # Sauvegarde du seuil purement statistique
        "mu_validation": mu,
        "sigma_validation": sigma,
        "duree_entrainement_sec": round(duree, 2)
    }
    with open(os.path.join(DOSSIER_SORTIE, "metadata_modele.json"), "w") as f:
        json.dump(metadata, f, indent=4)

    print("\n[+] Entraînement terminé avec succès (sans fuite de données).")

if __name__ == "__main__":
    main()