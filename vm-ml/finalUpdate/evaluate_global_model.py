"""
evaluate_global_model.py
Évaluation du Deep LSTM-VAE (16 features) sur le dataset de test mixte global.
Calcul des métriques de cybersécurité : Recall, Precision, F1-Score, FPR, Matrice de Confusion.
"""

import os
import json
import numpy as np
import pandas as pd
import joblib

import keras
from keras import layers, ops, Model
from sklearn.metrics import confusion_matrix, classification_report, precision_recall_fscore_support

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

# ============================================================
# DÉFINITION DES COUCHES PERSONNALISÉES (Nécessaire pour Keras)
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
# FONCTIONS UTILITAIRES
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
    """
    Règle de fenêtre : Si au moins un paquet de la fenêtre est une attaque (1), 
    la fenêtre entière est étiquetée comme attaque (1).
    """
    nb_sequences = len(labels_bruts) - taille_fenetre + 1
    labels_seq = np.zeros(nb_sequences, dtype=np.int32)
    for i in range(nb_sequences):
        fenetre = labels_bruts[i : i + taille_fenetre]
        if np.any(fenetre == 1):
            labels_seq[i] = 1
    return labels_seq

# ============================================================
# MAIN
# ============================================================
def main():
    print("[1/5] Chargement des artefacts industriels et du contrat...")
    if not os.path.exists(SCHEMA_FEATURES):
        raise FileNotFoundError(f"Schéma {SCHEMA_FEATURES} introuvable.")
    with open(SCHEMA_FEATURES, "r") as f:
        FEATURES = json.load(f)

    if not os.path.exists(CHEMIN_METADATA):
        raise FileNotFoundError(f"Métadonnées {CHEMIN_METADATA} introuvables.")
    with open(CHEMIN_METADATA, "r") as f:
        metadata = json.load(f)
    seuil_alerte = metadata["seuil_3sigma_baseline"]
    print(f"[*] Seuil d'alerte (3-Sigma) chargé : {seuil_alerte:.4f}")

    scaler = joblib.load(CHEMIN_SCALER)
    
    # Chargement du modèle avec custom_objects pour Keras 3
    modele = keras.models.load_model(
        CHEMIN_MODELE, 
        custom_objects={
            "CoucheEchantillonnage": CoucheEchantillonnage,
            "CoucheVAELoss": CoucheVAELoss
        }
    )
    print("[+] Modèle Deep LSTM-VAE chargé avec succès.")

    print(f"[2/5] Chargement du dataset de test mixte : {CHEMIN_TEST}...")
    df_test = pd.read_csv(CHEMIN_TEST)

    # Validation et extraction des features
    missing = [f for f in FEATURES if f not in df_test.columns]
    if missing:
        raise ValueError(f"Features manquantes dans le test : {missing}")

    features_brutes = df_test[FEATURES].values.astype(np.float32)
    features_norm = np.clip(scaler.transform(features_brutes), 0.0, 1.0)

    # Gestion des labels (0 = BENIGN, 1 = Attaque)
    col_label = next((col for col in ['Label', 'label', 'class'] if col in df_test.columns), None)
    if col_label is None:
        raise ValueError("Colonne de labels introuvable dans le dataset de test.")
    
    labels_bruts = np.where(df_test[col_label].astype(str).str.upper().str.contains("BENIGN"), 0, 1)

    print("[3/5] Construction des séquences temporelles et des labels de fenêtres...")
    sequences_test = construire_sequences(features_norm, TAILLE_FENETRE)
    y_true = construire_labels_fenetres(labels_bruts, TAILLE_FENETRE)

    print(f"[4/5] Inférence et calcul des erreurs MSE sur {len(sequences_test)} séquences...")
    reconstructions = modele.predict(sequences_test, batch_size=512, verbose=1)
    # Erreur de reconstruction MSE mise à l'échelle (identique à l'entraînement)
    erreurs_mse = np.mean(np.square(sequences_test - reconstructions), axis=(1, 2)) * 1000.0

    print("[5/5] Application du seuil et calcul des métriques de performance...")
    y_pred = np.where(erreurs_mse > seuil_alerte, 1, 0)

    # Matrice de confusion et métriques
    cm = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = cm.ravel()

    precision, recall, f1, _ = precision_recall_fscore_support(y_true, y_pred, average='binary', zero_division=0)
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

    print("\n" + "="*50)
    print(" RAPPORT D'ÉVALUATION - NG-IDPS HYBRIDE (LSTM-VAE 16F)")
    print("="*50)
    print(f" Seuil d'évaluation (MSE * 1000) : {seuil_alerte:.4f}")
    print(f" Vrais Négatifs (TN)             : {tn}")
    print(f" Faux Positifs (FP)              : {fp}  (Taux de FPR : {fpr:.4f})")
    print(f" Faux Négatifs (FN)              : {fn}")
    print(f" Vrais Positifs (TP)             : {tp}")
    print("-"*50)
    print(f" Précision (Precision)           : {precision * 100:.2f}%")
    print(f" Rappel (Recall)                 : {recall * 100:.2f}%")
    print(f" Score F1 (F1-Score)             : {f1 * 100:.2f}%")
    print("="*50)

    # Sauvegarde des résultats d'évaluation pour le rapport de Master
    resultats = {
        "seuil_utilise": seuil_alerte,
        "true_negatives": int(tn),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "true_positives": int(tp),
        "precision": float(precision),
        "recall": float(recall),
        "f1_score": float(f1),
        "fpr": float(fpr)
    }
    with open(os.path.join(DOSSIER_MODELE, "rapport_evaluation.json"), "w") as f:
        json.dump(resultats, f, indent=4)
    print("[+] Rapport d'évaluation exporté dans le dossier du modèle.")

if __name__ == "__main__":
    main()