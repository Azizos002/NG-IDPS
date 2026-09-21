"""
feature_selector_balanced.py
Reproduit l'échantillonnage de feature_selector_global.py (15%, même seed),
mais calcule le F-score ANOVA SÉPARÉMENT pour chaque type d'attaque contre
le bénin, au lieu d'un seul F-score global sur "toute attaque confondue".

Objectif : la sélection globale précédente était dominée par les types les
plus nombreux et les plus séparables (DDoS, DoS Hulk), noyant le signal des
attaques statistiquement discrètes (PortScan, Patator, Web Attack) qui,
d'après evaluate_by_attack_type.py, ont un recall proche de 0%.

Stratégie de sélection "équilibrée" :
  1. Pour chaque type d'attaque FAIBLE (recall observé < 10%), retenir ses
     TOP_K_PAR_TYPE_FAIBLE features les plus discriminantes (F-score de ce
     type seul contre le bénin).
  2. Compléter jusqu'à TARGET_FEATURES avec les meilleures features au
     F-score global (pour ne pas perdre la détection volumétrique déjà
     acquise sur DDoS/DoS Hulk/DoS GoldenEye).
  3. Exporter la matrice complète feature x type (F-scores) pour analyse et
     justification dans le rapport, + le nouveau contrat de features.

NE PAS écraser selected_features_global.json (le modèle actuel en dépend) :
écrit un nouveau fichier selected_features_balanced.json.
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
TARGET_FEATURES = 16

# Types identifiés comme faibles (recall < 10%) dans evaluate_by_attack_type.py
TYPES_FAIBLES = [
    "PortScan", "FTP-Patator", "SSH-Patator", "Bot",
    "Web Attack \x96 Brute Force", "Web Attack \x96 XSS", "Web Attack \x96 Sql Injection",
    "Web Attack – Brute Force", "Web Attack – XSS", "Web Attack – Sql Injection",
]
TOP_K_PAR_TYPE_FAIBLE = 3

columns_to_drop = ['Flow ID', 'Source IP', 'Destination IP', 'Timestamp', 'SimillarHTTP']


def main():
    print("=== ÉTAPE 1 : Échantillonnage (identique à feature_selector_global.py) ===")
    all_csv_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))
    sampled_dfs = []

    for file in all_csv_files:
        print(f"Lecture et échantillonnage : {os.path.basename(file)}")
        df = pd.read_csv(file, on_bad_lines="skip", low_memory=False)
        df.columns = df.columns.str.strip()

        cols_to_drop_actual = [c for c in columns_to_drop if c in df.columns]
        df = df.drop(columns=cols_to_drop_actual)
        df = df.replace([np.inf, -np.inf], np.nan).dropna()

        df_sample = df.sample(frac=SAMPLE_FRAC, random_state=RANDOM_SEED)
        sampled_dfs.append(df_sample)

    df_global = pd.concat(sampled_dfs, ignore_index=True)
    del sampled_dfs

    df_global["Label"] = df_global["Label"].astype(str).str.strip()
    X_full = df_global.drop(columns=["Label"])
    feature_names = X_full.columns.tolist()

    print(f"\n[+] Échantillon global : {len(df_global)} lignes, {len(feature_names)} features candidates.")

    types_presents = sorted(t for t in df_global["Label"].unique() if t.upper() != "BENIGN")
    print(f"[+] Types d'attaque présents dans l'échantillon : {types_presents}\n")

    print("=== ÉTAPE 2 : F-score ANOVA PAR TYPE D'ATTAQUE (vs bénin uniquement) ===")
    scores_par_type = {}
    mask_benin = df_global["Label"].str.upper() == "BENIGN"

    for type_attaque in types_presents:
        mask_type = df_global["Label"] == type_attaque
        mask_binaire = mask_benin | mask_type
        n_type = int(mask_type.sum())
        if n_type < 10:
            print(f"  [!] '{type_attaque}' : seulement {n_type} échantillons, ignoré (trop peu).")
            continue

        X_subset = X_full[mask_binaire]
        y_subset = mask_type[mask_binaire].astype(int)

        f_scores, _ = f_classif(X_subset, y_subset)
        f_scores = np.nan_to_num(f_scores, nan=0.0, posinf=0.0)
        scores_par_type[type_attaque] = f_scores
        print(f"  [+] '{type_attaque}' ({n_type} échantillons) : F-scores calculés.")

    print("\n=== ÉTAPE 3 : F-score GLOBAL (toutes attaques confondues, référence) ===")
    y_global = (df_global["Label"].str.upper() != "BENIGN").astype(int)
    f_scores_global, _ = f_classif(X_full, y_global)
    f_scores_global = np.nan_to_num(f_scores_global, nan=0.0, posinf=0.0)

    print("\n=== ÉTAPE 4 : Top features par type (diagnostic) ===")
    for type_attaque, scores in scores_par_type.items():
        top_idx = np.argsort(scores)[::-1][:5]
        print(f"\n  Top 5 pour '{type_attaque}' :")
        for idx in top_idx:
            print(f"    {feature_names[idx]:35s} F={scores[idx]:.2f}")

    print("\n=== ÉTAPE 5 : Sélection ÉQUILIBRÉE (couverture types faibles + global) ===")
    features_retenues = set()
    detail_selection = []

    for type_attaque in TYPES_FAIBLES:
        if type_attaque not in scores_par_type:
            continue
        scores = scores_par_type[type_attaque]
        top_idx = np.argsort(scores)[::-1][:TOP_K_PAR_TYPE_FAIBLE]
        for idx in top_idx:
            if feature_names[idx] not in features_retenues:
                features_retenues.add(feature_names[idx])
                detail_selection.append((feature_names[idx], f"faible:{type_attaque}", scores[idx]))

    print(f"[+] {len(features_retenues)} features retenues pour couvrir les types faibles.")

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

    with open("selected_features_balanced.json", "w") as f:
        json.dump(selected_features, f, indent=2)
    print("\n[+] selected_features_balanced.json écrit (l'ancien selected_features_global.json "
          "n'est PAS modifié).")

    # Export de la matrice complète pour analyse/justification dans le rapport
    matrice = pd.DataFrame(scores_par_type, index=feature_names)
    matrice["GLOBAL"] = f_scores_global
    matrice.to_csv("matrice_fscore_par_type.csv")
    print("[+] matrice_fscore_par_type.csv exportée (feature x type, F-scores complets).")

    print("\n[*] Prochaine étape : régénérer les datasets train/test avec ce nouveau contrat de "
          "features (variante de feature_selector_global_v2.py Étape 3, en pointant "
          "SCHEMA_FEATURES vers selected_features_balanced.json), puis RÉENTRAÎNER le modèle "
          "(train_lstm_vae_16f_patched.py) -- un nouveau jeu de features nécessite un nouveau "
          "modèle, le scaler et les poids actuels ne sont pas compatibles.")


if __name__ == "__main__":
    main()