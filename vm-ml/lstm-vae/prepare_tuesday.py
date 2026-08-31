"""
prepare_tuesday_optimal.py
Extrait exactement les 32 features optimales du dataset du Mardi (pour test)
"""
import pandas as pd
import numpy as np

CHEMIN_TUESDAY_BRUT = "cicids2017_data/MachineLearningCVE/Tuesday-WorkingHours.pcap_ISCX.csv"
CHEMIN_OPTIMAL = "dataset_optimal_features.csv"
CHEMIN_SORTIE_TUESDAY = "tuesday_optimal_features.csv"

def preparer_tuesday():
    print("[*] Récupération de la liste des 32 features optimales...")
    df_opt = pd.read_csv(CHEMIN_OPTIMAL, nrows=0)
    features_a_garder = list(df_opt.columns)

    print(f"[*] Chargement et nettoyage de {CHEMIN_TUESDAY_BRUT}...")
    df = pd.read_csv(CHEMIN_TUESDAY_BRUT, low_memory=False)
    df.columns = df.columns.str.strip()

    # On s'assure de garder les features + le Label pour filtrer le BENIGN
    colonnes_requises = features_a_garder + ["Label"]
    df = df[colonnes_requises].copy()

    # Nettoyage des Inf et NaN
    df.replace([np.inf, -np.inf], np.nan, inplace=True)
    df.dropna(inplace=True)

    # Filtrage du trafic sain (BENIGN)
    df = df[df["Label"].str.strip() == "BENIGN"]
    df = df.drop(columns=["Label"]) # On retire le label pour ne garder que le numérique

    df.to_csv(CHEMIN_SORTIE_TUESDAY, index=False)
    print(f"[+] Dataset de test Tuesday optimal prêt : {CHEMIN_SORTIE_TUESDAY} ({len(df)} lignes)")

if __name__ == "__main__":
    preparer_tuesday()