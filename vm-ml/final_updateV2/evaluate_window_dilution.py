"""
evaluate_window_dilution.py
Teste l'hypothèse de dilution du signal par fenêtrage, INDÉPENDAMMENT de la
question IP/persistance (ne nécessite PAS Source IP -> utilise directement
global_mixed_test_16f.csv existant).

Compare 4 configurations :
  A) Baseline actuelle       : label="any packet attack", score=mean(MSE)
  B) Label majoritaire       : label=">=50% packets attack", score=mean(MSE)
  C) Score max                : label="any packet attack", score=max(MSE)
  D) Combinaison              : label=">=50%", score=max(MSE)

Pour chaque configuration, applique la règle hybride de production
(vote>=4 OU mse>=seuil) et rapporte recall/FPR/F1, afin d'isoler l'effet du
fenêtrage/labeling de celui du seuillage (déjà testé précédemment).
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
SCHEMA_FEATURES = "selected_features_global.json"
DOSSIER_MODELE = "modele_deep_lstm_vae_16features"
VOTE_MINIMUM = 4
SEUIL_MAJORITE = 0.5  # >= 50% de paquets attaque dans la fenêtre

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


def labels_majorite(labels_bruts, taille_fenetre, seuil):
    n = len(labels_bruts) - taille_fenetre + 1
    out = np.zeros(n, dtype=np.int32)
    for i in range(n):
        fenetre = labels_bruts[i : i + taille_fenetre]
        out[i] = 1 if np.mean(fenetre == 1) >= seuil else 0
    return out


def rapporter(nom, y_true, y_pred):
    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="binary", zero_division=0
    )
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
    print(f" {nom:45s} | Recall={recall*100:6.2f}%  Precision={precision*100:6.2f}%  "
          f"F1={f1*100:6.2f}%  FPR={fpr*100:6.2f}%  (TP={tp} FN={fn} FP={fp} TN={tn})")
    return {"recall": float(recall), "precision": float(precision),
            "f1_score": float(f1), "fpr": float(fpr),
            "tp": int(tp), "fn": int(fn), "fp": int(fp), "tn": int(tn)}


def main():
    with open(SCHEMA_FEATURES) as f:
        FEATURES = json.load(f)
    NB_FEATURES = len(FEATURES)

    with open(CHEMIN_METADATA) as f:
        metadata = json.load(f)
    seuil_global = float(metadata.get("seuil_1sigma_baseline", 26.095900))
    seuils_p98 = np.array(
        metadata.get("feature_p98_thresholds", [seuil_global] * NB_FEATURES), dtype=np.float32
    )

    scaler = joblib.load(CHEMIN_SCALER)
    modele = keras.models.load_model(
        CHEMIN_MODELE,
        custom_objects={"CoucheEchantillonnage": CoucheEchantillonnage, "CoucheVAELoss": CoucheVAELoss},
    )
    print("[+] Modèle chargé.\n")

    df = pd.read_csv(CHEMIN_TEST)
    features_brutes = df[FEATURES].values.astype(np.float32)
    features_norm = np.clip(scaler.transform(features_brutes), 0.0, 1.0)
    col_label = next(c for c in ["Label", "label", "class"] if c in df.columns)
    labels_bruts = df[col_label].astype(int).values

    print("[*] Construction des séquences (fenêtrage global, comme précédemment)...")
    sequences = construire_sequences(features_norm, TAILLE_FENETRE)
    n = len(sequences)

    y_true_any = labels_any(labels_bruts, TAILLE_FENETRE)
    y_true_majorite = labels_majorite(labels_bruts, TAILLE_FENETRE, SEUIL_MAJORITE)

    print(f"[*] Fenêtres 'any' positives   : {y_true_any.sum()} / {n}")
    print(f"[*] Fenêtres 'majorité' positives : {y_true_majorite.sum()} / {n}\n")

    print("[*] Inférence par mini-lots...")
    CHUNK = 100_000
    mse_mean_all = np.zeros(n, dtype=np.float32)
    mse_max_all = np.zeros(n, dtype=np.float32)
    vote_count_all = np.zeros(n, dtype=np.int32)

    for idx in range(0, n, CHUNK):
        fin = min(idx + CHUNK, n)
        batch = sequences[idx:fin]
        preds = modele.predict(batch, batch_size=512, verbose=0)

        # Erreur par timestep, par feature -> (batch, window, features)
        err_timestep_feature = np.square(batch - preds) * 1000.0

        # Score A/B : moyenne sur le temps, PUIS moyenne sur les features (comme avant)
        err_par_feature_mean = np.mean(err_timestep_feature, axis=1)  # (batch, features)
        mse_mean_all[idx:fin] = np.mean(err_par_feature_mean, axis=1)
        vote_count_all[idx:fin] = np.sum(err_par_feature_mean > seuils_p98, axis=1)

        # Score C/D : erreur MAX sur le temps (fait ressortir un seul timestep anormal)
        err_par_feature_max = np.max(err_timestep_feature, axis=1)  # (batch, features)
        mse_max_all[idx:fin] = np.mean(err_par_feature_max, axis=1)

        print(f"    -> {fin}/{n} ({(fin/n)*100:.1f}%)")

    pred_mean = ((vote_count_all >= VOTE_MINIMUM) | (mse_mean_all >= seuil_global)).astype(int)
    pred_max = (mse_max_all >= seuil_global).astype(int)  # comparaison seuil global seul, sur score max

    print("\n" + "=" * 100)
    print(" COMPARAISON DES 4 CONFIGURATIONS (règle hybride vote+seuil, sauf score-max = seuil seul)")
    print("=" * 100)
    res_A = rapporter("A) Baseline (label=any, score=mean)      ", y_true_any, pred_mean)
    res_B = rapporter("B) Label majoritaire (score=mean)        ", y_true_majorite, pred_mean)
    res_C = rapporter("C) Score max (label=any)                 ", y_true_any, pred_max)
    res_D = rapporter("D) Label majoritaire + score max         ", y_true_majorite, pred_max)
    print("=" * 100)

    with open(os.path.join(DOSSIER_MODELE, "rapport_dilution_fenetre.json"), "w") as f:
        json.dump({"A_baseline": res_A, "B_label_majoritaire": res_B,
                    "C_score_max": res_C, "D_combinaison": res_D}, f, indent=4)
    print("\n[+] Rapport exporté : rapport_dilution_fenetre.json")


if __name__ == "__main__":
    main()