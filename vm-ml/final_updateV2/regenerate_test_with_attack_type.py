"""
regenerate_test_with_attack_type.py
Identique à feature_selector_global_v2.py (Étape 3 uniquement -- réutilise
selected_features_global.json déjà figé), mais conserve le LIBELLÉ ORIGINAL
de l'attaque ('DDoS', 'PortScan', 'Infiltration', ...) au lieu de le
binariser immédiatement, uniquement pour le jeu de TEST (jamais pour le
train, qui reste 100% bénin binaire).

Ne relance PAS l'ANOVA ni l'entraînement -- le modèle et le scaler existants
restent valides, seul un nouveau fichier de test enrichi est produit.
"""

import glob
import json
import os

import numpy as np
import pandas as pd

DATA_DIR = "cicids2017_data/MachineLearningCVE"
SCHEMA_FEATURES = "selected_features_global.json"
RANDOM_SEED = 42  # identique à feature_selector_global_v2.py

TEST_FILE = "global_mixed_test_16f_with_type.csv"

with open(SCHEMA_FEATURES, "r") as f:
    selected_features = json.load(f)

cols_to_keep = selected_features + ["Label"]

all_csv_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))

open(TEST_FILE, "w").close()
first_write = True

rng = np.random.RandomState(RANDOM_SEED)

for file in all_csv_files:
    print(f"Extraction depuis : {os.path.basename(file)}")
    for chunk in pd.read_csv(file, chunksize=100_000, low_memory=False):
        chunk.columns = chunk.columns.str.strip()

        if not all(c in chunk.columns for c in cols_to_keep):
            continue

        chunk = chunk[cols_to_keep].copy()
        chunk = chunk.replace([np.inf, -np.inf], np.nan).dropna()
        if len(chunk) == 0:
            continue

        # Libellé original conservé (avant binarisation)
        chunk["Label_Type"] = chunk["Label"].astype(str).str.strip()
        chunk["Label"] = chunk["Label_Type"].apply(
            lambda x: 0 if x.upper() == "BENIGN" else 1
        )

        benign_chunk = chunk[chunk["Label"] == 0].copy()
        attack_chunk = chunk[chunk["Label"] == 1].copy()

        # Même logique de split que feature_selector_global_v2.py (20% du bénin -> test)
        mask = rng.rand(len(benign_chunk)) < 0.80
        benign_test = benign_chunk[~mask]

        test_chunk = pd.concat([benign_test, attack_chunk])
        test_chunk.to_csv(TEST_FILE, mode="a", header=first_write, index=False)
        first_write = False

print(f"\n[+] {TEST_FILE} généré, avec la colonne 'Label_Type' (libellé d'attaque original).")
print("[+] Le modèle et le scaler existants restent valides et inchangés.")