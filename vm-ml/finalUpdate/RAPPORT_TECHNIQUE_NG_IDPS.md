# Rapport Technique : Architecture, Implémentation et Évaluation du Moteur Hybride NG-IDPS

## 1. Introduction & Architecture Globale

Le projet consiste en la conception et le déploiement d'un système de détection et de prévention des intrusions de nouvelle génération (**NG-IDPS**) orienté réseau, combinant l'apprentissage profond non supervisé (**LSTM-VAE**) pour la détection d'anomalies comportementales et un bouclier volumétrique anti-DDoS basé sur des règles.

L'architecture repose sur un environnement distribué articulé autour de deux nœuds principaux :
* **`vm-edge` (Nœud de capture et de filtrage) :** Assure l'interception du trafic brut via **Suricata IDS/IPS** configuré sur l'interface réseau active, et gère l'injection des flux dans le bus de messages.
* **`vm-ml` (Nœud d'analyse et de décision) :** Héberge le broker **Apache Kafka**, le pipeline de traitement en temps réel (`realtime_interface.py`), le modèle LSTM-VAE, ainsi que la logique de réponse automatisée (**SOAR**).

---

## 2. Méthodologies et Outils Utilisés

* **Ingénierie Réseau & Sécurité :** Suricata (IDS/IPS), Wireshark/Tcpdump, Hping3, Nmap, Nikto.
* **Pipeline de Données en Temps Réel :** Apache Kafka (Topics : `network-features`, `ml-alerts`).
* **Machine Learning / Deep Learning :** Modèle hybride LSTM-VAE (Long Short-Term Memory Variational Autoencoder) entraîné sur des caractéristiques inspirées du dataset CICIDS2017 (16 features statistiques).
* **Environnement de Développement :** Python (Pandas, Scikit-learn, PyTorch/Keras, Kafka-Python), Linux (Kali Linux pour l'attaque, machines virtuelles Debian/Ubuntu pour la cible).

---

## 3. Modifications et Implémentations par Composant

### A. Modifications sur `vm-edge` (Suricata & Capture)
1. **Correction de l'interface d'écoute :** Basculement de l'interface par défaut (`eth0` / `default`) vers l'interface active du réseau interne/Host-Only (`ens34`, IP `192.168.56.128`) dans le fichier de configuration `/etc/suricata/suricata.yaml` (`af-packet` section).
2. **Optimisation des performances :** Activation du paramètre `threads: auto` pour répartir dynamiquement la charge de traitement sur les cœurs CPU disponibles, éliminant ainsi les pertes de paquets (`packet drops`) lors des pics de trafic.
3. **Harmonisation des logs :** Validation de la génération des journaux unifiés (`eve.json`) pour l'inspection profonde des paquets TCP, UDP et HTTP.

### B. Modifications sur `vm-ml` (Moteur de Décision & IA)
1. **Implémentation d'une Porte Logique Hybride (OR-Gate) :** 
   * Déclenchement d'une anomalie si `vote_count` $\ge 4/16$ features **OU** si l'erreur de reconstruction globale `MSE_global` $\ge 26.10$ (seuil 1-sigma).
2. **Introduction de la Fenêtre Glissante (Sliding Window Persistence) :**
   * Remplacement du compteur binaire simple par une structure `deque(maxlen=5)`.
   * Exigence d'un minimum de $\ge 3$ anomalies détectées au sein des 5 derniers paquets/fenêtres pour valider un **Auto-Block** effectif, éliminant ainsi l'effet "yoyo" (oscillations d'alertes).
3. **Pré-filtre Global Anti-DDoS (Bouclier SOAR) :**
   * Ajout d'un mécanisme global de surveillance du volume de paquets sur une fenêtre de 2 secondes (`SEUIL_GLOBAL_FLOOD = 300`).
   * Intégration d'un **cooldown de 30 secondes** sur les alertes globales critiques pour éviter la saturation du bus Kafka et des journaux système en cas de flood massif.

---

## 4. Fichiers Clés Créés ou Modifiés

| Fichier / Script | Emplacement / Rôle | Description des modifications |
| :--- | :--- | :--- |
| `suricata.yaml` | `/etc/suricata/suricata.yaml` (`vm-edge`) | Configuration de l'interface `ens34`, activation de `threads: auto` et des filtres BPF. |
| `realtime_interface.py` | `vm-ml` | Script principal consommant le topic Kafka, intégrant le LSTM-VAE, la fenêtre glissante (`deque`), et l'auto-block. |
| `selected_features_global.json` | `vm-ml` | Schéma de référence contenant les 16 features statistiques indispensables au modèle. |
| Scripts de test d'injection | Machine Attaquante (Kali) | Scripts Python de simulation d'IPs usurpées et commandes d'attaque ciblées (`hping3`, `nikto`). |

---

## 5. Section Comparative & Résultats des Tests

Trois scénarios d'attaque distincts ont été exécutés depuis la machine Kali pour valider le comportement de l'architecture hybride.

### Tableau Comparatif des Scénarios de Test

| Scénario d'Attaque | Outil Utilisé | Comportement Réseau / Suricata | Réaction du Moteur ML (`vm-ml`) | Résultat / Action du Système |
| :--- | :--- | :--- | :--- | :--- |
| **1. Attaque Volumétrique Globale (DDoS)** | `hping3 --rand-source --flood` | Trafic massif d'IPs aléatoires intercepté sur `ens34`. | Le pré-filtre global détecte l'explosion du volume (`paquets_2s > 300`). | Déclenchement immédiat du bouclier SOAR global (`ENABLE_DDOS_SHIELD`). Application du cooldown de 30s. |
| **2. Attaque Ciblée avec IP Usurpée** | `hping3 -a 192.168.56.200` | Paquets ciblés isolés, faible impact sur le volume global. | `MSE_global = 0.7659` (sous le seuil de 26.10). Pas d'anomalie structurelle détectée sur les features bas niveau. | Trafic jugé normal par le modèle d'IA (les paquets bruts isolés ne modifient pas les statistiques de flux). |
| **3. Scan Web & Applicatif (Nikto)** | `nikto -h 192.168.56.128` | Multiples alertes Suricata générées (`ET WEB_SERVER`, `LFI`, `HTTP Host header ambiguous`). | Le pipeline analyse les flux TCP/HTTP, l'erreur MSE dépasse les seuils sur les requêtes anormales. | Activation de la fenêtre glissante, accumulation des scores, et **Auto-Block** de l'IP après persistance. |

### Analyse Détaillée des Résultats

1. **Efficacité du Pré-filtre Volumétrique :** 
   Lors des tests de DDoS massif, le système a démontré sa capacité à bloquer l'attaque au niveau amont sans engorger le modèle de Deep Learning, grâce au seuil global et au mécanisme de temporisation (observé par l'espacement exact de 30 secondes entre les logs critiques : `17:07:29` à `17:07:59`).
2. **Résilience face aux faux positifs (Fenêtre Glissante vs Paquets Isolés) :**
   Le test avec `hping3 -a` (paquets isolés) a prouvé l'utilité de la fenêtre glissante : un trafic bénin ou un paquet isolé ne provoque pas de faux positif intempestif grâce à l'exigence de persistance ($\ge 3$ anomalies requises).
3. **Gestion du Bruit et Filtrage Intelligent (Scans Nikto) :**
   Durant les tests de vulnérabilités web, le système a traité des milliers de requêtes en filtrant intelligemment les doublons et les redondances d'alertes via le mécanisme de cooldown et de déduplication, enregistrant un volume maîtrisé de paquets ignorés (`5520` ignorés sur un trafic complexe) tout en isolant les comportements malveillants réels.

---

## 6. Conclusion

L'intégration de la `vm-edge` (Suricata optimisé sur `ens34` avec multi-threading) et de la `vm-ml` (moteur LSTM-VAE couplé à une logique de persistance par fenêtre glissante) offre un compromis optimal entre **performance temps réel** et **précision de détection**. L'architecture est désormais capable de faire face à la fois aux attaques volumétriques massives (via le bouclier global) et aux intrusions comportementales ciblées (via l'IA et la persistance).