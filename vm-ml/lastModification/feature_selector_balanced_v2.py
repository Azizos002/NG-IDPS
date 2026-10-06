"""
feature_selector_balanced_v2.py
Reprend feature_selector_balanced.py avec deux changements :

  1. TARGET_FEATURES augmenté (24 au lieu de 16) -- plus de place pour
     couvrir les types faibles sans retirer les features volumétriques qui
     fonctionnent déjà bien.
  2. Force l'inclusion de features "signal d'absence de réponse" pour
     PortScan (Flow Duration, Total Backward Packets,
     Init_Win_bytes_backward, Total Fwd Packets) -- détectables au niveau
     d'UN SEUL flux, sans regroupement par IP (indisponible dans ce
     dataset).
"""

import glob
import json
import os

import numpy as np
import pandas as pd
from sklearn.feature_selection import f_classif

DATA_DIR = "cicids2017_data/MachineLearningCVE"
SAMPLE_FRAC = 0.15
RANDOM_SEED = 42
TARGET_FEATURES = 24  # augmenté depuis 16

TYPES_FAIBLES = [
    "PortScan", "FTP-Patator", "SSH-Patator", "Bot",
    "Web Attack \x96 Brute Force", "Web Attack \x96 XSS", "Web Attack \x96 Sql Injection",
    "Web Attack – Brute Force", "Web Attack – XSS", "Web Attack – Sql Injection",
]
TOP_K_PAR_TYPE_FAIBLE = 3

# Features forcées pour PortScan spécifiquement (signal "absence de réponse",
# détectable par flux individuel, pas besoin de regroupement par IP)
FEATURES_FORCEES_PORTSCAN = [
    "Flow Duration", "Total Backward Packets",
    "Init_Win_bytes_backward", "Total Fwd Packets",
]

columns_to_drop = ['Flow ID', 'Source IP', 'Destination IP', 'Timestamp', 'SimillarHTTP']


def main():
    print("=== ÉTAPE 1 : Échantillonnage ===")
    all_csv_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))
    sampled_dfs = []
    for file in all_csv_files:
        print(f"Lecture : {os.path.basename(file)}")
        df = pd.read_csv(file, on_bad_lines="skip", low_memory=False)
        df.columns = df.columns.str.strip()
        cols_to_drop_actual = [c for c in columns_to_drop if c in df.columns]
        df = df.drop(columns=cols_to_drop_actual)
        df = df.replace([np.inf, -np.inf], np.nan).dropna()
        sampled_dfs.append(df.sample(frac=SAMPLE_FRAC, random_state=RANDOM_SEED))

    df_global = pd.concat(sampled_dfs, ignore_index=True)
    del sampled_dfs
    df_global["Label"] = df_global["Label"].astype(str).str.strip()
    X_full = df_global.drop(columns=["Label"])
    feature_names = X_full.columns.tolist()

    types_presents = sorted(t for t in df_global["Label"].unique() if t.upper() != "BENIGN")
    print(f"[+] {len(df_global)} lignes, {len(feature_names)} features candidates.\n")

    print("=== ÉTAPE 2 : F-score par type ===")
    scores_par_type = {}
    mask_benin = df_global["Label"].str.upper() == "BENIGN"
    for type_attaque in types_presents:
        mask_type = df_global["Label"] == type_attaque
        mask_binaire = mask_benin | mask_type
        if int(mask_type.sum()) < 10:
            continue
        X_subset = X_full[mask_binaire]
        y_subset = mask_type[mask_binaire].astype(int)
        f_scores, _ = f_classif(X_subset, y_subset)
        scores_par_type[type_attaque] = np.nan_to_num(f_scores, nan=0.0, posinf=0.0)
        print(f"  [+] '{type_attaque}' : F-scores calculés.")

    print("\n=== ÉTAPE 3 : F-score global (référence) ===")
    y_global = (df_global["Label"].str.upper() != "BENIGN").astype(int)
    f_scores_global, _ = f_classif(X_full, y_global)
    f_scores_global = np.nan_to_num(f_scores_global, nan=0.0, posinf=0.0)

    print("\n=== ÉTAPE 4 : Sélection ÉLARGIE ===")
    features_retenues = set()
    detail_selection = []

    # 4a. Features forcées pour PortScan (signal absence de réponse)
    for feat in FEATURES_FORCEES_PORTSCAN:
        if feat in feature_names and feat not in features_retenues:
            idx = feature_names.index(feat)
            features_retenues.add(feat)
            score_portscan = scores_par_type.get("PortScan", [0] * len(feature_names))[idx]
            detail_selection.append((feat, "forcé:PortScan(non-réponse)", score_portscan))

    # 4b. Top-K par type faible (comme avant)
    for type_attaque in TYPES_FAIBLES:
        if type_attaque not in scores_par_type:
            continue
        scores = scores_par_type[type_attaque]
        top_idx = np.argsort(scores)[::-1][:TOP_K_PAR_TYPE_FAIBLE]
        for idx in top_idx:
            if feature_names[idx] not in features_retenues:
                features_retenues.add(feature_names[idx])
                detail_selection.append((feature_names[idx], f"faible:{type_attaque}", scores[idx]))

    print(f"[+] {len(features_retenues)} features après couverture des types faibles + PortScan forcé.")

    # 4c. Compléter avec le meilleur F-score global
    idx_global_tries = np.argsort(f_scores_global)[::-1]
    for idx in idx_global_tries:
        if len(features_retenues) >= TARGET_FEATURES:
            break
        if feature_names[idx] not in features_retenues:
            features_retenues.add(feature_names[idx])
            detail_selection.append((feature_names[idx], "global", f_scores_global[idx]))

    selected_features = list(features_retenues)[:TARGET_FEATURES]

    print(f"\n[+] SÉLECTION FINALE ({len(selected_features)} features) :")
    for feat, origine, score in detail_selection:
        if feat in selected_features:
            print(f"    {feat:35s} | origine={origine:30s} | F={score:.2f}")

    with open("selected_features_balanced_v2.json", "w") as f:
        json.dump(selected_features, f, indent=2)
    print(f"\n[+] selected_features_balanced_v2.json écrit ({len(selected_features)} features).")


if __name__ == "__main__":
    main()