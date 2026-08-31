"""
deploy_agent.py (Agent de Déploiement Zero-Downtime)
Machine : vm-edge (Pare-feu)
Mission : Polling, Dry-Run, Injection, Hot-Reload, Feedback.
"""

import time
import requests
import subprocess
import logging
import os

# ============================================================
# CONFIGURATION PRO MAX
# ============================================================
API_BASE_URL = "http://192.168.56.1:4000/api/rules"
SURICATA_YAML = "/etc/suricata/suricata.yaml"
LOCAL_RULES_FILE = "/var/lib/suricata/rules/local.rules"
TEST_RULES_FILE = "/tmp/suricata_test.rules"
POLLING_INTERVAL = 10

logging.basicConfig(level=logging.INFO, format="%(asctime)s [VM-EDGE AGENT] %(levelname)s: %(message)s")

def notify_backend(rule_id, status, error_msg=None):
    payload = {"rule_id": rule_id, "status": status, "error_log": error_msg}
    try:
        response = requests.post(f"{API_BASE_URL}/update-status", json=payload, timeout=5)
        if response.status_code == 200:
            logging.info(f"[+] API notifiée : Règle {rule_id} -> {status}")
        else:
            logging.warning(f"[-] L'API a répondu avec le code {response.status_code}")
    except Exception as e:
        logging.error(f"[-] Impossible de notifier l'API : {e}")

def verify_and_deploy_rule(rule_data):
    rule_id = rule_data.get("_id")
    rule_content = rule_data.get("regles_suricata")

    if not rule_content or not rule_id:
        return False, "Données de la règle invalides."

    logging.info(f"[*] Nouvelle règle détectée (ID: {rule_id}). Lancement de la procédure...")

    # 1. Écriture dans le fichier de Test (Dry-Run)
    with open(TEST_RULES_FILE, "w") as f:
        f.write(rule_content + "\n")

    # 2. Le Dry-Run (Validation Syntaxique par le moteur Suricata)
    logging.info("[*] Phase 1: Simulation (Dry-Run)...")
    cmd_test = ["suricata", "-T", "-c", SURICATA_YAML, "-S", TEST_RULES_FILE]

    try:
        result = subprocess.run(cmd_test, capture_output=True, text=True)
        if result.returncode != 0:
            erreur_suricata = result.stderr.strip()
            logging.error(f"[-] Échec de la simulation pour la règle {rule_id}.")
            return False, erreur_suricata
    except Exception as e:
        logging.error(f"[-] Erreur critique lors du Dry-Run : {e}")
        return False, str(e)

    logging.info("[+] Phase 1 OK : Syntaxe validée.")

    # 3. Injection en Production
    logging.info("[*] Phase 2: Injection dans local.rules...")
    try:
        with open(LOCAL_RULES_FILE, "a") as f:
            f.write("\n# [OSINT CTI AUTO-DEPLOY]\n")
            f.write(rule_content + "\n")
    except Exception as e:
        logging.error(f"[-] Erreur lors de l'écriture dans {LOCAL_RULES_FILE}: {e}")
        return False, str(e)

    # 4. Le Hot-Reload (Zero-Downtime)
    logging.info("[*] Phase 3: Hot-Reload de Suricata (Socket UNIX)...")
    cmd_reload = ["suricatasc", "-c", "reload-rules", "/var/lib/suricata/suricata-command.socket"]
    try:
        result_reload = subprocess.run(cmd_reload, capture_output=True, text=True)
        if result_reload.returncode != 0:
            logging.error("[-] Le Hot-Reload a échoué.")
            return False, "Le Hot-Reload a échoué via le socket UNIX."
    except Exception as e:
        logging.error(f"[-] Erreur suricatasc : {e}")
        return False, str(e)

    logging.info("[+] Phase 3 OK : Règle chargée en mémoire avec succès !")
    return True, None

def main():
    logging.info("=== DÉMARRAGE DE L'AGENT DE DÉPLOIEMENT CI/CD ===")

    if not os.path.exists(LOCAL_RULES_FILE):
        os.makedirs(os.path.dirname(LOCAL_RULES_FILE), exist_ok=True)
        with open(LOCAL_RULES_FILE, "w") as f:
            f.write("# Règles Suricata Auto-Générées\n")

    while True:
        try:
            response = requests.get(f"{API_BASE_URL}/pending-deploy", timeout=5)
            if response.status_code == 200:
                data = response.json()
                rules = data.get("rules", [])

                for rule in rules:
                    # Gestion du retour avec le tuple (Succès, Erreur)
                    success, err_msg = verify_and_deploy_rule(rule)
                    if success:
                        notify_backend(rule["_id"], "DEPLOYED")
                    else:
                        notify_backend(rule["_id"], "REJECTED", err_msg)

        except requests.exceptions.RequestException:
            pass
        except Exception as e:
            logging.error(f"[-] Erreur inattendue dans la boucle : {e}")

        time.sleep(POLLING_INTERVAL)

if __name__ == "__main__":
    main()