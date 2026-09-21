"""
summarize_benchmark.py
Rassemble les rapports JSON produits par le pipeline (feature selection,
metadata du modèle, évaluations) en un seul tableau récapitulatif, et
compare aux anciens chiffres documentés (si fournis) pour voir l'écart
apporté par l'ensemble des corrections.

Usage : lancer depuis le dossier du run (ngidps_run_XXXXXXXX/).
"""

import json
import os

DOSSIER_MODELE = "modele_deep_lstm_vae_16features"

ANCIENS_CHIFFRES = {
    "description": "Chiffres documentés avant corrections (rapport initial)",
    "recall": 0.4470,
    "precision": 0.9867,
    "f1_score": 0.6153,
    "fpr": 0.0074,
    "seuil_utilise": 26.0959,
}


def charger_json(chemin):
    if not os.path.exists(chemin):
        return None
    with open(chemin) as f:
        return json.load(f)


def ligne(nom, res):
    if res is None:
        return f" {nom:45s} |   (absent)"
    return (f" {nom:45s} | Recall={res.get('recall', 0)*100:6.2f}%  "
            f"Precision={res.get('precision', 0)*100:6.2f}%  "
            f"F1={res.get('f1_score', 0)*100:6.2f}%  "
            f"FPR={res.get('fpr', 0)*100:6.2f}%")


def main():
    metadata = charger_json(os.path.join(DOSSIER_MODELE, "metadata_modele.json"))
    rapport_global_only = charger_json(os.path.join(DOSSIER_MODELE, "rapport_evaluation_global_only.json"))
    rapport_hybrid = charger_json(os.path.join(DOSSIER_MODELE, "rapport_evaluation_hybrid.json"))
    rapport_dilution = charger_json(os.path.join(DOSSIER_MODELE, "rapport_dilution_fenetre.json"))

    print("=" * 100)
    print(" RÉCAPITULATIF DU RUN")
    print("=" * 100)

    if metadata:
        print(f"\n[Calibration du modèle]")
        print(f"  mu_validation             : {metadata.get('mu_validation', 'N/A')}")
        print(f"  sigma_validation          : {metadata.get('sigma_validation', 'N/A')}")
        print(f"  seuil_1sigma_baseline     : {metadata.get('seuil_1sigma_baseline', 'N/A')}")
        print(f"  seuil_3sigma_baseline     : {metadata.get('seuil_3sigma_baseline', 'N/A')}")
        has_p98 = "feature_p98_thresholds" in metadata
        print(f"  feature_p98_thresholds présents : {'OUI' if has_p98 else 'NON (problème !)'}")
    else:
        print("\n[!] metadata_modele.json introuvable.")

    print(f"\n[Comparaison des évaluations]")
    print(ligne("Ancien chiffre documenté (avant correctifs)", ANCIENS_CHIFFRES))
    print(ligne("Nouveau — MSE global seul (seuil recalibré)", rapport_global_only))
    print(ligne("Nouveau — Règle hybride (vote OU seuil)", rapport_hybrid))
    if rapport_dilution:
        print(ligne("Nouveau — Baseline (label=any, score=mean)", rapport_dilution.get("A_baseline")))
        print(ligne("Nouveau — Label majoritaire", rapport_dilution.get("B_label_majoritaire")))
        print(ligne("Nouveau — Score max", rapport_dilution.get("C_score_max")))

    print("\n" + "=" * 100)

    if rapport_global_only:
        delta_recall = (rapport_global_only["recall"] - ANCIENS_CHIFFRES["recall"]) * 100
        delta_fpr = (rapport_global_only["fpr"] - ANCIENS_CHIFFRES["fpr"]) * 100
        print(f" ÉCART (nouveau seuil recalibré vs ancien chiffre documenté) :")
        print(f"   Δrecall = {delta_recall:+.2f} pts | Δfpr = {delta_fpr:+.2f} pts")
        print("=" * 100)

    # Export markdown pour collage direct dans le rapport
    lignes_md = [
        "| Configuration | Recall | Precision | F1 | FPR |",
        "|---|---|---|---|---|",
        f"| Ancien (documenté) | {ANCIENS_CHIFFRES['recall']*100:.2f}% | "
        f"{ANCIENS_CHIFFRES['precision']*100:.2f}% | {ANCIENS_CHIFFRES['f1_score']*100:.2f}% | "
        f"{ANCIENS_CHIFFRES['fpr']*100:.2f}% |",
    ]
    if rapport_global_only:
        r = rapport_global_only
        lignes_md.append(
            f"| Seuil recalibré (global seul) | {r['recall']*100:.2f}% | "
            f"{r['precision']*100:.2f}% | {r['f1_score']*100:.2f}% | {r['fpr']*100:.2f}% |"
        )
    if rapport_hybrid:
        r = rapport_hybrid
        lignes_md.append(
            f"| Règle hybride (vote OU seuil) | {r['recall']*100:.2f}% | "
            f"{r['precision']*100:.2f}% | {r['f1_score']*100:.2f}% | {r['fpr']*100:.2f}% |"
        )

    with open("benchmark_summary.md", "w") as f:
        f.write("\n".join(lignes_md) + "\n")
    print("\n[+] Tableau Markdown exporté : benchmark_summary.md")


if __name__ == "__main__":
    main()