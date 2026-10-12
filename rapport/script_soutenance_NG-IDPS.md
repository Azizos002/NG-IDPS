# Script de soutenance — NG-IDPS
**Contrainte stricte : 20 minutes.** Script calibré à environ 18 min 30, pour une marge de sécurité de 1 min 30.

Chaque bloc indique : la durée cible, le texte à dire (transitions incluses), et un repère de temps cumulé pour te recaler pendant les répétitions.

---

## Section 0 — Ouverture
*(0:00 → 0:55)*

### Slide 1 — Titre *(15s)*
> Bonjour, je m'appelle Aziz Dhifaoui, et je vais vous présenter mon projet de fin d'études : NG-IDPS, une plateforme autonome de nouvelle génération pour la détection et la prévention d'intrusions, réalisé sous l'encadrement de monsieur Hamdi Aloulou.

### Slide 2 — Plan *(20s)*
> Pour vous présenter ce travail, ma présentation suit six axes. D'abord l'introduction et la problématique qui ont motivé ce projet, puis l'analyse des besoins, l'environnement et l'architecture globale, la méthodologie que j'ai suivie, le déroulement des six sprints qui ont construit le système, et enfin les perspectives et la conclusion.

### Slide 3 — Section Introduction *(8s)*
> Commençons par poser le contexte : pourquoi ce projet, et face à quoi se positionne-t-il.

**Repère : 0:55**

---

## Section 1 — Introduction
*(0:55 → 3:35)*

### Slide 4 — Problématique *(45s)*
> Concevoir un système de détection et de prévention d'intrusions soulève cinq défis majeurs. Premièrement, la latence : il faut produire une décision dans un délai compatible avec une détection quasi temps réel. Deuxièmement, les faux positifs : il faut calibrer la détection comportementale pour limiter les fausses alertes sans perdre en sensibilité. Troisièmement, les comportements inconnus : il faut compléter la détection par signatures par une approche comportementale non supervisée, pour couvrir aussi les attaques zero-day. Quatrièmement, l'accessibilité : il faut concevoir une architecture open-source et auto-hébergée, sans dépendance à un éditeur. Et cinquièmement, la continuité de la réponse : il faut automatiser la mitigation vingt-quatre heures sur vingt-quatre, tout en gardant traçabilité, audit et moindre privilège. Ce sont ces cinq défis qui ont guidé toutes les décisions de conception que je vais vous présenter.

### Slide 5 — Étude de l'existant *(30s)*
> Face à ces défis, j'ai d'abord étudié l'existant. Trois familles de solutions se distinguent, chacune avec ses limites. Snort et Zeek font de la détection par signatures, mais sans comportemental natif ni orchestration intégrée. Splunk ES et QRadar offrent une corrélation et un SOAR matures, mais à un coût de licence élevé et avec une dépendance cloud. Darktrace propose une détection comportementale par IA avancée, mais reste une boîte noire propriétaire, non auto-hébergeable. NG-IDPS se positionne précisément à l'intersection de ces trois approches.

### Slide 6 — Notre solution *(35s)*
> Concrètement, NG-IDPS repose sur quatre capacités. Une détection hybride, combinant Suricata pour les signatures et un LSTM-VAE pour le comportemental non supervisé, afin de couvrir à la fois les menaces connues et les zero-day. Une analyse cognitive locale, où un LLM — Ollama, Llama 3 — génère un diagnostic structuré en sept champs, sans dépendance cloud obligatoire. Un SOAR multi-paliers, qui corrèle, calcule un score composite de menace et peut bloquer de façon autonome, avec supervision humaine possible. Et enfin un module de renseignement et de formation, avec veille CTI, génération de règles candidates et parcours de sensibilisation pour le facteur humain. Voyons maintenant comment ces besoins ont été formalisés avant la conception.

**Repère : 3:35**

---

## Section 2 — Analyse des besoins
*(3:35 → 4:45)*

### Slide 7 — Section Analyse des besoins *(8s)*
> Passons à l'analyse des besoins : qui utilise le système, et ce qu'il doit accomplir.

### Slide 8 — Les acteurs *(25s)*
> Trois acteurs interagissent avec NG-IDPS. L'administrateur SOC, acteur principal, supervise le système et pilote la réponse depuis le tableau de bord. L'employé reçoit les actions de sensibilisation générées à la suite d'un incident impliquant un facteur humain. Et les sources de renseignement externes — flux OSINT, bases de règles publiques — alimentent le module de threat intelligence.

### Slide 9 — Besoins fonctionnels *(25s)*
> Pour chacun de ces acteurs, les besoins fonctionnels diffèrent. L'administrateur doit pouvoir s'authentifier, suivre les alertes en temps réel, exporter un rapport d'incident, et bloquer manuellement une IP. L'employé reçoit un parcours de sensibilisation adapté et passe une évaluation. Et l'agent autonome — le système lui-même — capture le trafic, détecte les anomalies, corrèle les alertes et produit un rapport structuré.

### Slide 10 — Besoins non fonctionnels *(12s)*
> Au-delà du fonctionnel, les exigences non fonctionnelles portent sur la latence, la fiabilité de détection, l'autonomie opérationnelle, et la maîtrise complète de l'infrastructure. Ces besoins ont directement façonné l'architecture que je vais maintenant vous présenter.

**Repère : 4:45**

---

## Section 3 — Environnement et architecture
*(4:45 → 6:00)*

### Slide 11 — Section Environnement et architecture *(8s)*
> Avant d'entrer dans le détail des sprints, un mot sur l'environnement logiciel et l'architecture globale du système.

### Slide 12 — Transition *(5s)*
> Voici d'abord l'environnement technique utilisé, puis l'architecture de déploiement qui en découle.

### Slide 13 — Environnement logiciel *(25s)*
> NG-IDPS combine des outils open-source reconnus : Suricata et Scapy pour la capture, Kafka pour la messagerie, PyTorch pour le modèle LSTM-VAE, Ollama et Llama 3 pour l'intelligence locale, Node.js et Express côté backend SOAR, et Next.js pour le tableau de bord.

### Slide 14 — Architecture globale *(37s)*
> Cet environnement se déploie sur quatre nœuds spécialisés. VM-Edge capture le trafic avec Suricata. VM-ML héberge le broker Kafka et le moteur de détection comportementale. VM-Response exécute les agents d'intelligence artificielle et la remédiation. Et l'hôte héberge le backend, le dashboard et le modèle LLM local. Chaque flux de données transite par des canaux bien définis : Kafka pour les données, Socket.IO pour les commandes. Cette architecture a été mise en œuvre progressivement, sprint après sprint, selon la méthodologie que je vais maintenant détailler.

**Repère : 6:00**

---

## Section 4 — Méthodologie
*(6:00 → 6:50)*

### Slide 15 — Section Méthodologie *(8s)*
> Voyons maintenant comment ce travail a été organisé dans le temps.

### Slide 16 — Méthodologie Scrum *(30s)*
> Le projet a suivi une méthodologie Scrum, structurée en six sprints répartis sur deux releases : la première consacrée à la détection, la seconde à la prévention et à la réponse. Chaque sprint a suivi le même cycle : backlog, analyse fonctionnelle, conception, réalisation et validation — une rigueur que vous retrouverez dans la présentation de chaque sprint.

### Slide 17 — Équipe Scrum *(12s)*
> L'équipe Scrum réunissait mon encadrant académique, monsieur Hamdi Aloulou, comme Product Owner, et moi-même comme développeur et Scrum Master sur l'ensemble du projet. Entrons maintenant dans le cœur du travail réalisé.

**Repère : 6:50**

---

## Section 5 — Sprints
*(6:50 → 15:15)*

### Slide 18 — Section Sprints *(8s)*
> Voici le déroulement des six sprints qui ont construit NG-IDPS, sprint après sprint.

### Slide 19 — Vue d'ensemble des sprints *(25s)*
> La Release 1, consacrée à la détection, comprend trois sprints : l'acquisition réseau, le pipeline de données, et la détection comportementale. La Release 2, consacrée à la prévention et à la réponse, comprend l'anticipation par le renseignement, la mitigation du risque humain, et l'orchestration SOAR avec supervision. Commençons par la Release 1.

### Slide 20 — Sprint 1, Acquisition réseau *(35s)*
> Le premier sprint met en place la capture réseau. Suricata fonctionne en mode promiscuous, capturant tout le trafic du segment réseau, avec une capture zero-copy en AF_PACKET qui élimine la latence d'acquisition, et produit une sortie structurée en JSON. Point important : Suricata ne bloque jamais directement — il publie ses alertes sur Kafka, et c'est le moteur soar.py qui décide de la remédiation. Cette séparation garantit la continuité de la capture même pendant une action de réponse. Voyons maintenant ce que deviennent ces événements une fois capturés.

### Slide 21 — Sprint 2, Pipeline de données *(28s)*
> Le deuxième sprint construit un pipeline à double chemin. La voie rapide extrait seize caractéristiques par flux, les publie sur Kafka, pour une inférence LSTM-VAE en deux à quatre millisecondes et une décision SOAR en moins de quinze millisecondes bout-en-bout. La voie froide, elle, achemine chaque événement vers Elasticsearch, pour l'audit forensique et la supervision Kibana, sans contrainte de latence. C'est cette voie rapide qui alimente le modèle de détection comportementale que je vais maintenant détailler.

### Slide 22 — Architecture du modèle LSTM-VAE *(28s)*
> Le troisième sprint introduit le cœur de la détection comportementale : un autoencodeur variationnel à mémoire longue. Les couches LSTM capturent la dynamique séquentielle du trafic, tandis que la régularisation variationnelle force le modèle à apprendre une frontière de normalité généralisable. Une anomalie se détecte par une erreur de reconstruction élevée. Encore fallait-il choisir les bonnes caractéristiques en entrée — c'est l'objet de l'étape suivante.

### Slide 23 — Ingénierie des caractéristiques *(28s)*
> Pour sélectionner les seize caractéristiques les plus pertinentes, j'ai utilisé le score ANOVA, qui mesure la capacité de chaque caractéristique à distinguer statistiquement le trafic bénin du trafic malveillant. Le pipeline suit trois étapes : nettoyage des valeurs aberrantes, sélection équilibrée par type d'attaque, puis normalisation MinMax. Une fois ces caractéristiques choisies, restait à déterminer à partir de quel niveau d'erreur une séquence devient anormale.

### Slide 24 — Calibration du seuil *(28s)*
> Ce seuil de détection a été calibré en comparant quatre points de fonctionnement. Le point retenu est mu plus un virgule cinq sigma, soit un seuil de soixante-huit virgule douze, sur l'erreur de reconstruction mesurée en validation. Voyons maintenant si ce choix se justifie face à une architecture alternative.

### Slide 25 — Évaluation du modèle *(45s)*
> J'ai comparé LSTM-VAE à Isolation Forest, dans des conditions strictement identiques. LSTM-VAE atteint un rappel global de cinquante et un virgule quatre-vingt-neuf pour cent, pour seulement neuf virgule vingt-trois pour cent de faux positifs — contre cinquante-sept pour cent pour Isolation Forest, dépourvu de modélisation temporelle. Sur les attaques par force brute, l'écart est spectaculaire : quatre-vingt-dix-huit pour cent de rappel contre zéro virgule vingt-trois. Et surtout, en conditions réelles — sur une chaîne complète, quarante-six mille neuf cent soixante flux rejoués chronologiquement — les six attaques testées ont toutes été détectées, dont un brute-force SSH que Suricata seul ne couvrait pas, avec un taux de faux positifs réel de seulement zéro virgule dix-huit pour cent. Ceci clôt la Release 1, consacrée à la détection. Passons maintenant à la Release 2 : la prévention et la réponse.

### Slide 26 — Transition Release 2 *(5s)*
> Voici les trois sprints qui transforment la détection en action : renseignement, sensibilisation, et orchestration.

### Slide 27 — Architecture Sprint 4, Agent CTI *(28s)*
> Le quatrième sprint introduit l'agent CTI, qui automatise la veille OSINT. Chaque article est trié par un LLM local, confronté à deux bases de référence — l'historique des menaces déjà traitées et près de quarante-neuf mille règles Suricata existantes — avant de proposer soit une règle de détection candidate, soit un contenu de sensibilisation. Voyons en détail comment s'opère ce tri.

### Slide 28 — Le triage Dual-RAG *(25s)*
> Ce triage Dual-RAG aboutit à quatre issues possibles : menace technique, sensibilisation, bruit à rejeter, ou contenu déjà connu. La déduplication en amont évite tout appel inutile au LLM, et la distinction technique-sensibilisation oriente chaque menace vers l'action adaptée. Suivons maintenant le chemin d'une menace technique jusqu'à son déploiement.

### Slide 29 — De l'article à la règle active *(28s)*
> Une fois classée menace technique, la règle suit un cycle de validation strict : génération, persistance en statut en attente, puis test syntaxique à blanc avant déploiement — aucune règle n'est injectée sans cette vérification. L'autre issue possible, la sensibilisation, déclenche un processus différent que voici.

### Slide 30 — Architecture Sprint 5 *(22s)*
> Le cinquième sprint s'attaque au facteur humain. Un article de sensibilisation déclenche, sur décision de l'administrateur, la génération d'un parcours de formation personnalisé, sa diffusion ciblée, et le suivi de conformité des employés. La génération de ce contenu s'appuie sur un mécanisme de résilience que je détaille maintenant.

### Slide 31 — Cascade de résilience multi-LLM *(28s)*
> Cette génération s'appuie sur une cascade à trois paliers : Gemini en primaire dans le cloud, Mistral en secours, et Llama 3.2 en local comme dernier recours — garantissant la continuité du service même en cas de panne totale des deux fournisseurs cloud. Une fois le module généré, encore faut-il garantir qu'il atteint la bonne personne.

### Slide 32 — Diffusion et suivi de conformité *(22s)*
> L'accès au module reste strictement contrôlé : un identifiant inconnu est rejeté, et même un employé avec un identifiant valide ne peut accéder au contenu s'il n'est pas dans le périmètre de diffusion choisi par l'administrateur. Passons maintenant au dernier sprint, celui qui orchestre l'ensemble de la réponse.

### Slide 33 — Architecture Sprint 6, Orchestration SOAR *(28s)*
> Le sixième et dernier sprint clôt la chaîne avec l'orchestration SOAR. Il distingue deux moteurs : soar.py, qui corrèle et décide en autonomie complète, et agent_soar.py, qui n'exécute que sur ordre explicite — qu'il vienne d'un administrateur ou du mode auto-pilote. Voyons d'abord comment soar.py prend sa décision.

### Slide 34 — Logique de décision autonome *(30s)*
> Avant toute action, chaque alerte passe par la politique Zero Trust, puis par une fenêtre de corrélation de trente secondes entre les deux sources de détection. C'est cette corrélation, et non une alerte isolée, qui déclenche un blocage autonome. Cette décision est ensuite transmise à un second moteur, dont le rôle est bien distinct.

### Slide 35 — Deux moteurs, deux responsabilités *(25s)*
> Cette séparation garantit qu'un humain, ou une règle explicite du mode auto-pilote, reste toujours le seul point d'origine d'une action sur l'infrastructure — même lorsque la détection elle-même est entièrement automatisée. Terminons ce sprint par les mécanismes qui assurent sa résilience opérationnelle.

### Slide 36 — Résilience et autonomie *(30s)*
> Un score composite pondère les trois sources de détection pour alimenter le mode auto-pilote, garantissant une réponse sans délai même sans supervision humaine. Trois mécanismes renforcent cette résilience : un watchdog qui détecte une panne de nœud en moins de quinze secondes, une reconnexion Kafka automatique, et un bouclier anti-DDoS. Ceci achève la présentation des six sprints. Je termine à présent sur les perspectives et la conclusion de ce travail.

**Repère : 15:15**

---

## Section 6 — Perspectives et conclusion
*(15:15 → 16:40)*

### Slide 37 — Section Perspectives et conclusion *(6s)*
> Pour conclure, voyons les perspectives d'évolution de ce travail.

### Slide 38 — Perspectives *(35s)*
> Quatre axes permettraient de faire évoluer NG-IDPS vers une échelle supérieure. La conteneurisation sous Docker et Kubernetes, pour l'auto-scaling de l'inférence. L'intégration XDR, pour corréler avec d'autres couches de sécurité. L'interopérabilité SOAR, pour piloter ou être piloté par des plateformes d'orchestration du marché. Et l'évolution vers des modèles de langage plus puissants, dès lors que les ressources matérielles le permettront.

### Slide 39 — Conclusion *(28s)*
> En conclusion, NG-IDPS démontre qu'une chaîne complète — détection par signatures, détection comportementale, renseignement, réponse orchestrée et supervision SOC — peut fonctionner de façon autonome et supervisable, sur des composants libres et des modèles de langage auto-hébergés, offrant une base crédible de cyberdéfense proactive pour les organisations sans SOC permanent.

### Slide 40 — Merci *(5s)*
> Je vous remercie de votre attention, et je suis prêt à répondre à vos questions.

**Repère final : 16:40**

---

## Synthèse des repères de pacing

| Repère cumulé | Événement |
|---|---|
| 0:55 | Fin de l'ouverture |
| 3:35 | Fin de l'introduction |
| 4:45 | Fin de l'analyse des besoins |
| 6:00 | Fin de l'environnement et architecture |
| 6:50 | Fin de la méthodologie |
| 10:45 | Fin de la Release 1 (slide 25) |
| 15:15 | Fin des six sprints |
| 16:40 | Fin de la présentation |

**Marge de sécurité : environ 3 min 20** sur les 20 minutes imposées — à garder pour le débit naturel, les respirations, et d'éventuels aléas techniques en début de soutenance.

**Points de vigilance à l'oral :**
- Les slides 4 (Problématique) et 25 (Évaluation) sont les plus denses — ne les précipite pas, c'est là que se joue la crédibilité technique.
- Les slides de section (dividers) doivent vraiment rester à quelques secondes — résiste à la tentation de les commenter davantage.
- Si tu sens que tu prends du retard à un repère, les slides 12, 17, 26 et 37 sont les plus compressibles sans perte de contenu.
