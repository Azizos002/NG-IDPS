"""
sweep_threshold.py
Balaye le seuil global de décision (MSE) entre une borne basse et le seuil
actuel (calibré à 1-sigma), et rapporte à chaque valeur :

  - Recall / Precision / FPR / F1 sur le VRAI jeu de test
    (global_mixed_test_16f.csv)
  - Le taux de détection sur la catégorie synthétique 3 (anomalie discrète,
    +1.5 sigma) -- même génération que generate_controlled_test.py, seed
    identique pour reproductibilité.
  - Le taux de FAUX POSITIFS sur la catégorie synthétique 1 (bénin pur), pour
    s'assurer qu'on ne dégrade pas le comportement sain en baissant le seuil.

L'inférence lourde (passage du modèle) n'est faite qu'UNE SEULE FOIS par
jeu de données ; le balayage de seuil ensuite est un simple test numérique
sur les erreurs déjà calculées (rapide).
"""

import os
import json

import numpy as np
import pandas as pd
import joblib

import keras
from keras import layers, ops
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support

TAILLE_FENETRE = 10
CHEMIN_TEST = "global_mixed_test_16f.csv"
CHEMIN_TRAIN = "global_benign_train_16f.csv"
SCHEMA_FEATURES = "selected_features_global.json"
DOSSIER_MODELE = "modele_deep_lstm_vae_16features"

CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "deep_lstm_vae_16f.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "global_scaler_16f.pkl")
CHEMIN_METADATA = os.path.join(DOSSIER_MODELE, "metadata_modele.json")

N_SEQUENCES_SYNTHETIQUE = 200
FACTEUR_ANOMALIE_DISCRETE = 1.5

# Bornes du balayage : de nettement en dessous du bénin (marge de sécurité)
# jusqu'au seuil actuel calibré à 1-sigma.
SEUIL_MIN = 8.0
SEUIL_MAX = None  # sera fixé au seuil_1sigma_baseline actuel
NB_PAS = 20


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


def construire_sequences(data, taille_fenetre):
    n = len(data) - taille_fenetre + 1
    if n <= 0:
        return np.array([])
    seqs = np.zeros((n, taille_fenetre, data.shape[1]), dtype=np.float32)
    for i in range(n):
        seqs[i] = data[i : i + taille_fenetre]
    return seqs


def labels_any(labels_bruts, taille_fenetre):
    n = len(labels_bruts) - taille_fenetre + 1
    out = np.zeros(n, dtype=np.int32)
    for i in range(n):
        out[i] = 1 if np.any(labels_bruts[i : i + taille_fenetre] == 1) else 0
    return out


def generer_categorie(mu_raw, sigma_raw, nb_features, n_seq, taille_fenetre, facteur, rng):
    sequences = np.zeros((n_seq, taille_fenetre, nb_features), dtype=np.float32)
    for i in range(n_seq):
        base = rng.normal(loc=mu_raw, scale=sigma_raw, size=(taille_fenetre, nb_features))
        base = np.clip(base, a_min=0.0, a_max=None)
        if facteur > 0:
            base = base + facteur * sigma_raw
        sequences[i] = base
    return sequences


def calculer_mse_global(modele, sequences, chunk=100_000):
    n = len(sequences)
    mse_all = np.zeros(n, dtype=np.float32)
    for idx in range(0, n, chunk):
        fin = min(idx + chunk, n)
        preds = modele.predict(sequences[idx:fin], batch_size=512, verbose=0)
        err = np.mean(np.square(sequences[idx:fin] - preds), axis=(1, 2)) * 1000.0
        mse_all[idx:fin] = err
        print(f"    -> {fin}/{n} ({(fin/n)*100:.1f}%)")
    return mse_all


def main():
    global SEUIL_MAX

    print("[1/5] Chargement du modèle, du scaler et des métadonnées...")
    with open(SCHEMA_FEATURES) as f:
        FEATURES = json.load(f)
    NB_FEATURES = len(FEATURES)

    with open(CHEMIN_METADATA) as f:
        metadata = json.load(f)
    seuil_actuel = float(metadata["seuil_1sigma_baseline"])
    SEUIL_MAX = seuil_actuel

    scaler = joblib.load(CHEMIN_SCALER)
    modele = keras.models.load_model(
        CHEMIN_MODELE,
        custom_objects={"CoucheEchantillonnage": CoucheEchantillonnage, "CoucheVAELoss": CoucheVAELoss},
    )
    print(f"[+] Seuil actuel (borne haute du balayage) : {seuil_actuel:.4f}\n")

    print("[2/5] Inférence sur le VRAI jeu de test (une seule fois)...")
    df_test = pd.read_csv(CHEMIN_TEST)
    features_brutes = df_test[FEATURES].values.astype(np.float32)
    features_norm = np.clip(scaler.transform(features_brutes), 0.0, 1.0)
    col_label = next(c for c in ["Label", "label", "class"] if c in df_test.columns)
    labels_bruts = df_test[col_label].astype(int).values

    sequences_test = construire_sequences(features_norm, TAILLE_FENETRE)
    y_true_test = labels_any(labels_bruts, TAILLE_FENETRE)
    mse_test = calculer_mse_global(modele, sequences_test)

    print("\n[3/5] Génération et inférence sur les catégories synthétiques (contrôle)...")
    df_train = pd.read_csv(CHEMIN_TRAIN)[FEATURES]
    mu_raw = df_train.mean().values.astype(np.float32)
    sigma_raw = df_train.std().values.astype(np.float32)
    rng = np.random.RandomState(123)  # même seed que generate_controlled_test.py

    seq_benin = generer_categorie(mu_raw, sigma_raw, NB_FEATURES, N_SEQUENCES_SYNTHETIQUE,
                                   TAILLE_FENETRE, facteur=0.0, rng=rng)
    seq_discrete = generer_categorie(mu_raw, sigma_raw, NB_FEATURES, N_SEQUENCES_SYNTHETIQUE,
                                      TAILLE_FENETRE, facteur=FACTEUR_ANOMALIE_DISCRETE, rng=rng)

    def normaliser(seqs):
        n = len(seqs)
        return np.clip(scaler.transform(seqs.reshape(-1, NB_FEATURES)), 0.0, 1.0) \
            .reshape(n, TAILLE_FENETRE, NB_FEATURES).astype(np.float32)

    seq_benin_norm = normaliser(seq_benin)
    seq_discrete_norm = normaliser(seq_discrete)

    preds_benin = modele.predict(seq_benin_norm, batch_size=256, verbose=0)
    mse_benin = np.mean(np.square(seq_benin_norm - preds_benin), axis=(1, 2)) * 1000.0

    preds_discrete = modele.predict(seq_discrete_norm, batch_size=256, verbose=0)
    mse_discrete = np.mean(np.square(seq_discrete_norm - preds_discrete), axis=(1, 2)) * 1000.0

    print("[+] Inférence terminée pour toutes les données. Balayage de seuil (rapide, sans "
          "réinférence)...\n")

    print("[4/5] Balayage de seuil...")
    seuils = np.linspace(SEUIL_MIN, SEUIL_MAX, NB_PAS)

    print("=" * 115)
    print(f" {'Seuil':>8s} | {'Recall (test réel)':>19s} | {'Precision':>10s} | "
          f"{'F1':>7s} | {'FPR (test réel)':>16s} | {'Détect. discrète (synth.)':>26s} | "
          f"{'FP bénin (synth.)':>18s}")
    print("=" * 115)

    lignes_resultats = []
    for seuil in seuils:
        y_pred_test = (mse_test >= seuil).astype(int)
        cm = confusion_matrix(y_true_test, y_pred_test, labels=[0, 1])
        tn, fp, fn, tp = cm.ravel()
        precision, recall, f1, _ = precision_recall_fscore_support(
            y_true_test, y_pred_test, average="binary", zero_division=0
        )
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

        taux_discrete = float(np.mean(mse_discrete >= seuil)) * 100
        taux_fp_benin = float(np.mean(mse_benin >= seuil)) * 100

        print(f" {seuil:8.3f} | {recall*100:18.2f}% | {precision*100:9.2f}% | "
              f"{f1*100:6.2f}% | {fpr*100:15.2f}% | {taux_discrete:25.1f}% | "
              f"{taux_fp_benin:17.1f}%")

        lignes_resultats.append({
            "seuil": float(seuil), "recall": float(recall), "precision": float(precision),
            "f1_score": float(f1), "fpr": float(fpr),
            "taux_detection_synthetique_discrete_pct": taux_discrete,
            "taux_fp_synthetique_benin_pct": taux_fp_benin,
        })

    print("=" * 115)

    print("\n[5/5] Export des résultats...")
    with open(os.path.join(DOSSIER_MODELE, "rapport_sweep_seuil.json"), "w") as f:
        json.dump(lignes_resultats, f, indent=4, ensure_ascii=False)
    print(f"[+] Rapport exporté : {DOSSIER_MODELE}/rapport_sweep_seuil.json")

    print("\n[*] Lecture du tableau : cherche le seuil où le recall commence à monter de façon")
    print("    notable SANS que 'FPR (test réel)' ni 'FP bénin (synth.)' n'explosent. C'est ce")
    print("    seuil-là qui devient le nouveau candidat pour seuil_1sigma_baseline.")


if __name__ == "__main__":
    main()