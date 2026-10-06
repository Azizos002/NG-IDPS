"""extract_datasets_balanced_v2.py -- identique aux précédents, pointé sur selected_features_balanced_v2.json."""

import glob
import json
import os

import numpy as np
import pandas as pd

DATA_DIR = "cicids2017_data/MachineLearningCVE"
SCHEMA_FEATURES = "selected_features_balanced_v2.json"
RANDOM_SEED = 42

TRAIN_FILE = "global_benign_train_balanced_v2.csv"
TEST_FILE = "global_mixed_test_balanced_v2.csv"

with open(SCHEMA_FEATURES) as f:
    selected_features = json.load(f)

cols_to_keep = selected_features + ["Label"]
all_csv_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))

open(TRAIN_FILE, "w").close()
open(TEST_FILE, "w").close()
first_write_train = True
first_write_test = True
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

        chunk["Label"] = chunk["Label"].apply(lambda x: 0 if str(x).strip().upper() == "BENIGN" else 1)
        benign_chunk = chunk[chunk["Label"] == 0].copy()
        attack_chunk = chunk[chunk["Label"] == 1].copy()

        mask = rng.rand(len(benign_chunk)) < 0.80
        benign_train = benign_chunk[mask]
        benign_test = benign_chunk[~mask]
        test_chunk = pd.concat([benign_test, attack_chunk])

        benign_train.to_csv(TRAIN_FILE, mode="a", header=first_write_train, index=False)
        test_chunk.to_csv(TEST_FILE, mode="a", header=first_write_test, index=False)
        first_write_train = False
        first_write_test = False

print(f"\n[+] {TRAIN_FILE} et {TEST_FILE} générés ({len(selected_features)} features).")