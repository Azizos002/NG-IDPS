"""
feature_selector.py
Pipeline automatisé de sélection de features non-supervisée :
1. Nettoyage des valeurs corrompues (NaN, Inf)
2. Filtre de variance (Suppression des constantes)
3. Matrice de corrélation de Pearson (Suppression de la multicolinéarité)
4. Création d'un contrat de features (selected_features.json)
"""

import pandas as pd
import numpy as np
import json
from sklearn.feature_selection import VarianceThreshold

CHEMIN_DATA = "cicids2017_data/MachineLearningCVE/Monday-WorkingHours.pcap_ISCX.csv"
SEUIL_VARIANCE = 0.01
SEUIL_CORRELATION = 0.85

def selectionner_features():
    print(f"[*] Chargement du dataset depuis {CHEMIN_DATA}...")
    df = pd.read_csv(CHEMIN_DATA)

    df.columns = df.columns.str.strip()

    # Sécurité : on retire le label s'il est présent
    if 'Label' in df.columns:
        df = df.drop(columns=['Label'])

    print(f"[*] Nombre de lignes initiales : {df.shape[0]} | Nombre de colonnes : {df.shape[1]}")

    # ========================================================
    # ÉTAPE 0 : Nettoyage des valeurs Infinity et NaN
    # ========================================================
    print("[*] Nettoyage des valeurs 'Infinity' et 'NaN'...")
    df.replace([np.inf, -np.inf], np.nan, inplace=True)
    df.dropna(inplace=True)
    print(f"    -> Lignes conservées après nettoyage : {df.shape[0]}")

    # ========================================================
    # ÉTAPE 1 : Filtre de Variance (Variance Threshold)
    # ========================================================
    print("[*] Application du filtre de variance...")
    selector = VarianceThreshold(threshold=SEUIL_VARIANCE)
    selector.fit(df)

    # Conserver uniquement les colonnes dont la variance dépasse le seuil
    colonnes_gardees = df.columns[selector.get_support()]
    df_var = df[colonnes_gardees]
    print(f"    -> Colonnes restantes après filtre de variance : {df_var.shape[1]}")

    # ========================================================
    # ÉTAPE 2 : Élimination de la Multicolinéarité (Corrélation)
    # ========================================================
    print("[*] Calcul de la matrice de corrélation de Pearson...")
    matrice_corr = df_var.corr().abs()

    # Création d'un masque triangulaire supérieur pour identifier les doublons
    upper_tri = matrice_corr.where(np.triu(np.ones(matrice_corr.shape), k=1).astype(bool))

    # Trouver les features fortement corrélées (> SEUIL_CORRELATION)
    To_drop = [column for column in upper_tri.columns if any(upper_tri[column] > SEUIL_CORRELATION)]

    print(f"    -> {len(To_drop)} colonnes hautement redondantes détectées : {To_drop}")

    # Suppression des colonnes colinéaires
    df_final = df_var.drop(columns=To_drop)

    print("\n========================================")
    print(f"[+] RÉSULTAT FINAL : {df_final.shape[1]} features optimales retenues.")
    print("========================================")

    # ========================================================
    # ÉTAPE 3 : Création du contrat de features (JSON)
    # ========================================================
    features_finales = list(df_final.columns)

    metadata_features = {
        "n_features": len(features_finales),
        "features": features_finales
    }

    with open("selected_features.json", "w") as f:
        json.dump(metadata_features, f, indent=4)

    print("\n[+] Feature schema sauvegardé : selected_features.json")

    # Sauvegarde optionnelle du nouveau dataset optimisé
    df_final.to_csv("dataset_optimal_features.csv", index=False)
    print("[+] Dataset sauvegardé sous : dataset_optimal_features.csv")

if __name__ == "__main__":
    selectionner_features()