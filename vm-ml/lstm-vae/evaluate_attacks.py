"""
evaluate_attacks.py
Test sur attaques DoS et recherche du Seuil Optimal via Precision-Recall Curve.
"""
import os
import json
import numpy as np
import pandas as pd
import joblib
import keras
from keras import layers, ops
from sklearn.metrics import classification_report, confusion_matrix, precision_recall_curve

@keras.utils.register_keras_serializable()
class CoucheEchantillonnage(layers.Layer):
    def call(self, inputs):
        z_mean, z_log_var = inputs
        epsilon = keras.random.normal(shape=ops.shape(z_mean))
        return z_mean + ops.exp(0.5 * z_log_var) * epsilon

@keras.utils.register_keras_serializable()
class CoucheVAELoss(layers.Layer):
    def call(self, inputs):
        x, x_reconstruit, z_mean, z_log_var = inputs
        loss_reconstruction = ops.mean(ops.square(x - x_reconstruit))
        loss_kl = -0.5 * ops.mean(1 + z_log_var - ops.square(z_mean) - ops.exp(z_log_var))
        self.add_loss(loss_reconstruction + loss_kl)
        return x_reconstruit

DOSSIER_MODELE = "modele_deep_lstm_vae_32features"
CHEMIN_WEDNESDAY = "cicids2017_data/MachineLearningCVE/Thursday-WorkingHours-Morning-WebAttacks.pcap_ISCX.csv"
CHEMIN_OPTIMAL = "dataset_optimal_features.csv"

def evaluate():
    with open(os.path.join(DOSSIER_MODELE, "metadata_modele.json"), "r") as f:
        meta = json.load(f)

    ancien_seuil = meta["seuil_anomalie"]
    taille_fenetre = meta["taille_fenetre"]

    scaler = joblib.load(os.path.join(DOSSIER_MODELE, "global_scaler.pkl"))
    modele = keras.models.load_model(
        os.path.join(DOSSIER_MODELE, "deep_lstm_vae.keras"),
        custom_objects={"CoucheEchantillonnage": CoucheEchantillonnage, "CoucheVAELoss": CoucheVAELoss}
    )

    df_opt = pd.read_csv(CHEMIN_OPTIMAL, nrows=0)
    features_a_garder = list(df_opt.columns)

    print("[*] Évaluation par lots sur le trafic du Mercredi...")
    y_true_all, y_erreurs_all = [], []
    dernier_feat, dernier_lab = None, None

    for chunk_df in pd.read_csv(CHEMIN_WEDNESDAY, chunksize=100_000, low_memory=False):
        chunk_df.columns = chunk_df.columns.str.strip()
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

            reconstructions = modele.predict(seq_chunk, batch_size=512, verbose=0)
            erreurs_mse = np.mean(np.square(seq_chunk - reconstructions), axis=(1, 2)) * 1000.0

            y_true_all.extend(seq_labels)
            y_erreurs_all.extend(erreurs_mse)

        dernier_feat = f_norm[-taille_fenetre+1:]
        dernier_lab = labels_chunk[-taille_fenetre+1:]

    print("\n🧠 RECHERCHE DU SEUIL OPTIMAL (F1-Score)")
    precisions, recalls, thresholds = precision_recall_curve(y_true_all, y_erreurs_all)
    f1_scores = 2 * (precisions[:-1] * recalls[:-1]) / (precisions[:-1] + recalls[:-1] + 1e-10)

    idx = np.argmax(f1_scores)
    seuil_opt = thresholds[idx]

    print(f"[*] Ancien seuil : {ancien_seuil:.4f}")
    print(f"[*] SEUIL OPTIMAL: {seuil_opt:.4f} (F1-Max: {f1_scores[idx]:.4f})")

    print("\n📊 RÉSULTATS AVEC SEUIL OPTIMAL")
    y_pred_opt = (np.array(y_erreurs_all) > seuil_opt).astype(int)
    print(classification_report(y_true_all, y_pred_opt, target_names=["BENIGN", "ATTAQUE"], digits=4))

    cm = confusion_matrix(y_true_all, y_pred_opt)
    print("--- MATRICE DE CONFUSION ---")
    print(f"VN (Normal) : {cm[0][0]} | FP (Fausses alertes) : {cm[0][1]}")
    print(f"FN (Ratés)  : {cm[1][0]} | VP (Bloqués)         : {cm[1][1]}\n")

if __name__ == "__main__":
    evaluate()