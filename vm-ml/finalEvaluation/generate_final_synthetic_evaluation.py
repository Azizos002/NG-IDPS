"""
generate_final_synthetic_evaluation.py
Évaluation synthétique FINALE, généralisée à tous les types d'attaque
étudiés (pas seulement PortScan). Pour chaque type détecté dans le
dataset, extrait son VRAI profil statistique (moyenne + écart-type réels
en espace de features équilibrées), construit des séquences synthétiques
contrôlées autour de ce profil, et évalue avec la configuration finale
retenue : modèle équilibré, seuil 1.5-sigma (68.12), règle hybride
(vote>=4 OU seuil).

Deux variantes par type, comme pour le test PortScan initial :
  - PROTOTYPE : 10 étapes = exactement la moyenne réelle (signal le plus pur)
  - RÉALISTE  : 10 étapes tirées de Normal(moyenne, écart-type réels)

Sert de dernière évaluation contrôlée avant rédaction -- vérité terrain
100% connue, aucune dépendance à un split train/test ou à un seuil
optimisé sur les mêmes données.
"""

import glob
import json
import os

import numpy as np
import pandas as pd
import joblib

import keras
from keras import layers, ops

DATA_DIR = "cicids2017_data/MachineLearningCVE"
TAILLE_FENETRE = 10
N_SEQUENCES_PAR_TYPE = 200
RANDOM_SEED = 123

SCHEMA_FEATURES = "selected_features_balanced.json"
CHEMIN_TRAIN_BENIN = "global_benign_train_16f_balanced.csv"
DOSSIER_MODELE = "modele_deep_lstm_vae_16features_balanced"

CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "deep_lstm_vae_16f_balanced.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "scaler_16f_balanced.pkl")
CHEMIN_METADATA = os.path.join(DOSSIER_MODELE, "metadata_modele.json")

VOTE_MINIMUM = 4
columns_to_drop = ['Flow ID', 'Source IP', 'Destination IP', 'Timestamp', 'SimillarHTTP']


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


def generer_sequences(mu, sigma, nb_features, n_seq, taille_fenetre, variance_nulle, rng):
    sequences = np.zeros((n_seq, taille_fenetre, nb_features), dtype=np.float32)
    for i in range(n_seq):
        if variance_nulle:
            base = np.tile(mu, (taille_fenetre, 1))
        else:
            base = rng.normal(loc=mu, scale=sigma, size=(taille_fenetre, nb_features))
            base = np.clip(base, a_min=0.0, a_max=None)
        sequences[i] = base
    return sequences


def evaluer(sequences_brutes, scaler, modele, seuil, seuils_p98, nb_features, taille_fenetre):
    n = len(sequences_brutes)
    sequences_norm = np.clip(
        scaler.transform(sequences_brutes.reshape(-1, nb_features)), 0.0, 1.0
    ).reshape(n, taille_fenetre, nb_features).astype(np.float32)

    preds = modele.predict(sequences_norm, batch_size=256, verbose=0)
    err_par_feature = np.mean(np.square(sequences_norm - preds), axis=1) * 1000.0
    mse_global = np.mean(err_par_feature, axis=1)
    vote_count = np.sum(err_par_feature > seuils_p98, axis=1)

    detecte = (vote_count >= VOTE_MINIMUM) | (mse_global >= seuil)
    return float(np.mean(detecte)) * 100, float(np.mean(mse_global)), float(np.mean(vote_count))


def main():
    print("[1/5] Chargement du modèle, du scaler, du seuil final retenu...")
    with open(SCHEMA_FEATURES) as f:
        FEATURES = json.load(f)
    NB_FEATURES = len(FEATURES)

    with open(CHEMIN_METADATA) as f:
        metadata = json.load(f)
    seuil = float(metadata.get("seuil_operationnel_calibre", metadata.get("seuil_1sigma_baseline")))
    seuils_p98 = np.array(metadata["feature_p98_thresholds"], dtype=np.float32)

    scaler = joblib.load(CHEMIN_SCALER)
    modele = keras.models.load_model(
        CHEMIN_MODELE,
        custom_objects={"CoucheEchantillonnage": CoucheEchantillonnage, "CoucheVAELoss": CoucheVAELoss},
    )
    print(f"[+] Seuil final utilisé : {seuil:.4f} (config retenue, 1.5-sigma)\n")

    print("[2/5] Statistiques du BÉNIN réel (contrôle négatif)...")
    df_benin = pd.read_csv(CHEMIN_TRAIN_BENIN)[FEATURES]
    mu_benin = df_benin.mean().values.astype(np.float32)
    sigma_benin = df_benin.std().values.astype(np.float32)

    print("[3/5] Découverte des types d'attaque et extraction de leurs profils réels...")
    all_csv_files = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))
    profils = {}

    for file in all_csv_files:
        df = pd.read_csv(file, low_memory=False)
        df.columns = df.columns.str.strip()
        cols_to_drop_actual = [c for c in columns_to_drop if c in df.columns]
        df = df.drop(columns=cols_to_drop_actual)
        df = df.replace([np.inf, -np.inf], np.nan).dropna()
        if not all(f in df.columns for f in FEATURES):
            continue
        df["Label"] = df["Label"].astype(str).str.strip()

        types_ici = [t for t in df["Label"].unique() if t.upper() != "BENIGN"]
        for type_attaque in types_ici:
            sous_df = df[df["Label"] == type_attaque][FEATURES]
            if len(sous_df) < 10:
                continue
            mu = sous_df.mean().values.astype(np.float32)
            sigma = np.nan_to_num(sous_df.std().values.astype(np.float32), nan=0.0)
            if type_attaque not in profils:
                profils[type_attaque] = {"mu": mu, "sigma": sigma, "n": len(sous_df)}
            print(f"  [+] '{type_attaque}' : {len(sous_df)} lignes dans {os.path.basename(file)}")

    print(f"\n[+] {len(profils)} types d'attaque avec profil extrait.\n")

    print("[4/5] Génération et évaluation (prototype + réaliste, par type)...")
    rng = np.random.RandomState(RANDOM_SEED)

    print("\n" + "=" * 105)
    print(f" {'Catégorie':45s} | {'Taux détecté':13s} | {'MSE moyen':10s} | {'Votes moyens':13s} | {'N réel':>8s}")
    print("=" * 105)

    resultats = {}

    seq_benin = generer_sequences(mu_benin, sigma_benin, NB_FEATURES, N_SEQUENCES_PAR_TYPE,
                                   TAILLE_FENETRE, variance_nulle=False, rng=rng)
    taux, mse, votes = evaluer(seq_benin, scaler, modele, seuil, seuils_p98, NB_FEATURES, TAILLE_FENETRE)
    print(f" {'BÉNIN (contrôle négatif)':45s} | {taux:11.1f}% | {mse:10.4f} | {votes:13.2f} | {'-':>8s}")
    resultats["BENIGN"] = {"taux_detection_pct": taux, "mse_moyen": mse, "vote_moyen": votes}

    for type_attaque, profil in sorted(profils.items()):
        mu, sigma, n_reel = profil["mu"], profil["sigma"], profil["n"]

        seq_prototype = generer_sequences(mu, sigma, NB_FEATURES, N_SEQUENCES_PAR_TYPE,
                                           TAILLE_FENETRE, variance_nulle=True, rng=rng)
        taux_p, mse_p, votes_p = evaluer(seq_prototype, scaler, modele, seuil, seuils_p98, NB_FEATURES, TAILLE_FENETRE)
        print(f" {type_attaque + ' [PROTOTYPE]':45s} | {taux_p:11.1f}% | {mse_p:10.4f} | {votes_p:13.2f} | {n_reel:8d}")

        seq_realiste = generer_sequences(mu, sigma, NB_FEATURES, N_SEQUENCES_PAR_TYPE,
                                          TAILLE_FENETRE, variance_nulle=False, rng=rng)
        taux_r, mse_r, votes_r = evaluer(seq_realiste, scaler, modele, seuil, seuils_p98, NB_FEATURES, TAILLE_FENETRE)
        print(f" {type_attaque + ' [RÉALISTE]':45s} | {taux_r:11.1f}% | {mse_r:10.4f} | {votes_r:13.2f} | {n_reel:8d}")

        resultats[type_attaque] = {
            "n_reel": n_reel,
            "prototype": {"taux_detection_pct": taux_p, "mse_moyen": mse_p, "vote_moyen": votes_p},
            "realiste": {"taux_detection_pct": taux_r, "mse_moyen": mse_r, "vote_moyen": votes_r},
        }

    print("=" * 105)

    print("\n[5/5] Export...")
    with open(os.path.join(DOSSIER_MODELE, "rapport_synthetique_final_tous_types.json"), "w") as f:
        json.dump(resultats, f, indent=4, ensure_ascii=False)
    print(f"[+] Rapport exporté : {DOSSIER_MODELE}/rapport_synthetique_final_tous_types.json")
    print("[+] Ce tableau, construit à partir des profils statistiques RÉELS de chaque type")
    print("    (vérité terrain 100% connue), constitue l'évaluation de clôture avant rédaction.")


if __name__ == "__main__":
    main()