"""
soar.py
Sprint 4, 5 & 6 - Orchestrateur SOAR & Bridge Agent IA
+ Bouclier Anti-DDoS Global (SSH) & Protection Anti-Saturation LLM

Consolide les alertes du LSTM-VAE et de Suricata, applique une logique
de décision, active des mécanismes d'isolation ciblés ou des boucliers
d'infrastructure globaux, et notifie l'Agent IA.
"""

import json
import time
import re
import logging
import subprocess

from kafka import KafkaConsumer, KafkaProducer

# --- CONFIGURATION KAFKA & RESEAU ---
KAFKA_BOOTSTRAP_SERVERS = "192.168.56.130:9092"
TOPIC_ML = "ml-alerts"
TOPIC_SURICATA = "suricata-alerts"
TOPIC_LLM = "alerts-for-llm"  # Topic pour l'Agent IA (Sprint 5)

FENETRE_CORRELATION_SEC = 30
CHEMIN_ACTIFS_CRITIQUES = "actifs_critiques.json"

IP_VM_EDGE = "192.168.56.128"
CLE_SSH = "/home/aziz/.ssh/soar_key"
UTILISATEUR_EDGE = "aziz"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("soar")

# --- ETAT GLOBAL EN MEMOIRE ---
derniere_alerte_ml = {}
derniere_alerte_suricata = {}
ips_deja_bloquees = set()    # IPs physiquement bloquées sur le Pare-feu
ips_en_cours_ia = set()      # IPs actuellement en analyse par le LLM

# --- PROTECTION ANTI-SATURATION (LLM Debouncer) ---
cache_alertes_soar = {}
COOLDOWN_LLM_SEC = 60  # On ignore les alertes de même CATÉGORIE pendant 60 secondes


def charger_actifs_critiques() -> set:
    """Charge la liste blanche dynamique depuis un fichier JSON externe."""
    try:
        with open(CHEMIN_ACTIFS_CRITIQUES, "r") as f:
            data = json.load(f)
        return set(data.get("whitelist", data.get("actifs_critiques", [])))
    except FileNotFoundError:
        logger.warning(f"Fichier {CHEMIN_ACTIFS_CRITIQUES} introuvable. Whitelist vide.")
        return set()


def ip_valide(ip: str) -> bool:
    """Vérification Regex pour éviter l'injection de commandes."""
    return bool(re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', ip))


def activer_bouclier_anti_ddos(producer: KafkaProducer):
    """
    Active les règles de survie Kernel et Iptables sur VM-Edge via SSH
    pour contrer les attaques DDoS distribuées (Spoofing d'IPs aléatoires).
    """
    logger.critical("🛡️ [SOAR] EXÉCUTION DU BOUCLIER ANTI-DDOS GLOBAL VIA SSH ! 🛡️")

    # Définition des règles de mitigation (TCP SYN Cookies + Rate Limiting)
    commandes = [
        "sudo sysctl -w net.ipv4.tcp_syncookies=1",
        "sudo iptables -I INPUT -p tcp --syn --dport 80 -m limit --limit 100/s --limit-burst 150 -j ACCEPT",
        "sudo iptables -A INPUT -p tcp --syn --dport 80 -j DROP"
    ]

    succes = True
    for cmd in commandes:
        try:
            subprocess.run(
                ["ssh", "-i", CLE_SSH, "-o", "StrictHostKeyChecking=no", f"{UTILISATEUR_EDGE}@{IP_VM_EDGE}", cmd],
                check=True, capture_output=True, text=True, timeout=10
            )
        except Exception as e:
            logger.error(f"Échec de l'injection de la règle '{cmd}': {e}")
            succes = False

    if succes:
        logger.info("✅ [SOAR] Bouclier activé sur VM-Edge : TCP Cookies ON, Iptables Rate-Limiting actif.")
        # Génération d'un rapport unique pour l'activation du bouclier
        payload = {
            "src_ip": "MULTIPLE_SPOOFED_IPS",
            "source_detection": "Bouclier Anti-DDoS (SOAR)",
            "details": "DDoS Spoofing détecté par l'analyseur volumétrique. Bouclier d'infrastructure activé automatiquement : TCP SYN Cookies et Rate-Limiting Iptables.",
            "auto_blocked": True,
            "timestamp": time.time(),
        }
        producer.send(TOPIC_LLM, payload)
        producer.flush()


def bloquer_ip(ip: str, actifs_critiques: set) -> bool:
    """Isole une IP ciblée sur la VM Edge via Iptables SSH."""
    if ip in actifs_critiques:
        logger.warning(f"[AUDIT] BLOCAGE REFUSÉ : L'IP {ip} est un actif critique (Whitelist).")
        return False

    if ip in ips_deja_bloquees:
        logger.info(f"IP={ip} déjà bloquée (Idempotence), action ignorée.")
        return False

    if not ip_valide(ip):
        logger.error(f"[SECURITE] IP invalide, blocage refusé : {ip}")
        return False

    try:
        subprocess.run(
            [
                "ssh", "-i", CLE_SSH,
                "-o", "StrictHostKeyChecking=no",
                f"{UTILISATEUR_EDGE}@{IP_VM_EDGE}",
                f"sudo iptables -I INPUT -s {ip} -j DROP",
            ],
            check=True, capture_output=True, text=True, timeout=10,
        )
        logger.warning(f"IP BLOQUÉE physiquement sur VM-Edge : {ip}")
        ips_deja_bloquees.add(ip)
        return True

    except subprocess.CalledProcessError as e:
        logger.error(f"Échec du blocage distant pour {ip} : {e}")
        return False
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout SSH lors du blocage distant pour {ip}")
        return False


def notifier_agent_ia(producer: KafkaProducer, ip: str, source: str, details: str, auto_blocked: bool):
    """Envoie le contexte de l'attaque à l'Agent IA (Llama 3)."""
    payload = {
        "src_ip": ip,
        "source_detection": source,
        "details": details,
        "auto_blocked": auto_blocked,
        "timestamp": time.time(),
    }
    producer.send(TOPIC_LLM, payload)
    producer.flush()
    logger.info(f"Contexte pour l'IP {ip} transmis à l'Agent IA (Auto-bloqué: {auto_blocked}).")


def evaluer_correlation(src_ip: str, maintenant: float) -> bool:
    """Palier 3 : Vérifie si le ML et Suricata alertent sur la même fenêtre."""
    t_ml = derniere_alerte_ml.get(src_ip)
    t_sur = derniere_alerte_suricata.get(src_ip)
    if t_ml is None or t_sur is None:
        return False
    return abs(t_ml - t_sur) <= FENETRE_CORRELATION_SEC


def traiter_alerte_ml(message: dict, actifs_critiques: set, producer: KafkaProducer):
    action = message.get("action")

    # 🛡️ GESTION DU BOUCLIER DDOS (Attaque Distribuée)
    if action == "ENABLE_DDOS_SHIELD":
        activer_bouclier_anti_ddos(producer)
        return

    # Si c'est une alerte ciblée
    src_ip = message.get("src_ip")
    if not src_ip:
        return

    # 🛡️ BOUCLIER ZERO TRUST (Bypass IA)
    if src_ip in actifs_critiques:
        if src_ip not in ips_deja_bloquees:
            logger.critical(f"[ZERO TRUST] Mouvement latéral depuis l'actif critique {src_ip} !")
            ips_deja_bloquees.add(src_ip) # Verrouillage Pare-feu logiciel

            payload_urgence = {
                "src_ip": src_ip,
                "diagnostic": "🚨 ALERTE INTERNE ABSOLUE (BYPASS IA) 🚨\n\nMouvement latéral détecté depuis un serveur de la Whitelist.\nLe SOAR a refusé le blocage automatique pour maintenir la continuité de service (Zero Trust).\n\nAction : Isolez la machine compromise manuellement de toute urgence."
            }
            producer.send('incident-reports', payload_urgence)
            producer.flush()
        return

    # 🛡️ GESTION NORMALE DU BLOCAGE (Niveau 3)
    if src_ip in ips_deja_bloquees:
        return

    maintenant = time.time()
    derniere_alerte_ml[src_ip] = maintenant

    if evaluer_correlation(src_ip, maintenant):
        logger.warning(f"[PALIER 3] Corrélation ML+Suricata pour IP={src_ip} — priorité HAUTE")
        if bloquer_ip(src_ip, actifs_critiques):
            notifier_agent_ia(producer, src_ip, "Multi-Source", "Escalade ! Corrélation forte validée entre comportement et signature.", auto_blocked=True)
    else:
        logger.info(f"[PALIER 2] Alerte ML seule pour IP={src_ip}")
        if src_ip not in ips_en_cours_ia:
            ips_en_cours_ia.add(src_ip)
            notifier_agent_ia(producer, src_ip, "LSTM-VAE (IA)", "Comportement anormal détecté (Erreur MSE > Seuil dynamique).", auto_blocked=False)


def traiter_alerte_suricata(message: dict, actifs_critiques: set, producer: KafkaProducer):
    src_ip = message.get("src_ip", message.get("source_ip", message.get("ip")))
    signature = message.get("signature", "Inconnue")
    category = message.get("category", "Inconnue")
    maintenant = time.time()

    if not src_ip:
        return

    # 🛡️ BOUCLIER ZERO TRUST (Bypass IA)
    if src_ip in actifs_critiques:
        if src_ip not in ips_deja_bloquees:
            logger.critical(f"[ZERO TRUST] Mouvement latéral depuis l'actif critique {src_ip} !")
            ips_deja_bloquees.add(src_ip)

            payload_urgence = {
                "src_ip": src_ip,
                "diagnostic": f"🚨 ALERTE INTERNE ABSOLUE (BYPASS IA) 🚨\n\nActivité suspecte (Signature: {signature}) depuis la Whitelist."
            }
            producer.send('incident-reports', payload_urgence)
            producer.flush()
        return

    # 🛡️ GESTION NORMALE DU BLOCAGE
    if src_ip in ips_deja_bloquees:
        return

    severity = message.get("severity", 3)
    derniere_alerte_suricata[src_ip] = maintenant

    # 🛡️ DÉTERMINATION SI ON DOIT APPELER L'IA (Debouncer par Catégorie)
    # L'IP peut être bloquée, mais on ne génère qu'un seul rapport IA par catégorie toutes les 60s
    generer_rapport_ia = False
    if category not in cache_alertes_soar or (maintenant - cache_alertes_soar[category]) >= COOLDOWN_LLM_SEC:
        cache_alertes_soar[category] = maintenant
        generer_rapport_ia = True

    if evaluer_correlation(src_ip, maintenant):
        logger.warning(f"[PALIER 3] Corrélation Suricata+ML pour IP={src_ip} — priorité HAUTE")
        if bloquer_ip(src_ip, actifs_critiques) and generer_rapport_ia:
            notifier_agent_ia(producer, src_ip, "Multi-Source", f"Corrélation forte validée. Signature : {signature}", auto_blocked=True)

    elif "[CRITIQUE]" in signature:
        logger.warning(f"[SURICATA BYPASS] Alerte [CRITIQUE] détectée pour IP={src_ip} — Signature : {signature}")
        if bloquer_ip(src_ip, actifs_critiques) and generer_rapport_ia:
            notifier_agent_ia(producer, src_ip, "Suricata (Critique Bypass)", f"Menace critique identifiée par signature : {signature}", auto_blocked=True)

    elif severity <= 2:
        logger.info(f"[PALIER 2] Alerte Suricata sévérité {severity} pour IP={src_ip}")
        if src_ip not in ips_en_cours_ia:
            ips_en_cours_ia.add(src_ip)
            if generer_rapport_ia:
                notifier_agent_ia(producer, src_ip, "Suricata", f"Signature déterministe (Sévérité {severity}) : {signature}", auto_blocked=False)

    else:
        logger.info(f"[PALIER 1] Alerte Suricata sévérité {severity} (info) pour IP={src_ip} — log seul")



def main():
    logger.info("Démarrage du SOAR : Initialisation de la liaison Kafka...")

    consumer = KafkaConsumer(
        TOPIC_ML, TOPIC_SURICATA,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id="soar-orchestrator",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        auto_offset_reset="latest",
    )

    producer_llm = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode("utf-8")
    )

    logger.info("SOAR opérationnel : En attente d'alertes sur ml-alerts et suricata-alerts...")

    try:
        for record in consumer:
            message = record.value
            actifs_critiques = charger_actifs_critiques()

            if record.topic == TOPIC_ML:
                traiter_alerte_ml(message, actifs_critiques, producer_llm)
            elif record.topic == TOPIC_SURICATA:
                traiter_alerte_suricata(message, actifs_critiques, producer_llm)

    except KeyboardInterrupt:
        logger.info("Arrêt manuel du SOAR.")
    except Exception as e:
        logger.error(f"Erreur critique dans la boucle principale : {e}")
    finally:
        consumer.close()
        producer_llm.close()


if __name__ == "__main__":
    main()