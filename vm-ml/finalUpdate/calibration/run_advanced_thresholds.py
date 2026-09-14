"""
run_advanced_thresholds.py
Evaluates supervised and ROC-optimized threshold strategies:
1. Youden's J-Index (Maximizes TPR - FPR)
2. Distance to (0,1) (Minimizes distance to top-left corner of ROC)
3. F0.5-Score Maximization (Penalizes False Positives heavily for SOC alert fatigue)
"""

import os
import json
import numpy as np
import pandas as pd
import joblib
import keras
from keras import layers, ops
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support, roc_curve

# ============================================================
# CONFIGURATION & CUSTOM LAYERS
# ============================================================
TAILLE_FENETRE = 10
CHEMIN_TEST = "global_mixed_test_16f.csv"
SCHEMA_FEATURES = "selected_features_global.json"
DOSSIER_MODELE = "modele_deep_lstm_vae_16features"

CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "deep_lstm_vae_16f.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "global_scaler_16f.pkl")

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
# MAIN EXECUTION
# ============================================================
def main():
    print("[1/3] Loading model, scaler, and test dataset...")
    with open(SCHEMA_FEATURES, "r") as f:
        FEATURES = json.load(f)
    
    scaler = joblib.load(CHEMIN_SCALER)
    modele = keras.models.load_model(
        CHEMIN_MODELE,
        custom_objects={"CoucheEchantillonnage": CoucheEchantillonnage, "CoucheVAELoss": CoucheVAELoss}
    )

    df_test = pd.read_csv(CHEMIN_TEST)
    features_brutes = df_test[FEATURES].values.astype(np.float32)
    features_norm = np.clip(scaler.transform(features_brutes), 0.0, 1.0)
    
    col_label = next((col for col in ['Label', 'label', 'class'] if col in df_test.columns), None)
    labels_bruts = df_test[col_label].astype(int).values

    nb_seq = len(features_norm) - TAILLE_FENETRE + 1
    sequences_test = np.zeros((nb_seq, TAILLE_FENETRE, len(FEATURES)), dtype=np.float32)
    y_true = np.zeros(nb_seq, dtype=np.int32)

    for i in range(nb_seq):
        sequences_test[i] = features_norm[i : i + TAILLE_FENETRE]
        if np.any(labels_bruts[i : i + TAILLE_FENETRE] == 1):
            y_true[i] = 1

    print("[2/3] Running mini-batch inference (Anti-OOM)...")
    CHUNK_EVAL = 100_000
    erreurs_mse = np.zeros(nb_seq, dtype=np.float32)
    for idx in range(0, nb_seq, CHUNK_EVAL):
        fin = min(idx + CHUNK_EVAL, nb_seq)
        batch_seq = sequences_test[idx:fin]
        preds = modele.predict(batch_seq, batch_size=512, verbose=0)
        erreurs_mse[idx:fin] = np.mean(np.square(batch_seq - preds), axis=(1, 2)) * 1000.0

    print("[3/3] Optimizing Supervised Thresholds (Youden, Distance, F0.5)...")
    fpr_array, tpr_array, thresholds = roc_curve(y_true, erreurs_mse)

    # 1. Youden's J-Index
    j_scores = tpr_array - fpr_array
    thresh_youden = thresholds[np.argmax(j_scores)]

    # 2. Distance to Perfect Classifier (0,1)
    distances = np.sqrt((1 - tpr_array)**2 + fpr_array**2)
    thresh_dist = thresholds[np.argmin(distances)]

    # 3. F0.5 Grid Search (Precision-focused)
    best_f05 = -1
    thresh_f05 = thresholds[0]
    candidate_threshs = np.percentile(erreurs_mse, np.linspace(80, 99.9, 200))
    for t in candidate_threshs:
        y_pred = np.where(erreurs_mse > t, 1, 0)
        p, r, _, _ = precision_recall_fscore_support(y_true, y_pred, average='binary', zero_division=0)
        if (0.25 * p + r) > 0:
            f05 = (1 + 0.25) * (p * r) / ((0.25 * p) + r)
            if f05 > best_f05:
                best_f05 = f05
                thresh_f05 = t

    adv_strategies = {
        "Youden's J-Index": thresh_youden,
        "Distance to (0,1)": thresh_dist,
        "F0.5 Optimization": thresh_f05
    }

    results = []
    for name, threshold in adv_strategies.items():
        y_pred = np.where(erreurs_mse > threshold, 1, 0)
        cm = confusion_matrix(y_true, y_pred)
        tn, fp, fn, tp = cm.ravel()
        precision, recall, f1, _ = precision_recall_fscore_support(y_true, y_pred, average='binary', zero_division=0)
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

        results.append({
            "Strategy": name,
            "Threshold": round(float(threshold), 4),
            "FPR (%)": round(float(fpr) * 100, 2),
            "Precision (%)": round(float(precision) * 100, 2),
            "Recall (%)": round(float(recall) * 100, 2),
            "F1-Score (%)": round(float(f1) * 100, 2)
        })

    print("\n" + "="*70)
    print(" SUPERVISED / ROC-DRIVEN THRESHOLD OPTIMIZATION REPORT")
    print("="*70)
    df_res = pd.DataFrame(results)
    print(df_res.to_string(index=False))
    print("="*70)

    # Save output for your thesis
    df_res.to_json(os.path.join(DOSSIER_MODELE, "supervised_threshold_results.json"), orient="records", indent=4)
    print("[+] Results saved to supervised_threshold_results.json")

if __name__ == "__main__":
    main()