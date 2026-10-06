"""
evaluate_lstm_autoencoder_by_type.py
Évalue le LSTM-Autoencoder déterministe (sans VAE) globalement et par type
d'attaque -- même méthodologie que les comparaisons précédentes (mêmes
features, même train/test, même règle de fenêtrage), pour comparaison
directe avec le LSTM-VAE (seuil 1.5-sigma) et Isolation Forest.
"""

import glob
import json
import os
from collections import Counter

import numpy as np
import pandas as pd
import joblib

import keras
from sklearn.metrics import precision_recall_fscore_support

DATA_DIR = "cicids2017_data/MachineLearningCVE"
TAILLE_FENETRE = 10
RANDOM_SEED = 42
SCHEMA_FEATURES = "selected_features_balanced.json"
DOSSIER_MODELE = "modele_lstm_autoencoder_comparaison"

CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "lstm_autoencoder.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "scaler.pkl")
CHEMIN_METADATA = os.path.join(DOSSIER_MODELE, "metadata_modele.json")

VOTE_MINIMUM = 4


def rapporter_par_type(nom, y_true, y_pred, type_par_fenetre, types_attaque):
    precision, recall, f1, _ = precision_recall_fscore_support(y_true, y_pred, average="binary", zero_division=0)
    fp = int(np.sum((y_true == 0) & (y_pred == 1)))
    tn = int(np.sum((y_true == 0) & (y_pred == 0)))
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

    print(f"\n{'='*90}")
    print(f" {nom}")
    print(f" Recall global={recall*100:.2f}%  Precision={precision*100:.2f}%  F1={f1*100:.2f}%  FPR={fpr*100:.2f}%")
    print(f"{'='*90}")
    print(f" {'Type':45s} | {'N fenêtres':>10s} | {'Détectées':>10s} | {'Recall':>8s}")
    print("-" * 90)

    par_type = {}
    for type_attaque in types_attaque:
        mask_type = type_par_fenetre == type_attaque
        n_total = int(mask_type.sum())
        n_detecte = int(np.sum(y_pred[mask_type] == 1))
        recall_type = (n_detecte / n_total * 100) if n_total > 0 else 0.0
        print(f" {type_attaque:45s} | {n_total:10d} | {n_detecte:10d} | {recall_type:7.2f}%")
        par_type[type_attaque] = {"n_fenetres": n_total, "n_detectees": n_detecte, "recall_pct": recall_type}

    return {"global": {"recall": float(recall), "precision": float(precision),
                        "f1_score": float(f1), "fpr": float(fpr)}, "par_type": par_type}


def main():
    print("[1/5] Chargement du modèle, du scaler, des seuils...")
    with open(SCHEMA_FEATURES) as f:
        FEATURES = json.load(f)
    NB_FEATURES = len(FEATURES)

    with open(CHEMIN_METADATA) as f:
        metadata = json.load(f)
    seuil_global = float(metadata["seuil_1sigma_baseline"])  # en réalité 1.5-sigma, cf. train script
    seuils_p98 = np.array(metadata["feature_p98_thresholds"], dtype=np.float32)

    scaler = joblib.load(CHEMIN_SCALER)
    modele = keras.models.load_model(CHEMIN_MODELE)  # pas de custom_objects -- modèle standard
    print(f"[+] Seuil (1.5-sigma) : {seuil_global:.4f}\n")

    print("[2/5] Reconstruction du jeu de test complet avec types d'attaque...")
    cols_to_keep = FEATURES + ["Label"]
    all_csv_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))
    rng = np.random.RandomState(RANDOM_SEED)

    frames = []
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
            frames.append(pd.concat([benign_test, attack_chunk]))

    df_test = pd.concat(frames, ignore_index=True)
    del frames
    print(f"[+] {len(df_test)} lignes.\n")

    features_brutes = df_test[FEATURES].values.astype(np.float32)
    features_norm = np.clip(scaler.transform(features_brutes), 0.0, 1.0)
    labels_bin = df_test["Label"].astype(int).values
    labels_type = df_test["Label_Type"].astype(str).values

    print("[3/5] Construction des séquences...")
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
    types_attaque = sorted(set(t for t in type_par_fenetre if t != "BENIGN"))

    print("[4/5] Inférence (MSE global + comptage de votes)...")
    CHUNK = 100_000
    mse_global_all = np.zeros(n_seq, dtype=np.float32)
    vote_count_all = np.zeros(n_seq, dtype=np.int32)
    for idx in range(0, n_seq, CHUNK):
        fin = min(idx + CHUNK, n_seq)
        preds = modele.predict(sequences[idx:fin], batch_size=512, verbose=0)
        err_par_feature = np.mean(np.square(sequences[idx:fin] - preds), axis=1) * 1000.0
        mse_global_all[idx:fin] = np.mean(err_par_feature, axis=1)
        vote_count_all[idx:fin] = np.sum(err_par_feature > seuils_p98, axis=1)
        print(f"    -> {fin}/{n_seq} ({(fin/n_seq)*100:.1f}%)")

    print("\n[5/5] Résultats -- règle hybride (vote>=4 OU seuil 1.5-sigma), identique au LSTM-VAE...")
    y_pred_hybride = ((vote_count_all >= VOTE_MINIMUM) | (mse_global_all >= seuil_global)).astype(int)
    resultats = rapporter_par_type(
        f"LSTM-AUTOENCODER (déterministe, sans VAE) -- hybride vote>={VOTE_MINIMUM} OU seuil={seuil_global:.2f}",
        y_true, y_pred_hybride, type_par_fenetre, types_attaque
    )

    with open(os.path.join(DOSSIER_MODELE, "rapport_lstm_autoencoder.json"), "w") as f:
        json.dump(resultats, f, indent=4, ensure_ascii=False)
    print(f"\n[+] Rapport exporté : {DOSSIER_MODELE}/rapport_lstm_autoencoder.json")
    print("[+] Compare directement au LSTM-VAE (rapport_2sigma_by_type.json / seuil 1.5-sigma)")
    print("    et à Isolation Forest (comparaison_isolation_forest/rapport_isolation_forest.json).")


if __name__ == "__main__":
    main()