"""
generate_controlled_test.py
Génère des séquences SYNTHÉTIQUES à vérité terrain connue et évalue le
modèle Deep LSTM-VAE dessus, pour observer directement son comportement
plutôt que de le déduire d'un jeu de données réel.

4 catégories testées (10 timesteps x 16 features chacune) :

  1) BÉNIN PUR       : toutes les valeurs tirées de la distribution réelle
                        du trafic bénin (contrôle négatif -> ne doit PAS
                        être détecté).
  2) ANOMALIE ÉVIDENTE: toutes les 10 étapes fortement décalées
                        (+10 sigma) -> DOIT être détecté (ex: DDoS/PortScan,
                        déviation statistique massive et soutenue).
  3) ANOMALIE DISCRÈTE: toutes les 10 étapes légèrement décalées
                        (+1.5 sigma) -> teste la limite du modèle sur une
                        attaque qui reste statistiquement proche du bénin.
  4) FENÊTRE DILUÉE   : 9 étapes bénignes + 1 étape très anormale
                        (+10 sigma) -> teste si un signal fort mais bref
                        (1 paquet sur 10) survit à l'agrégation temporelle.

Les statistiques (moyenne, écart-type) sont calculées à partir du VRAI
jeu de trafic bénin d'entraînement, donc les scénarios générés restent
ancrés dans la réalité du dataset plutôt qu'arbitraires.
"""

import os
import json

import numpy as np
import pandas as pd
import joblib

import keras
from keras import layers, ops

TAILLE_FENETRE = 10
N_SEQUENCES_PAR_CATEGORIE = 200
FACTEUR_ANOMALIE_EVIDENTE = 10.0   # +10 sigma
FACTEUR_ANOMALIE_DISCRETE = 1.5    # +1.5 sigma

CHEMIN_TRAIN = "global_benign_train_16f.csv"
SCHEMA_FEATURES = "selected_features_global.json"
DOSSIER_MODELE = "modele_deep_lstm_vae_16features"

CHEMIN_MODELE = os.path.join(DOSSIER_MODELE, "deep_lstm_vae_16f.keras")
CHEMIN_SCALER = os.path.join(DOSSIER_MODELE, "global_scaler_16f.pkl")
CHEMIN_METADATA = os.path.join(DOSSIER_MODELE, "metadata_modele.json")

VOTE_MINIMUM = 4


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


def generer_categorie(nom, mu_raw, sigma_raw, nb_features, n_seq, taille_fenetre,
                       facteur=0.0, dilution=False, rng=None):
    """Génère n_seq séquences (taille_fenetre, nb_features) en espace BRUT
    (avant normalisation), à partir de la distribution réelle du bénin.
    facteur=0 -> bénin pur. facteur>0 -> décalage de +facteur*sigma sur
    toutes les étapes (sauf si dilution=True : décalage sur 1 seule étape)."""
    sequences = np.zeros((n_seq, taille_fenetre, nb_features), dtype=np.float32)
    for i in range(n_seq):
        base = rng.normal(loc=mu_raw, scale=sigma_raw, size=(taille_fenetre, nb_features))
        base = np.clip(base, a_min=0.0, a_max=None)  # les features réseau ne sont pas négatives
        if facteur > 0:
            decalage = facteur * sigma_raw
            if dilution:
                idx_anomalie = taille_fenetre // 2  # une seule étape au milieu de la fenêtre
                base[idx_anomalie] = mu_raw + decalage
            else:
                base = base + decalage  # toutes les étapes décalées
        sequences[i] = base
    return sequences


def main():
    print("[1/4] Chargement du modèle, du scaler et des statistiques du trafic bénin réel...")
    with open(SCHEMA_FEATURES) as f:
        FEATURES = json.load(f)
    NB_FEATURES = len(FEATURES)

    with open(CHEMIN_METADATA) as f:
        metadata = json.load(f)
    seuil_global = float(metadata["seuil_1sigma_baseline"])
    seuils_p98 = np.array(metadata["feature_p98_thresholds"], dtype=np.float32)

    scaler = joblib.load(CHEMIN_SCALER)
    modele = keras.models.load_model(
        CHEMIN_MODELE,
        custom_objects={"CoucheEchantillonnage": CoucheEchantillonnage, "CoucheVAELoss": CoucheVAELoss},
    )

    df_train = pd.read_csv(CHEMIN_TRAIN)
    df_train = df_train[FEATURES]
    mu_raw = df_train.mean().values.astype(np.float32)
    sigma_raw = df_train.std().values.astype(np.float32)

    print(f"[+] Statistiques réelles du bénin chargées ({NB_FEATURES} features).")
    print(f"[*] Seuil de décision (1-sigma) : {seuil_global:.4f}\n")

    rng = np.random.RandomState(123)

    print("[2/4] Génération des 4 catégories de séquences synthétiques...")
    categories = {
        "1) BÉNIN PUR (contrôle négatif)": generer_categorie(
            "benin", mu_raw, sigma_raw, NB_FEATURES, N_SEQUENCES_PAR_CATEGORIE,
            TAILLE_FENETRE, facteur=0.0, rng=rng
        ),
        f"2) ANOMALIE ÉVIDENTE (+{FACTEUR_ANOMALIE_EVIDENTE:.0f}sigma, 10/10 étapes)": generer_categorie(
            "evidente", mu_raw, sigma_raw, NB_FEATURES, N_SEQUENCES_PAR_CATEGORIE,
            TAILLE_FENETRE, facteur=FACTEUR_ANOMALIE_EVIDENTE, rng=rng
        ),
        f"3) ANOMALIE DISCRÈTE (+{FACTEUR_ANOMALIE_DISCRETE:.1f}sigma, 10/10 étapes)": generer_categorie(
            "discrete", mu_raw, sigma_raw, NB_FEATURES, N_SEQUENCES_PAR_CATEGORIE,
            TAILLE_FENETRE, facteur=FACTEUR_ANOMALIE_DISCRETE, rng=rng
        ),
        f"4) FENÊTRE DILUÉE (+{FACTEUR_ANOMALIE_EVIDENTE:.0f}sigma, 1/10 étape seulement)": generer_categorie(
            "diluee", mu_raw, sigma_raw, NB_FEATURES, N_SEQUENCES_PAR_CATEGORIE,
            TAILLE_FENETRE, facteur=FACTEUR_ANOMALIE_EVIDENTE, dilution=True, rng=rng
        ),
    }

    print("[3/4] Normalisation (avec le scaler réel) et inférence...\n")
    print("=" * 100)
    print(f" {'Catégorie':55s} | {'Taux détecté':13s} | {'MSE moyen':10s} | {'Votes moyens':13s}")
    print("=" * 100)

    resultats = {}
    for nom, sequences_brutes in categories.items():
        n = len(sequences_brutes)
        sequences_norm = np.clip(
            scaler.transform(sequences_brutes.reshape(-1, NB_FEATURES)), 0.0, 1.0
        ).reshape(n, TAILLE_FENETRE, NB_FEATURES).astype(np.float32)

        preds = modele.predict(sequences_norm, batch_size=256, verbose=0)
        err_par_feature = np.mean(np.square(sequences_norm - preds), axis=1) * 1000.0
        mse_global = np.mean(err_par_feature, axis=1)
        vote_count = np.sum(err_par_feature > seuils_p98, axis=1)

        detecte = (vote_count >= VOTE_MINIMUM) | (mse_global >= seuil_global)
        taux_detection = float(np.mean(detecte)) * 100

        print(f" {nom:55s} | {taux_detection:11.1f}% | {np.mean(mse_global):10.4f} | "
              f"{np.mean(vote_count):13.2f}")

        resultats[nom] = {
            "taux_detection_pct": taux_detection,
            "mse_moyen": float(np.mean(mse_global)),
            "vote_moyen": float(np.mean(vote_count)),
            "n_sequences": n,
        }

    print("=" * 100)

    print("\n[4/4] Interprétation attendue :")
    print("  - Catégorie 1 doit être proche de 0% détecté (sinon FPR anormalement élevé).")
    print("  - Catégorie 2 doit être proche de 100% détecté (déviation massive et soutenue).")
    print("  - Catégorie 3 teste la limite : un taux bas confirme le plafond de recall observé")
    print("    sur des attaques statistiquement discrètes mais réelles.")
    print("  - Catégorie 4 isole l'effet de dilution temporelle : si son taux est proche de la")
    print("    catégorie 2, la dilution n'est PAS le facteur limitant (cohérent avec les tests")
    print("    précédents sur données réelles). S'il est proche de la catégorie 1, elle l'est.")

    with open(os.path.join(DOSSIER_MODELE, "rapport_test_controle.json"), "w") as f:
        json.dump(resultats, f, indent=4, ensure_ascii=False)
    print(f"\n[+] Rapport exporté : {DOSSIER_MODELE}/rapport_test_controle.json")


if __name__ == "__main__":
    main()