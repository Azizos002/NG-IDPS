"""
evaluate_by_attack_type.py
Calcule le recall PAR TYPE D'ATTAQUE (DDoS, PortScan, Infiltration, etc.)
avec le modèle et le seuil déjà calibrés, en utilisant
global_mixed_test_16f_with_type.csv (produit par
regenerate_test_with_attack_type.py).

Pour chaque fenêtre de 10 étapes marquée "attaque" (règle "any", comme dans
le reste de l'étude), le type représentatif de la fenêtre est le type
d'attaque majoritaire parmi ses paquets non-bénins. Les fenêtres mélangeant
plusieurs types différents sont comptabilisées séparément ("MIXTE").
"""

import os
import json
from collections import Counter

import numpy as np
import pandas as pd
import joblib

import keras
from keras import layers, ops

TAILLE_FENETRE = 10
CHEMIN_TEST = "global_mixed_test_16f_with_type.csv"
SCHEMA_FEATURES = "selected_features_global.json"
DOSSIER_MODELE = "modele_deep_lstm_vae_16features"

CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "deep_lstm_vae_16f.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "global_scaler_16f.pkl")
CHEMIN_METADATA = os.path.join(DOSSIER_MODELE, "metadata_modele.json")


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
    print("[1/5] Chargement du modèle, du scaler, du seuil calibré...")
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
    print(f"[+] Seuil utilisé : {seuil_global:.4f}\n")

    print(f"[2/5] Chargement de {CHEMIN_TEST}...")
    df = pd.read_csv(CHEMIN_TEST)
    if "Label_Type" not in df.columns:
        raise ValueError("'Label_Type' absente. Lance d'abord regenerate_test_with_attack_type.py.")

    features_brutes = df[FEATURES].values.astype(np.float32)
    features_norm = np.clip(scaler.transform(features_brutes), 0.0, 1.0)
    labels_bin = df["Label"].astype(int).values
    labels_type = df["Label_Type"].astype(str).values

    print("[3/5] Construction des séquences et des labels de type par fenêtre...")
    n_seq = len(features_norm) - TAILLE_FENETRE + 1
    sequences = np.zeros((n_seq, TAILLE_FENETRE, NB_FEATURES), dtype=np.float32)
    y_true = np.zeros(n_seq, dtype=np.int32)
    type_par_fenetre = []

    for i in range(n_seq):
        sequences[i] = features_norm[i : i + TAILLE_FENETRE]
        labs_fenetre = labels_bin[i : i + TAILLE_FENETRE]
        if np.any(labs_fenetre == 1):
            y_true[i] = 1
            types_non_benins = [
                t for t, l in zip(labels_type[i : i + TAILLE_FENETRE], labs_fenetre) if l == 1
            ]
            compte = Counter(types_non_benins)
            types_distincts = list(compte.keys())
            if len(types_distincts) == 1:
                type_par_fenetre.append(types_distincts[0])
            else:
                type_par_fenetre.append("MIXTE(" + "+".join(sorted(types_distincts)) + ")")
        else:
            type_par_fenetre.append("BENIGN")

    type_par_fenetre = np.array(type_par_fenetre)
    print(f"[+] {n_seq} séquences construites, {y_true.sum()} positives.")

    print("[4/5] Inférence par mini-lots...")
    CHUNK = 100_000
    mse_global_all = np.zeros(n_seq, dtype=np.float32)
    for idx in range(0, n_seq, CHUNK):
        fin = min(idx + CHUNK, n_seq)
        preds = modele.predict(sequences[idx:fin], batch_size=512, verbose=0)
        mse_global_all[idx:fin] = np.mean(np.square(sequences[idx:fin] - preds), axis=(1, 2)) * 1000.0
        print(f"    -> {fin}/{n_seq} ({(fin/n_seq)*100:.1f}%)")

    y_pred = (mse_global_all >= seuil_global).astype(int)

    print("\n[5/5] Recall par type d'attaque...")
    print("=" * 90)
    print(f" {'Type':45s} | {'N fenêtres':>10s} | {'Détectées':>10s} | {'Recall':>8s}")
    print("=" * 90)

    resultats = {}
    types_attaque = sorted(set(t for t in type_par_fenetre if t != "BENIGN"))
    for type_attaque in types_attaque:
        mask_type = type_par_fenetre == type_attaque
        n_total = int(mask_type.sum())
        n_detecte = int(np.sum(y_pred[mask_type] == 1))
        recall_type = (n_detecte / n_total * 100) if n_total > 0 else 0.0
        print(f" {type_attaque:45s} | {n_total:10d} | {n_detecte:10d} | {recall_type:7.2f}%")
        resultats[type_attaque] = {
            "n_fenetres": n_total, "n_detectees": n_detecte, "recall_pct": recall_type
        }

    print("=" * 90)

    # Contrôle : FPR sur les fenêtres bénignes de ce même test
    mask_benin = type_par_fenetre == "BENIGN"
    fpr_global = float(np.mean(y_pred[mask_benin] == 1)) * 100
    print(f"\n FPR sur fenêtres bénignes de ce test : {fpr_global:.2f}%")

    with open(os.path.join(DOSSIER_MODELE, "rapport_recall_par_type.json"), "w") as f:
        json.dump({"par_type": resultats, "fpr_benin_pct": fpr_global}, f, indent=4, ensure_ascii=False)
    print(f"\n[+] Rapport exporté : {DOSSIER_MODELE}/rapport_recall_par_type.json")


if __name__ == "__main__":
    main()