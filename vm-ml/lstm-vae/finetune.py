import os
import json
import numpy as np
import pandas as pd
import joblib
import tensorflow as tf
import keras
from keras import layers, ops, Model

# ============================================================
# 1. RÉINTÉGRATION DES COUCHES PERSONNALISÉES (Nécessaire pour le load)
# ============================================================
class CoucheEchantillonnage(layers.Layer):
    def call(self, inputs):
        z_mean, z_log_var = inputs
        epsilon = keras.random.normal(shape=ops.shape(z_mean))
        return z_mean + ops.exp(0.5 * z_log_var) * epsilon

class CoucheVAELoss(layers.Layer):
    def call(self, inputs):
        x, x_reconstruit, z_mean, z_log_var = inputs
        loss_reconstruction = ops.mean(ops.square(x - x_reconstruit))
        loss_kl = -0.5 * ops.mean(1 + z_log_var - ops.square(z_mean) - ops.exp(z_log_var))
        self.add_loss(loss_reconstruction + loss_kl)
        return x_reconstruit

# ============================================================
# 2. FONCTIONS UTILITAIRES
# ============================================================
def construire_sequences(data, taille_fenetre=10):
    nb_sequences = len(data) - taille_fenetre + 1
    sequences = np.zeros((nb_sequences, taille_fenetre, data.shape[1]), dtype=np.float32)
    for i in range(nb_sequences):
        sequences[i] = data[i : i + taille_fenetre]
    return sequences

def calculer_erreurs_mse(modele, sequences, batch_size=128):
    reconstructions = modele.predict(sequences, batch_size=batch_size, verbose=0)
    erreurs = np.mean(np.square(sequences - reconstructions), axis=(1, 2))
    return erreurs

def calculer_seuil(erreurs_mse):
    mu = float(np.mean(erreurs_mse))
    sigma = float(np.std(erreurs_mse))
    seuil = mu + 3 * sigma
    return seuil, mu, sigma

# ============================================================
# MAIN : FINE-TUNING
# ============================================================
def main():
    DOSSIER_MODELE = "modele_fenetre_10_enrichi"
    CHEMIN_CSV = "dataset_finetuning.csv"

    print("[1/5] Chargement du Scaler et du Modèle pré-entraîné...")
    scaler = joblib.load(os.path.join(DOSSIER_MODELE, "global_scaler.pkl"))
    custom_objects = {
        "CoucheEchantillonnage": CoucheEchantillonnage,
        "CoucheVAELoss": CoucheVAELoss
    }
    modele = keras.models.load_model(os.path.join(DOSSIER_MODELE, "lstm_candidate.keras"), custom_objects=custom_objects)

    print("[2/5] Préparation du dataset de Fine-Tuning (Trafic Réel)...")
    df = pd.read_csv(CHEMIN_CSV, header=None) # Pas de header depuis jq
    features = df.values.astype(np.float32)

    # Normalisation avec le scaler existant
    features_norm = scaler.transform(features)
    features_norm = np.clip(features_norm, 0.0, 1.0)
    sequences = construire_sequences(features_norm, taille_fenetre=10)
    print(f"      -> {sequences.shape[0]} séquences prêtes pour l'apprentissage.")

    print("[3/5] Fine-Tuning du modèle (Apprentissage de la nouvelle normalité)...")
    # On entraîne sur un petit nombre d'epochs pour ajuster sans tout écraser
    modele.fit(sequences, sequences, epochs=5, batch_size=64, verbose=1)

    print("[4/5] Calcul du nouveau seuil dynamique...")
    erreurs_mse = calculer_erreurs_mse(modele, sequences)
    nouveau_seuil, nouveau_mu, nouveau_sigma = calculer_seuil(erreurs_mse)
    print(f"      -> Ancien trafic ignoré. Nouveau Seuil MSE : {nouveau_seuil:.6f}")

    print("[5/5] Sauvegarde de la mise à jour...")
    modele.save(os.path.join(DOSSIER_MODELE, "lstm_candidate.keras"))

    # Mise à jour des métadonnées pour le SOAR
    chemin_meta = os.path.join(DOSSIER_MODELE, "metadata.json")
    with open(chemin_meta, "r") as f:
        metadata = json.load(f)

    metadata["seuil_mse"] = nouveau_seuil
    metadata["mu"] = nouveau_mu
    metadata["sigma"] = nouveau_sigma
    metadata["notes"] = "Fine-Tuned sur trafic local VirtualBox (Domain Shift corrigé)"

    with open(chemin_meta, "w") as f:
        json.dump(metadata, f, indent=2)

    print("Succès ! L'IA est maintenant calibrée sur ton environnement virtuel.")

if __name__ == "__main__":
    main()