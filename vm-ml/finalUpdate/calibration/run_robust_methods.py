"""
run_robust_methods.py
Evaluates advanced robust and multi-feature thresholding techniques:
1. Median Absolute Deviation (MAD) - Robust parametric thresholding
2. Multi-Feature Voting - Feature-wise independent thresholding (triggers if >= K features fail)
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

def main():
    print("[1/4] Loading model, scaler, and metadata...")
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

    print("[3/4] Running mini-batch inference and collecting feature-wise errors...")
    CHUNK_EVAL = 100_000
    erreurs_mse_global = np.zeros(nb_seq, dtype=np.float32)
    
    # Store per-feature squared errors: shape (nb_seq, nb_features)
    erreurs_features_list = []

    for idx in range(0, nb_seq, CHUNK_EVAL):
        fin = min(idx + CHUNK_EVAL, nb_seq)
        batch_seq = sequences_test[idx:fin]
        preds = modele.predict(batch_seq, batch_size=512, verbose=0)
        
        # Global MSE per sequence
        erreurs_mse_global[idx:fin] = np.mean(np.square(batch_seq - preds), axis=(1, 2)) * 1000.0
        
        # Feature-wise MSE per sequence (average over time window axis=1)
        feat_mse = np.mean(np.square(batch_seq - preds), axis=1) * 1000.0
        erreurs_features_list.append(feat_mse)

    erreurs_features = np.vstack(erreurs_features_list)

    print("[4/4] Evaluating MAD Robust Threshold and Multi-Feature Voting...")
    
    # Isolate benign errors for calibration
    benign_global = erreurs_mse_global[y_true == 0]
    benign_features = erreurs_features[y_true == 0]

    results = []

    # --- METHOD 1: MAD (Median Absolute Deviation) ---
    # Formula: Threshold = Median + k * 1.4826 * MAD
    median_val = np.median(benign_global)
    mad_val = np.median(np.abs(benign_global - median_val))
    # Using k=3 scaling factor 1.4826 to match standard deviation scale
    threshold_mad = median_val + (3.0 * 1.4826 * mad_val)

    y_pred_mad = np.where(erreurs_mse_global > threshold_mad, 1, 0)
    cm = confusion_matrix(y_true, y_pred_mad)
    tn, fp, fn, tp = cm.ravel()
    p, r, f1, _ = precision_recall_fscore_support(y_true, y_pred_mad, average='binary', zero_division=0)
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

    results.append({
        "Strategy": "MAD Robust (Median + 3*1.4826*MAD)",
        "Threshold": round(float(threshold_mad), 4),
        "FPR (%)": round(float(fpr) * 100, 2),
        "Precision (%)": round(float(p) * 100, 2),
        "Recall (%)": round(float(r) * 100, 2),
        "F1-Score (%)": round(float(f1) * 100, 2)
    })

    # --- METHOD 2: Multi-Feature Voting (Threshold per feature at P98) ---
    # Compute 98th percentile threshold independently for each of the 16 features
    feature_thresholds = np.percentile(benign_features, 98, axis=0)
    
    # Count how many features exceed their individual threshold per sequence
    exceed_matrix = erreurs_features > feature_thresholds  # boolean matrix (nb_seq, 16)
    num_exceeding_features = np.sum(exceed_matrix, axis=1)

    # Test voting rule: Trigger alert if >= 3 features violate their P98 bounds simultaneously
    for k_votes in [1, 2, 3, 4]:
        y_pred_vote = np.where(num_exceeding_features >= k_votes, 1, 0)
        cm = confusion_matrix(y_true, y_pred_vote)
        tn, fp, fn, tp = cm.ravel()
        p, r, f1, _ = precision_recall_fscore_support(y_true, y_pred_vote, average='binary', zero_division=0)
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

        results.append({
            "Strategy": f"Feature Voting (>= {k_votes}/16 features @ P98)",
            "Threshold": "Dynamic (16 thresholds)",
            "FPR (%)": round(float(fpr) * 100, 2),
            "Precision (%)": round(float(p) * 100, 2),
            "Recall (%)": round(float(r) * 100, 2),
            "F1-Score (%)": round(float(f1) * 100, 2)
        })

    print("\n" + "="*80)
    print(" ROBUST & FEATURE-WISE THRESHOLD BENCHMARK REPORT")
    print("="*80)
    df_res = pd.DataFrame(results)
    print(df_res.to_string(index=False))
    print("="*80)

    df_res.to_json(os.path.join(DOSSIER_MODELE, "robust_threshold_results.json"), orient="records", indent=4)
    print("[+] Results saved to robust_threshold_results.json")

if __name__ == "__main__":
    main()