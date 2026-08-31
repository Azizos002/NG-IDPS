"""
calibrate_threshold.py
Objectif : Trouver le seuil optimal sur un jour indépendant (Mardi).
Contrainte : Maximiser le Rappel (Recall) tout en gardant un Taux de Faux Positifs (FPR) <= 5%.
"""

import os
import json
import numpy as np
import pandas as pd
import joblib
import keras
from keras import layers, ops
from sklearn.metrics import roc_curve, confusion_matrix

# =================================================================
# 1. DÉFINITION DES COUCHES PERSONNALISÉES (Pour le chargement)
# =================================================================
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

# =================================================================
# 2. CONFIGURATION
# =================================================================
DOSSIER_MODELE = "modele_deep_lstm_vae_32features"
CHEMIN_TUESDAY = "cicids2017_data/MachineLearningCVE/Tuesday-WorkingHours.pcap_ISCX.csv"
SCHEMA_FEATURES = "selected_features.json"
CHUNK_SIZE = 100_000

def calibrate():
    print("[1/4] Chargement du schéma, du modèle et du scaler...")
    with open(SCHEMA_FEATURES, "r") as f:
        schema = json.load(f)
    features_a_garder = schema["features"]

    with open(os.path.join(DOSSIER_MODELE, "metadata_modele.json"), "r") as f:
        meta = json.load(f)
    taille_fenetre = meta["taille_fenetre"]

    scaler = joblib.load(os.path.join(DOSSIER_MODELE, "global_scaler.pkl"))
    modele = keras.models.load_model(
        os.path.join(DOSSIER_MODELE, "deep_lstm_vae.keras"),
        custom_objects={"CoucheEchantillonnage": CoucheEchantillonnage, "CoucheVAELoss": CoucheVAELoss}
    )

    print(f"[2/4] Analyse du dataset de calibration (Mardi) : {CHEMIN_TUESDAY}")

    y_true_all = []
    y_scores_all = []
    dernier_feat, dernier_lab = None, None

    # Lecture dynamique pour ne pas exploser la RAM
    for chunk_df in pd.read_csv(CHEMIN_TUESDAY, chunksize=CHUNK_SIZE, low_memory=False):
        chunk_df.columns = chunk_df.columns.str.strip()

        # Vérification du contrat de features
        if not all(f in chunk_df.columns for f in features_a_garder):
            continue

        chunk_df = chunk_df[features_a_garder + ["Label"]].copy()
        chunk_df.replace([np.inf, -np.inf], np.nan, inplace=True)
        chunk_df.dropna(inplace=True)
        if len(chunk_df) == 0: continue

        features_chunk = chunk_df[features_a_garder].values.astype(np.float32)
        labels_chunk = np.where(chunk_df["Label"].str.strip().values == "BENIGN", 0, 1)

        f_norm = np.clip(scaler.transform(features_chunk), 0.0, 1.0)

        if dernier_feat is not None:
            f_norm = np.vstack((dernier_feat, f_norm))
            labels_chunk = np.concatenate((dernier_lab, labels_chunk))

        nb_seq = len(f_norm) - taille_fenetre + 1
        if nb_seq > 0:
            seq_chunk = np.zeros((nb_seq, taille_fenetre, len(features_a_garder)), dtype=np.float32)
            seq_labels = np.zeros(nb_seq, dtype=int)

            for i in range(nb_seq):
                seq_chunk[i] = f_norm[i : i + taille_fenetre]
                seq_labels[i] = 1 if np.sum(labels_chunk[i : i + taille_fenetre]) > 0 else 0

            # Calcul déterministe de l'erreur MSE
            reconstructions = modele.predict(seq_chunk, batch_size=512, verbose=0)
            erreurs_mse = np.mean(np.square(seq_chunk - reconstructions), axis=(1, 2)) * 1000.0

            y_true_all.extend(seq_labels)
            y_scores_all.extend(erreurs_mse)

        dernier_feat = f_norm[-taille_fenetre+1:]
        dernier_lab = labels_chunk[-taille_fenetre+1:]

    print("\n[3/4] Optimisation sous contrainte : FPR <= 5%...")
    # La courbe ROC calcule directement le TPR (Recall) et le FPR pour chaque seuil !
    fpr, tpr, thresholds = roc_curve(y_true_all, y_scores_all)

    # On isole tous les seuils où le FPR est <= 0.05
    indices_valides = np.where(fpr <= 0.05)[0]

    if len(indices_valides) == 0:
        print("[-] Impossible de trouver un seuil avec FPR <= 5%.")
        return

    # Parmi ces seuils valides, on prend celui qui donne le meilleur Rappel (TPR)
    meilleur_index = indices_valides[np.argmax(tpr[indices_valides])]
    seuil_optimal = thresholds[meilleur_index]
    meilleur_fpr = fpr[meilleur_index]
    meilleur_recall = tpr[meilleur_index]

    print("==========================================================")
    print(f"[*] SEUIL D'ALERTE DÉFINITIF FIXÉ À : {seuil_optimal:.4f}")
    print(f"    -> Faux Positifs garantis : {meilleur_fpr * 100:.2f}% (Contrainte respectée)")
    print(f"    -> Taux de Détection estimé: {meilleur_recall * 100:.2f}%")
    print("==========================================================")

    print("\n[4/4] Sauvegarde du seuil calibré dans les métadonnées...")
    meta["seuil_optimal_calibre"] = float(seuil_optimal)
    with open(os.path.join(DOSSIER_MODELE, "metadata_modele.json"), "w") as f:
        json.dump(meta, f, indent=4)

    print("[+] Calibration terminée. Prêt pour le Test Final Aveugle.")

if __name__ == "__main__":
    calibrate()