"""
compare_isolation_forest.py
Comparaison équitable Isolation Forest vs LSTM-VAE :
  - MÊMES 16 features (selected_features_balanced.json)
  - MÊME jeu d'entraînement bénin (global_benign_train_16f_balanced.csv)
  - MÊME jeu de test avec types d'attaque
  - Isolation Forest entraîné en NON SUPERVISÉ STRICT :
      contamination='auto' -> ne lit JAMAIS les labels, ni pour
      l'entraînement ni pour choisir un seuil. Si Isolation Forest obtient
      ici des résultats nettement meilleurs que la config précédemment
      documentée (proche de 100%), cela confirme que l'écart provenait
      d'une fuite de label (contamination réglée à la main) plutôt que
      d'une réelle supériorité du modèle.

Règle de décision : une fenêtre (10 flux) est signalée si AU MOINS UN flux
de la fenêtre est classé anomalie par Isolation Forest (logique "any",
cohérente avec le mode de labellisation du y_true et avec l'esprit OR de
la règle hybride du LSTM-VAE).
"""

import glob
import json
import os
from collections import Counter

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import precision_recall_fscore_support

DATA_DIR = "cicids2017_data/MachineLearningCVE"
TAILLE_FENETRE = 10
RANDOM_SEED = 42
SCHEMA_FEATURES = "selected_features_balanced.json"
CHEMIN_TRAIN_BENIN = "global_benign_train_16f_balanced.csv"
DOSSIER_SORTIE = "comparaison_isolation_forest"

os.makedirs(DOSSIER_SORTIE, exist_ok=True)


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
    print("[1/6] Chargement du contrat de features (identique au LSTM-VAE)...")
    with open(SCHEMA_FEATURES) as f:
        FEATURES = json.load(f)
    NB_FEATURES = len(FEATURES)

    print("[2/6] Chargement et normalisation du train bénin (identique au LSTM-VAE)...")
    df_train = pd.read_csv(CHEMIN_TRAIN_BENIN)[FEATURES]
    scaler = MinMaxScaler()
    train_norm = scaler.fit_transform(df_train.values.astype(np.float32))

    print("[3/6] Entraînement d'Isolation Forest -- NON SUPERVISÉ STRICT "
          "(contamination='auto', aucun label utilisé)...")
    iso_forest = IsolationForest(
        n_estimators=200,
        contamination="auto",  # jamais calé sur le vrai taux d'attaques
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )
    iso_forest.fit(train_norm)
    print("[+] Entraînement terminé.\n")

    print("[4/6] Reconstruction du jeu de test complet avec types d'attaque...")
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

    features_norm = np.clip(scaler.transform(df_test[FEATURES].values.astype(np.float32)), 0.0, 1.0)
    labels_bin = df_test["Label"].astype(int).values
    labels_type = df_test["Label_Type"].astype(str).values

    print("[5/6] Score Isolation Forest par flux (une seule fois), puis agrégation par fenêtre...")
    predictions_brutes = iso_forest.predict(features_norm)
    anomalie_par_flux = (predictions_brutes == -1).astype(int)

    n_seq = len(features_norm) - TAILLE_FENETRE + 1
    y_true = np.zeros(n_seq, dtype=np.int32)
    y_pred_if = np.zeros(n_seq, dtype=np.int32)
    type_par_fenetre = []

    for i in range(n_seq):
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

        y_pred_if[i] = 1 if np.any(anomalie_par_flux[i : i + TAILLE_FENETRE] == 1) else 0

    type_par_fenetre = np.array(type_par_fenetre)
    types_attaque = sorted(set(t for t in type_par_fenetre if t != "BENIGN"))

    print("[6/6] Résultats...")
    resultats = rapporter_par_type(
        "ISOLATION FOREST -- non supervisé strict, mêmes features/train/test que le LSTM-VAE",
        y_true, y_pred_if, type_par_fenetre, types_attaque
    )

    with open(os.path.join(DOSSIER_SORTIE, "rapport_isolation_forest.json"), "w") as f:
        json.dump(resultats, f, indent=4, ensure_ascii=False)
    print(f"\n[+] Rapport exporté : {DOSSIER_SORTIE}/rapport_isolation_forest.json")
    print("[+] Compare directement à rapport_2sigma_by_type.json / seuil 1.5-sigma (LSTM-VAE) --")
    print("    mêmes 16 features, même train bénin, même jeu de test, même méthodologie.")


if __name__ == "__main__":
    main()