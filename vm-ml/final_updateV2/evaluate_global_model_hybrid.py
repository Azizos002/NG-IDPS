"""
evaluate_global_model_hybrid.py
Évaluation du Deep LSTM-VAE (16 features) en répliquant EXACTEMENT la règle
de décision déployée dans realtime_interface.py :

    anomalie = (vote_count >= 4 features au-dessus de leur seuil P98)
               OR (MSE_global >= seuil_1sigma_baseline)

L'ancien evaluate_global_model.py ne teste QUE le second terme (MSE_global
seul). Ce script calcule les deux métriques côte à côte pour mesurer l'écart :
  - "global_only"  : reproduit l'ancien comportement (référence / comparaison)
  - "hybrid"        : reproduit la règle réellement déployée (vote OR seuil)
"""

import os
import json
import numpy as np
import pandas as pd
import joblib

import keras
from keras import layers, ops
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support

# ============================================================
# CONFIGURATION
# ============================================================
TAILLE_FENETRE = 10
CHEMIN_TEST = "global_mixed_test_16f.csv"
SCHEMA_FEATURES = "selected_features_global.json"
DOSSIER_MODELE = "modele_deep_lstm_vae_16features"

CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "deep_lstm_vae_16f.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "global_scaler_16f.pkl")
CHEMIN_METADATA = os.path.join(DOSSIER_MODELE, "metadata_modele.json")

VOTE_MINIMUM = 4  # doit rester identique à realtime_interface.py


# ============================================================
# COUCHES PERSONNALISÉES (nécessaires pour charger le modèle Keras 3)
# ============================================================
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


# ============================================================
# UTILITAIRES
# ============================================================
def construire_sequences(data, taille_fenetre):
    nb_sequences = len(data) - taille_fenetre + 1
    if nb_sequences <= 0:
        return np.array([])
    sequences = np.zeros((nb_sequences, taille_fenetre, data.shape[1]), dtype=np.float32)
    for i in range(nb_sequences):
        sequences[i] = data[i : i + taille_fenetre]
    return sequences


def construire_labels_fenetres(labels_bruts, taille_fenetre):
    """Fenêtre étiquetée attaque (1) si au moins un paquet de la fenêtre l'est."""
    nb_sequences = len(labels_bruts) - taille_fenetre + 1
    labels_seq = np.zeros(nb_sequences, dtype=np.int32)
    for i in range(nb_sequences):
        fenetre = labels_bruts[i : i + taille_fenetre]
        if np.any(fenetre == 1):
            labels_seq[i] = 1
    return labels_seq


def rapporter(nom, y_true, y_pred, seuil_info):
    cm = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = cm.ravel()
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="binary", zero_division=0
    )
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

    print("\n" + "=" * 60)
    print(f" RAPPORT D'ÉVALUATION — {nom}")
    print(f" ({seuil_info})")
    print("=" * 60)
    print(f" TN={tn}  FP={fp} (FPR={fpr:.4f})  FN={fn}  TP={tp}")
    print(f" Précision : {precision*100:.2f}%")
    print(f" Rappel    : {recall*100:.2f}%")
    print(f" F1-score  : {f1*100:.2f}%")
    print("=" * 60)

    return {
        "true_negatives": int(tn), "false_positives": int(fp),
        "false_negatives": int(fn), "true_positives": int(tp),
        "precision": float(precision), "recall": float(recall),
        "f1_score": float(f1), "fpr": float(fpr),
    }


# ============================================================
# MAIN
# ============================================================
def main():
    print("[1/5] Chargement des artefacts et du contrat de features...")
    with open(SCHEMA_FEATURES, "r") as f:
        FEATURES = json.load(f)
    NB_FEATURES = len(FEATURES)

    with open(CHEMIN_METADATA, "r") as f:
        metadata = json.load(f)

    seuil_global = float(metadata.get("seuil_1sigma_baseline", 26.095900))
    seuils_p98 = np.array(
        metadata.get("feature_p98_thresholds", [seuil_global] * NB_FEATURES),
        dtype=np.float32,
    )
    if len(seuils_p98) != NB_FEATURES:
        raise ValueError(
            f"feature_p98_thresholds a {len(seuils_p98)} valeurs, "
            f"attendu {NB_FEATURES} (une par feature)."
        )

    print(f"[*] Seuil global (1-sigma) : {seuil_global:.4f}")
    print(f"[*] Seuils P98 par feature : {seuils_p98}")
    print(f"[*] Vote minimum pour anomalie : {VOTE_MINIMUM}/{NB_FEATURES}")

    scaler = joblib.load(CHEMIN_SCALER)
    modele = keras.models.load_model(
        CHEMIN_MODELE,
        custom_objects={
            "CoucheEchantillonnage": CoucheEchantillonnage,
            "CoucheVAELoss": CoucheVAELoss,
        },
    )
    print("[+] Modèle chargé avec succès.")

    print(f"[2/5] Chargement du dataset de test : {CHEMIN_TEST}...")
    df_test = pd.read_csv(CHEMIN_TEST)

    missing = [f for f in FEATURES if f not in df_test.columns]
    if missing:
        raise ValueError(f"Features manquantes dans le test : {missing}")

    features_brutes = df_test[FEATURES].values.astype(np.float32)
    features_norm = np.clip(scaler.transform(features_brutes), 0.0, 1.0)

    col_label = next((c for c in ["Label", "label", "class"] if c in df_test.columns), None)
    if col_label is None:
        raise ValueError("Colonne de labels introuvable.")
    labels_bruts = df_test[col_label].astype(int).values

    print("[3/5] Construction des séquences et labels de fenêtres...")
    sequences_test = construire_sequences(features_norm, TAILLE_FENETRE)
    y_true = construire_labels_fenetres(labels_bruts, TAILLE_FENETRE)

    print(f"[4/5] Inférence par mini-lots sur {len(sequences_test)} séquences...")
    CHUNK_EVAL = 100_000
    nb_seq_total = len(sequences_test)

    mse_global_all = np.zeros(nb_seq_total, dtype=np.float32)
    vote_count_all = np.zeros(nb_seq_total, dtype=np.int32)

    for idx in range(0, nb_seq_total, CHUNK_EVAL):
        fin = min(idx + CHUNK_EVAL, nb_seq_total)
        batch_seq = sequences_test[idx:fin]

        preds = modele.predict(batch_seq, batch_size=512, verbose=0)

        # Erreur MSE par feature, par séquence -> shape (batch, NB_FEATURES)
        erreurs_par_feature = np.mean(np.square(batch_seq - preds), axis=1) * 1000.0

        # MSE global (moyenne des features) -> identique à l'ancien script
        mse_global_all[idx:fin] = np.mean(erreurs_par_feature, axis=1)

        # Vote : nombre de features au-dessus de leur seuil P98 individuel
        exceed_matrix = erreurs_par_feature > seuils_p98
        vote_count_all[idx:fin] = np.sum(exceed_matrix, axis=1)

        print(f"    -> {fin}/{nb_seq_total} séquences ({(fin/nb_seq_total)*100:.1f}%)")

    print("[+] Inférence terminée.")

    print("[5/5] Calcul des métriques — comparaison des deux règles de décision...")

    # Règle A : ancien comportement (MSE global seul) — pour référence/comparaison
    y_pred_global_only = np.where(mse_global_all > seuil_global, 1, 0)
    resultats_global = rapporter(
        "NG-IDPS — MSE global seul (ancienne évaluation)",
        y_true, y_pred_global_only,
        f"seuil={seuil_global:.4f}",
    )

    # Règle B : règle hybride réellement déployée (vote OR seuil global)
    y_pred_hybrid = np.where(
        (vote_count_all >= VOTE_MINIMUM) | (mse_global_all >= seuil_global), 1, 0
    )
    resultats_hybrid = rapporter(
        "NG-IDPS — Règle hybride déployée (vote>=4 OU MSE_global>=seuil)",
        y_true, y_pred_hybrid,
        f"seuil={seuil_global:.4f}, vote_min={VOTE_MINIMUM}",
    )

    delta_recall = (resultats_hybrid["recall"] - resultats_global["recall"]) * 100
    delta_fpr = (resultats_hybrid["fpr"] - resultats_global["fpr"]) * 100
    print("\n" + "#" * 60)
    print(f" ÉCART hybride vs global-seul : "
          f"Δrecall = {delta_recall:+.2f} pts | Δfpr = {delta_fpr:+.2f} pts")
    print("#" * 60)

    with open(os.path.join(DOSSIER_MODELE, "rapport_evaluation_global_only.json"), "w") as f:
        json.dump(resultats_global, f, indent=4)
    with open(os.path.join(DOSSIER_MODELE, "rapport_evaluation_hybrid.json"), "w") as f:
        json.dump(resultats_hybrid, f, indent=4)
    print("[+] Rapports exportés (global_only + hybrid) dans le dossier du modèle.")


if __name__ == "__main__":
    main()