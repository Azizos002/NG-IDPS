import pandas as pd
import numpy as np
import glob
import os
import json
from sklearn.feature_selection import SelectKBest, f_classif

# Configuration des chemins
DATA_DIR = "cicids2017_data/MachineLearningCVE"
SAMPLE_FRAC = 0.15 # Échantillon de 15% pour éviter la saturation RAM lors de l'ANOVA
TARGET_FEATURES = 16

print("=== ÉTAPE 1 : Échantillonnage Global pour ANOVA ===")
all_csv_files = glob.glob(os.path.join(DATA_DIR, "*.csv"))
sampled_dfs = []

# Colonnes inutiles ou posant problème
columns_to_drop = ['Flow ID', 'Source IP', 'Destination IP', 'Timestamp', 'SimillarHTTP']

for file in all_csv_files:
    print(f"Lecture et échantillonnage : {os.path.basename(file)}")
    df = pd.read_csv(file, on_bad_lines='skip', low_memory=False)
    df.columns = df.columns.str.strip()
    
    # Nettoyage
    cols_to_drop_actual = [c for c in columns_to_drop if c in df.columns]
    df = df.drop(columns=cols_to_drop_actual)
    df = df.replace([np.inf, -np.inf], np.nan).dropna()
    
    # Prélèvement d'un échantillon représentatif
    df_sample = df.sample(frac=SAMPLE_FRAC, random_state=42)
    sampled_dfs.append(df_sample)

# Fusion des échantillons
df_global_sample = pd.concat(sampled_dfs, ignore_index=True)
del sampled_dfs # Libération de la mémoire

df_global_sample['Label_Binary'] = df_global_sample['Label'].apply(lambda x: 0 if str(x).strip().upper() == 'BENIGN' else 1)
X = df_global_sample.drop(columns=['Label', 'Label_Binary'])
y = df_global_sample['Label_Binary']

print("\n=== ÉTAPE 2 : Sélection des Features (SelectKBest) ===")
selector = SelectKBest(score_func=f_classif, k=TARGET_FEATURES)
selector.fit(X, y)

selected_features = X.columns[selector.get_support()].tolist()

print(f"\nTop {TARGET_FEATURES} features universelles conservées :")
for feat in selected_features:
    print(f"- {feat}")

with open('selected_features_global.json', 'w') as f:
    json.dump(selected_features, f)

del df_global_sample, X, y 

print("\n=== ÉTAPE 3 : Génération des Datasets Finaux (Par Chunks) ===")
cols_to_keep = selected_features + ['Label']
train_file = "global_benign_train_16f.csv"
test_file = "global_mixed_test_16f.csv"

open(train_file, 'w').close()
open(test_file, 'w').close()

first_write_train = True
first_write_test = True

for file in all_csv_files:
    print(f"Extraction finale depuis : {os.path.basename(file)}")
    # Traitement par blocs de 100 000 lignes
    for chunk in pd.read_csv(file, chunksize=100000, low_memory=False):
        chunk.columns = chunk.columns.str.strip()
        
        if not all(c in chunk.columns for c in cols_to_keep):
            continue 
            
        chunk = chunk[cols_to_keep]
        chunk = chunk.replace([np.inf, -np.inf], np.nan).dropna()
        
        # CORRECTION : Binarisation immédiate en entiers (0 ou 1)
        chunk['Label'] = chunk['Label'].apply(lambda x: 0 if str(x).strip().upper() == 'BENIGN' else 1)
        
        # Séparation du trafic (0 = Benign, 1 = Attaque)
        benign_chunk = chunk[chunk['Label'] == 0].copy()
        attack_chunk = chunk[chunk['Label'] == 1].copy()
        
        # Split 80/20 pour le trafic sain
        mask = np.random.rand(len(benign_chunk)) < 0.80
        benign_train = benign_chunk[mask]
        benign_test = benign_chunk[~mask]
        
        # Construction du dataset de test (20% sain + 100% attaques)
        test_chunk = pd.concat([benign_test, attack_chunk])
        
        # Écriture incrémentale sur disque sans erreur de type
        benign_train.to_csv(train_file, mode='a', header=first_write_train, index=False)
        test_chunk.to_csv(test_file, mode='a', header=first_write_test, index=False)
        
        first_write_train = False
        first_write_test = False

print(f"\n✅ Fichiers prêts : {train_file} (Entraînement LSTM-VAE) et {test_file} (Validation Seuil MSE).")