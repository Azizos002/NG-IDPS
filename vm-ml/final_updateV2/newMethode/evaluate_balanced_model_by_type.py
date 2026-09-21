"""
evaluate_balanced_model_by_type.py
Évalue le modèle entraîné sur les features équilibrées, à la fois
globalement et PAR TYPE D'ATTAQUE, en réutilisant les données brutes
directement (pas besoin de fichier intermédiaire séparé) pour comparer
face à face avec evaluate_by_attack_type.py (modèle original).
"""

import glob
import json
import os
from collections import Counter

import numpy as np
import pandas as pd
import joblib

import keras
from keras import layers, ops

DATA_DIR = "cicids2017_data/MachineLearningCVE"
TAILLE_FENETRE = 10
RANDOM_SEED = 42
SCHEMA_FEATURES = "selected_features_balanced.json"
DOSSIER_MODELE = "modele_deep_lstm_vae_16features_balanced"

CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "deep_lstm_vae_16f_balanced.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "scaler_16f_balanced.pkl")
CHEMIN_METADATA = os.path.join(DOSSIER_MODELE, "metadata_modele.json")

columns_to_drop = ['Flow ID', 'Source IP', 'Destination IP', 'Timestamp', 'SimillarHTTP']


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


def main():
    print("[1/5] Chargement du modèle équilibré, du scaler, du seuil...")
    with open(SCHEMA_FEATURES) as f:
        FEATURES = json.load(f)
    NB_FEATURES = len(FEATURES)

    with open(CHEMIN_METADATA) as f:
        metadata = json.load(f)
    seuil_global = float(metadata["seuil_1sigma_baseline"])

    scaler = joblib.load(CHEMIN_SCALER)
    modele = keras.models.load_model(
        CHEMIN_MODELE,
        custom_objects={"CoucheEchantillonnage": CoucheEchantillonnage, "CoucheVAELoss": CoucheVAELoss},
    )
    print(f"[+] Seuil : {seuil_global:.4f}\n")

    print("[2/5] Reconstruction du jeu de test (20% bénin + 100% attaques, même split seedé)...")
    cols_to_keep = FEATURES + ["Label"]
    all_csv_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))
    rng = np.random.RandomState(RANDOM_SEED)

    frames_test = []
    for file in all_csv_files:
        print(f"  Extraction : {os.path.basename(file)}")
        for chunk in pd.read_csv(file, chunksize=100_000, low_memory=False):
            chunk.columns = chunk.columns.str.strip()
            if not all(c in chunk.columns for c in cols_to_keep):
                continue
            chunk = chunk[cols_to_keep].copy()
            chunk = chunk.replace([np.inf, -np.inf], np.nan).dropna()
            if len(chunk) == 0:
                continue

            chunk["Label_Type"] = chunk["Label"].astype(str).str.strip()
            chunk["Label"] = chunk["Label_Type"].apply(lambda x: 0 if x.upper() == "BENIGN" else 1)

            benign_chunk = chunk[chunk["Label"] == 0]
            attack_chunk = chunk[chunk["Label"] == 1]
            mask = rng.rand(len(benign_chunk)) < 0.80
            benign_test = benign_chunk[~mask]
            frames_test.append(pd.concat([benign_test, attack_chunk]))

    df_test = pd.concat(frames_test, ignore_index=True)
    del frames_test
    print(f"[+] {len(df_test)} lignes de test reconstruites.\n")

    features_brutes = df_test[FEATURES].values.astype(np.float32)
    features_norm = np.clip(scaler.transform(features_brutes), 0.0, 1.0)
    labels_bin = df_test["Label"].astype(int).values
    labels_type = df_test["Label_Type"].astype(str).values

    print("[3/5] Construction des séquences et labels de type par fenêtre...")
    n_seq = len(features_norm) - TAILLE_FENETRE + 1
    sequences = np.zeros((n_seq, TAILLE_FENETRE, NB_FEATURES), dtype=np.float32)
    y_true = np.zeros(n_seq, dtype=np.int32)
    type_par_fenetre = []

    for i in range(n_seq):
        sequences[i] = features_norm[i : i + TAILLE_FENETRE]
        labs_fenetre = labels_bin[i : i + TAILLE_FENETRE]
        if np.any(labs_fenetre == 1):
            y_true[i] = 1
            types_non_benins = [t for t, l in zip(labels_type[i : i + TAILLE_FENETRE], labs_fenetre) if l == 1]
            compte = Counter(types_non_benins)
            types_distincts = list(compte.keys())
            type_par_fenetre.append(
                types_distincts[0] if len(types_distincts) == 1
                else "MIXTE(" + "+".join(sorted(types_distincts)) + ")"
            )
        else:
            type_par_fenetre.append("BENIGN")

    type_par_fenetre = np.array(type_par_fenetre)

    print("[4/5] Inférence...")
    CHUNK = 100_000
    mse_global_all = np.zeros(n_seq, dtype=np.float32)
    for idx in range(0, n_seq, CHUNK):
        fin = min(idx + CHUNK, n_seq)
        preds = modele.predict(sequences[idx:fin], batch_size=512, verbose=0)
        mse_global_all[idx:fin] = np.mean(np.square(sequences[idx:fin] - preds), axis=(1, 2)) * 1000.0
        print(f"    -> {fin}/{n_seq} ({(fin/n_seq)*100:.1f}%)")

    y_pred = (mse_global_all >= seuil_global).astype(int)

    from sklearn.metrics import confusion_matrix, precision_recall_fscore_support
    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()
    precision, recall, f1, _ = precision_recall_fscore_support(y_true, y_pred, average="binary", zero_division=0)
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

    print("\n" + "=" * 60)
    print(" RÉSULTAT GLOBAL — MODÈLE ÉQUILIBRÉ")
    print("=" * 60)
    print(f" Recall={recall*100:.2f}%  Precision={precision*100:.2f}%  F1={f1*100:.2f}%  FPR={fpr*100:.2f}%")
    print("=" * 60)

    print("\n[5/5] Recall par type d'attaque (modèle équilibré) :")
    print("=" * 90)
    print(f" {'Type':45s} | {'N fenêtres':>10s} | {'Détectées':>10s} | {'Recall':>8s}")
    print("=" * 90)

    resultats_par_type = {}
    types_attaque = sorted(set(t for t in type_par_fenetre if t != "BENIGN"))
    for type_attaque in types_attaque:
        mask_type = type_par_fenetre == type_attaque
        n_total = int(mask_type.sum())
        n_detecte = int(np.sum(y_pred[mask_type] == 1))
        recall_type = (n_detecte / n_total * 100) if n_total > 0 else 0.0
        print(f" {type_attaque:45s} | {n_total:10d} | {n_detecte:10d} | {recall_type:7.2f}%")
        resultats_par_type[type_attaque] = {"n_fenetres": n_total, "n_detectees": n_detecte, "recall_pct": recall_type}

    print("=" * 90)

    with open(os.path.join(DOSSIER_MODELE, "rapport_recall_par_type_balanced.json"), "w") as f:
        json.dump({
            "global": {"recall": float(recall), "precision": float(precision), "f1_score": float(f1), "fpr": float(fpr)},
            "par_type": resultats_par_type,
        }, f, indent=4, ensure_ascii=False)
    print(f"\n[+] Rapport exporté dans {DOSSIER_MODELE}/")


if __name__ == "__main__":
    main()