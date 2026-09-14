"""
run_threshold_benchmark.py
Calculates MSE errors using anti-OOM mini-batching and evaluates performance across:
1. Standard Deviation: 1-Sigma, 2-Sigma, 3-Sigma
2. Empirical Quantiles: P95, P98, P99
3. Extreme Value Theory (EVT/SPOT)
"""

import os
import json
import numpy as np
import pandas as pd
import joblib
import keras
from keras import layers, ops
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support
from scipy.stats import genpareto

# ============================================================
# CONFIGURATION & CUSTOM LAYERS
# ============================================================
TAILLE_FENETRE = 10
CHEMIN_TEST = "global_mixed_test_16f.csv"
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

# ============================================================
# EVT / SPOT CALCULATION
# ============================================================
def calculate_evt_spot(errors, init_quantile=0.98, risk_prob=1e-3):
    t = np.quantile(errors, init_quantile)
    excesses = errors[errors > t] - t
    if len(excesses) < 10:
        return float(np.max(errors))
    c, _, scale = genpareto.fit(excesses, floc=0)
    n = len(errors)
    N_t = len(excesses)
    if abs(c) < 1e-6:
        z_q = t + scale * np.log((N_t / n) / risk_prob)
    else:
        z_q = t + (scale / c) * (((n * risk_prob) / N_t) ** (-c) - 1)
    return float(z_q)

# ============================================================
# MAIN BENCHMARK ENGINE
# ============================================================
def main():
    print("[1/4] Loading metadata, scaler, and model...")
    with open(SCHEMA_FEATURES, "r") as f:
        FEATURES = json.load(f)
    with open(CHEMIN_METADATA, "r") as f:
        metadata = json.load(f)

    scaler = joblib.load(CHEMIN_SCALER)
    modele = keras.models.load_model(
        CHEMIN_MODELE,
        custom_objects={"CoucheEchantillonnage": CoucheEchantillonnage, "CoucheVAELoss": CoucheVAELoss}
    )

    print("[2/4] Loading test dataset and building sequences...")
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

    print("[3/4] Running mini-batch inference (Anti-OOM)...")
    CHUNK_EVAL = 100_000
    erreurs_mse = np.zeros(nb_seq, dtype=np.float32)
    for idx in range(0, nb_seq, CHUNK_EVAL):
        fin = min(idx + CHUNK_EVAL, nb_seq)
        batch_seq = sequences_test[idx:fin]
        preds = modele.predict(batch_seq, batch_size=512, verbose=0)
        erreurs_mse[idx:fin] = np.mean(np.square(batch_seq - preds), axis=(1, 2)) * 1000.0

    print("[4/4] Evaluating all threshold strategies...")
    mu = metadata["mu_validation"]
    sigma = metadata["sigma_validation"]
    benign_mse = erreurs_mse[y_true == 0]

    strategies = {
        "1-Sigma (μ + 1σ)": mu + (1.0 * sigma),
        "2-Sigma (μ + 2σ)": mu + (2.0 * sigma),
        "3-Sigma Baseline": metadata.get("seuil_3sigma_baseline", mu + (3.0 * sigma)),
        "Quantile P95": np.percentile(benign_mse, 95),
        "Quantile P98": np.percentile(benign_mse, 98),
        "Quantile P99": np.percentile(benign_mse, 99),
        "EVT / SPOT Tail": calculate_evt_spot(benign_mse, init_quantile=0.98, risk_prob=1e-3)
    }

    results = []
    for name, threshold in strategies.items():
        y_pred = np.where(erreurs_mse > threshold, 1, 0)
        cm = confusion_matrix(y_true, y_pred)
        tn, fp, fn, tp = cm.ravel()
        precision, recall, f1, _ = precision_recall_fscore_support(y_true, y_pred, average='binary', zero_division=0)
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

        results.append({
            "Strategy": name,
            "Threshold": round(threshold, 4),
            "FPR (%)": round(fpr * 100, 2),
            "Precision (%)": round(precision * 100, 2),
            "Recall (%)": round(recall * 100, 2),
            "F1-Score (%)": round(f1 * 100, 2)
        })

    print("\n" + "="*80)
    print(" COMPREHENSIVE THRESHOLD BENCHMARK REPORT")
    print("="*80)
    df_res = pd.DataFrame(results)
    print(df_res.to_string(index=False))
    print("="*80)

    # Save to JSON for master report
    df_res.to_json(os.path.join(DOSSIER_MODELE, "threshold_benchmark_results.json"), orient="records", indent=4)
    print("[+] Results saved to threshold_benchmark_results.json")

if __name__ == "__main__":
    main()