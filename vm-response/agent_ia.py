"""
agent_ia.py
Sprint 5 - Agent IA cognitif (Ollama) - Version JSON Structurée (Enterprise Grade)

Consomme les alertes bloquées ou en attente (Palier 2 & 3) par le SOAR.
Interroge un LLM local (Llama 3) en le forçant à répondre au format JSON strict.
Publie ce rapport structuré, l'historique du prompt et les métriques de perf.
"""

import json
import time
import logging
import requests
from kafka import KafkaConsumer, KafkaProducer

# --- CONFIGURATION ---
KAFKA_BOOTSTRAP_SERVERS = "192.168.56.130:9092"
TOPIC_ENTREE = "alerts-for-llm"
TOPIC_SORTIE = "incident-reports"

OLLAMA_URL = "http://localhost:11434/api/generate"
MODELE_OLLAMA = "llama3.2:3b"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("agent-ia")


def construire_prompt(alerte: dict) -> str:
    """Construit un prompt strict imposant un schéma JSON précis."""
    auto_bloque_str = "Oui (Bouclier actif)" if alerte.get('auto_blocked') else "Non (En attente d'approbation humaine - Palier 2)"

    # On utilise les doubles accolades {{ et }} pour échapper les accolades du JSON dans la f-string Python
    return f"""Tu es un analyste de sécurité (SOC Tier 3) expert en réponse aux incidents.
Ton rôle est d'analyser cette alerte de sécurité et de fournir un rapport structuré.
Tu dois OBLIGATOIREMENT répondre au format JSON strict, sans aucun texte avant ou après.

Données de l'incident :
- IP source hostile = {alerte.get('src_ip', 'Inconnue')}
- Source de détection = {alerte.get('source_detection', 'Inconnue')}
- Détails techniques = {alerte.get('details', 'Aucun détail')}
- Statut du Pare-feu = {auto_bloque_str}

Voici le format JSON EXACT que tu dois respecter :
{{
  "titre_incident": "Nom court et professionnel de l'attaque",
  "resume_executif": "Explication claire de l'attaque en 2 phrases maximum",
  "niveau_severite": "Critique, Elevé, Moyen, ou Faible",
  "score_confiance": 95,
  "mitre_attack_technique": "Le code MITRE ATT&CK correspondant (ex: T1498 - Network Denial of Service)",
  "analyse_technique": "Explication technique détaillée du comportement observé",
  "recommandations_actions": [
    "Action immédiate 1",
    "Action de remédiation 2"
  ]
}}
"""


def interroger_ollama(prompt: str) -> dict:
    """Appel REST vers Ollama avec forçage du format JSON."""
    try:
        reponse = requests.post(
            OLLAMA_URL,
            # Le paramètre "format": "json" force Ollama à garantir la structure
            json={"model": MODELE_OLLAMA, "prompt": prompt, "stream": False, "format": "json"},
            timeout=120,
        )
        reponse.raise_for_status()
        texte_brut = reponse.json().get("response", "").strip()

        # On convertit le texte de Llama 3 en véritable dictionnaire Python
        return json.loads(texte_brut)

    except json.JSONDecodeError:
        logger.error("Llama 3 n'a pas respecté le format JSON.")
        return fallback_json("Erreur de parsing: Llama n'a pas renvoyé un JSON valide.")
    except requests.RequestException as e:
        logger.error(f"Échec de l'appel Ollama : {e}")
        return fallback_json(f"Agent IA injoignable ou timeout ({e}).")


def fallback_json(message_erreur: str) -> dict:
    """Génère un JSON de secours propre pour éviter de faire crasher le Dashboard Next.js."""
    return {
        "titre_incident": "Erreur d'analyse IA",
        "resume_executif": message_erreur,
        "niveau_severite": "Inconnu",
        "score_confiance": 0,
        "mitre_attack_technique": "N/A",
        "analyse_technique": "Le système de diagnostic sémantique n'a pas pu traiter cette alerte.",
        "recommandations_actions": ["Vérifier le statut du conteneur/service Ollama", "Analyser manuellement les logs Suricata"]
    }


def main():
    logger.info("Initialisation de l'Agent IA (Mode JSON Structuré)...")

    consumer = KafkaConsumer(
        TOPIC_ENTREE,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id="agent-ia-group",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        auto_offset_reset="latest",
    )

    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )

    logger.info(f"Agent IA en attente d'alertes sur '{TOPIC_ENTREE}'...")

    try:
        for record in consumer:
            alerte = record.value
            ip_cible = alerte.get('src_ip', 'Inconnue')
            logger.info(f"Traitement de l'alerte reçue pour l'IP={ip_cible}")

            debut_inf = time.time()
            prompt = construire_prompt(alerte)
            diagnostic_json = interroger_ollama(prompt)
            duree = time.time() - debut_inf

            # Le nouveau payload très complet envoyé au Dashboard
            rapport = {
                "src_ip": ip_cible,
                "diagnostic_json": diagnostic_json, # C'est maintenant un vrai objet JSON
                "prompt_contexte": prompt,          # Historique du contexte pour audit
                "timestamp": time.time(),
                "duree_generation_sec": round(duree, 2),
            }

            producer.send(TOPIC_SORTIE, rapport)
            producer.flush()

            logger.info(f"Rapport structuré généré en {duree:.2f}s et publié sur '{TOPIC_SORTIE}'.")
            print(f"\n--- APERÇU DU JSON POUR {ip_cible} ---\n{json.dumps(diagnostic_json, indent=2, ensure_ascii=False)}\n----------------------------------------\n")

    except KeyboardInterrupt:
        logger.info("Arrêt manuel de l'Agent IA.")
    except Exception as e:
        logger.error(f"Erreur inattendue : {e}")
    finally:
        consumer.close()
        producer.close()


if __name__ == "__main__":
    main()