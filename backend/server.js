const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { Kafka } = require('kafkajs');
const { GoogleGenAI } = require('@google/genai');
const jwt = require('jsonwebtoken');

require('dotenv').config();



// Initialisation du client Gemini avec la nouvelle librairie unifiée
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const JWT_SECRET = process.env.JWT_SCRT;


// ========================================================
// 1. Connexion à la base de données & Configuration Whitelist
// ========================================================
mongoose.connect('mongodb://localhost:27017/soc_dashboard')
  .then(() => console.log('[+] Connecté à MongoDB (Hub WebSocket)'))
  .catch(err => console.error('[-] Erreur MongoDB:', err));

const VmNodeSchema = new mongoose.Schema({
  hostname: { type: String, required: true, unique: true },
  ipAddress: String,
  os: String,
  cpuUsage: Number,
  ramUsage: Number,
  services: Array,
  lastHeartbeat: { type: Date, default: Date.now },
  nodeStatus: String
}, { strict: false });

const VmNode = mongoose.model('VmNode', VmNodeSchema);

const SoarCaseSchema = new mongoose.Schema({
  kibanaUrl: String,
  sourceSensor: String,
  maliciousIp: String,
  threatType: String,
  severity: String,
  aiSummary: String,
  diagnostic_json: { type: Object, default: null },
  aiConfidenceScore: Number,
  duree_generation_sec: Number,
  caseStatus: { type: String, default: "Ouvert" },
  timestamp: { type: Date, default: Date.now }
});
const SoarCase = mongoose.model('SoarCase', SoarCaseSchema);


// Modèle pour gérer dynamiquement les sources OSINT (URLs, flux RSS, APIs)
const CtiSourceSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  url: { type: String, required: true },
  type_source: { type: String, default: "URL" }, // Ex: "RSS", "HTML", "API"
  actif: { type: Boolean, default: true },       // L'admin peut désactiver la source
  date_ajout: { type: Date, default: Date.now }
});
const CtiSource = mongoose.model('CtiSource', CtiSourceSchema);



// Modèle pour stocker les rapports finaux générés par l'Agent Python & Formations
const CtiActualitySchema = new mongoose.Schema({
  titre_menace: String,
  source_osint: String,
  url_article: String,
  resume_ia: String,
  type_article: { type: String, default: "TECHNICAL_THREAT" }, // "TECHNICAL_THREAT" ou "AWARENESS"
  iocs_extraits: Array,
  regles_suricata: String,
  fiabilite_score: Number,
  status: { type: String, default: "PENDING" },
  error_log: { type: String, default: null },
  formation_data: { type: Object, default: null }, // <-- CHAMP OBLIGATOIRE POUR STOCKER LE COURS GEMINI
  last_updated: { type: Date, default: Date.now },
  date_publication: { type: Date, default: Date.now }
});
const CtiActuality = mongoose.model('CtiActuality', CtiActualitySchema);


// Modèle pour stocker les résultats des employés aux formations
const FormationRecordSchema = new mongoose.Schema({
  courseId: String,
  courseTitle: String,
  employeeId: String,
  employeeName: String,
  department: String,
  score: Number,
  completedAt: { type: Date, default: Date.now }
});
const FormationRecord = mongoose.model('FormationRecord', FormationRecordSchema);



const WHITELIST_PATH = path.join(__dirname, 'actifs_critiques.json');

function getWhitelistData() {
  try {
    if (fs.existsSync(WHITELIST_PATH)) {
      const raw = fs.readFileSync(WHITELIST_PATH, 'utf-8');
      const data = JSON.parse(raw);
      return data.whitelist || data.actifs_critiques || [];
    }
  } catch (e) {
    console.error("Erreur lecture actifs_critiques.json:", e);
  }
  return ["192.168.56.128", "192.168.56.130", "192.168.56.140", "192.168.56.1"];
}

function saveWhitelistData(list) {
  try {
    const payload = { whitelist: list };
    fs.writeFileSync(WHITELIST_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (e) {
    console.error("Erreur écriture actifs_critiques.json:", e);
  }
}

// ========================================================
// 2. Fonction de Calcul du Score de Menace Composé (Data Fusion)
// ========================================================
function calculerScoreMenaceCompose(payload) {
  const POIDS_SURICATA = 0.4;
  const POIDS_ML = 0.3;
  const POIDS_LLM = 0.3;

  let scoreSuricata = 50;
  const severity = payload.severity || payload.diagnostic_json?.niveau_severite || "";
  if (severity.toLowerCase().includes("critique")) scoreSuricata = 100;
  else if (severity.toLowerCase().includes("élevé") || severity.toLowerCase().includes("haut")) scoreSuricata = 80;

  let scoreML = payload.ml_anomaly_score || 75;
  let scoreLLM = payload.diagnostic_json?.score_confiance || 80;

  const scoreFinal = Math.round(
    (scoreSuricata * POIDS_SURICATA) +
    (scoreML * POIDS_ML) +
    (scoreLLM * POIDS_LLM)
  );

  return Math.min(Math.max(scoreFinal, 0), 100);
}

// ========================================================
// 3. Configuration du transporteur d'Email (SMTP)
// ========================================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'zed.legacy.02@gmail.com',
    pass: process.env.EMAIL_PASS
  }
});

// ========================================================
// 4. Initialisation du serveur Express & Socket.io
// ========================================================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "http://192.168.56.1:3000"],
    methods: ["GET", "POST", "DELETE"]
  }
});

let activeAdmins = 0;

// 🛡️ MOTEUR DE CORRÉLATION : Mémoire pour éviter les Faux Positifs
let lastExternalAttackTime = 0;

// ========================================================
// 5. Configuration du Client KAFKA
// ========================================================
const kafka = new Kafka({
  clientId: 'soc-dashboard-hub',
  brokers: ['192.168.56.130:9092'],
  retry: {
    initialRetryTime: 3000,
    retries: 8
  }
});
const kafkaConsumer = kafka.consumer({ groupId: 'dashboard-group' });

// ========================================================
// 6. CONSOMMATEUR KAFKA (Pipeline Asynchrone SOC + Auto-Pilote)
// ========================================================
async function startKafkaConsumer() {
  try {
    await kafkaConsumer.connect();
    console.log('[+] Connecté au cluster Kafka (Dashboard Hub)');

    await kafkaConsumer.subscribe({ topic: 'alerts-for-llm', fromBeginning: false });
    await kafkaConsumer.subscribe({ topic: 'incident-reports', fromBeginning: false });

    await kafkaConsumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const payload = JSON.parse(message.value.toString());

          // -----------------------------------------------------
          // A. L'ALERTE INITIALE (DU SOAR VERS L'IA)
          // -----------------------------------------------------
          if (topic === 'alerts-for-llm') {
            const isWhitelisted = getWhitelistData().includes(payload.src_ip);
            const now = Date.now();

            // 🛡️ MOTEUR DE CORRÉLATION : Suppression des Faux Positifs (Alert Muting)
            if (!isWhitelisted) {
              // C'est une vraie attaque externe. On mémorise l'heure !
              lastExternalAttackTime = now;
              console.log(`[!] Alerte SOC (EXTERNE) détectée pour IP: ${payload.src_ip}`);
            } else {
              // C'est une IP interne. Le réseau est-il sous le coup d'une attaque externe récente ?
              const timeSinceLastAttack = now - lastExternalAttackTime;
              if (timeSinceLastAttack < 180000) { // 3 minutes (180 000 ms) pour couvrir tout le SYN Flood
                console.log(`[♻️ CORRÉLATION] Faux Positif ignoré pour l'actif critique ${payload.src_ip}. L'anomalie (MSE) est due à l'attaque externe en cours (Bruit collatéral).`);
                return; // 🛑 ON STOPPE ICI !
              } else {
                console.log(`[!] Alerte SOC (INTERNE / Zero Trust) détectée pour IP: ${payload.src_ip}`);
              }
            }

            const isAutoBlocked = payload.auto_blocked === true;

            const alertData = {
              sourceSensor: payload.source_detection || "Multi-Source",
              maliciousIp: payload.src_ip,
              threatType: isAutoBlocked ? "Menace Critique (Bloquée)" : "Menace Suspecte (À vérifier)",
              aiSummary: "⏳ L'Agent IA (Llama 3) analyse actuellement les paquets. Veuillez patienter...",
              aiConfidenceScore: 0,
              caseStatus: isAutoBlocked ? "Analyse IA (Auto-bloqué)" : "Analyse IA (Action requise)",
              timestamp: new Date()
            };
            const savedIncident = await SoarCase.create(alertData);
            io.emit('soar_incident_incoming', savedIncident);
          }

          // -----------------------------------------------------
          // B. LE RETOUR DE L'IA (OU LE BYPASS DU SOAR)
          // -----------------------------------------------------
          if (topic === 'incident-reports') {
            console.log(`[+] Rapport reçu (IA ou Bypass) pour IP: ${payload.src_ip}`);

            const existingIncident = await SoarCase.findOne({
              maliciousIp: payload.src_ip,
              caseStatus: { $regex: /^Analyse IA/ }
            }).sort({ timestamp: -1 });

            if (existingIncident) {
              // 🛡️ Parsing sécurisé du JSON de Llama 3
              let diagJson = payload.diagnostic_json;
              if (typeof diagJson === 'string') {
                try { diagJson = JSON.parse(diagJson); } catch (e) { diagJson = null; }
              }

              // 🛠️ LE CORRECTIF ZERO TRUST : Si c'est un Bypass de soar.py sans JSON
              if (!diagJson || Object.keys(diagJson).length === 0) {
                diagJson = {
                  titre_incident: "Alerte Mouvement Latéral (Bypass IA)",
                  resume_executif: payload.diagnostic || payload.aiSummary || "Alerte de sécurité critique interceptée. L'analyse IA profonde a été contournée par le SOAR pour garantir une vitesse de réaction maximale.",
                  niveau_severite: "Critique",
                  score_confiance: 99,
                  mitre_attack_technique: "T1021 - Remote Services",
                  analyse_technique: "Le modèle de détection d'anomalie (LSTM-VAE) a détecté un MSE anormalement élevé sur un actif de la Whitelist. Le SOAR a appliqué une politique de Fail-Open (Zero Trust).",
                  recommandations_actions: [
                    "Isoler physiquement la machine compromise du réseau interne",
                    "Tuer les connexions actives vers des ports non standards",
                    "Lancer un scan complet des processus (Chasse aux menaces)"
                  ]
                };
              }

              const calculatedConfidence = calculerScoreMenaceCompose({
                ...payload,
                diagnostic_json: diagJson
              });
              const isWhitelisted = getWhitelistData().includes(payload.src_ip);

              let finalStatus = "Ouvert";

              // Logique Auto-Pilote (Mode Nuit)
              if (activeAdmins === 0 && calculatedConfidence >= 85 && !isWhitelisted) {
                console.log(`[!] Mode Nuit : Score composite élevé (${calculatedConfidence}%). Auto-blocage activé.`);
                finalStatus = "Bannie (Auto-Pilote / Mode Nuit)";

                io.emit('execute_command', {
                  action: "BLOCK_IP",
                  targetIp: payload.src_ip,
                  sensor: "SOAR-Auto-Pilot",
                  incidentId: existingIncident._id
                });
              } else if (isWhitelisted) {
                console.log(`[!] Alerte ignorée pour le blocage : IP ${payload.src_ip} appartient à la Whitelist (Fail-Open).`);
                finalStatus = "Alerte Zero Trust (Protégée)";
              } else if (existingIncident.caseStatus.includes("Auto-bloqué")) {
                finalStatus = "Bannie (Auto-Remédiation)";
              }

              // Extraction finale pour la DB
              const titreIncident = diagJson.titre_incident;
              const resumeExecutif = diagJson.resume_executif;
              // Si c'est un bypass instantané, on met 0.1s pour ne pas casser l'affichage
              const dureeGeneration = payload.duree_generation_sec || 0.1;

              // Mise à jour de MongoDB avec la nouvelle syntaxe Mongoose (returnDocument)
              const updatedIncident = await SoarCase.findOneAndUpdate(
                { _id: existingIncident._id },
                {
                  threatType: titreIncident,
                  aiSummary: resumeExecutif,
                  diagnostic_json: diagJson,
                  aiConfidenceScore: calculatedConfidence,
                  duree_generation_sec: dureeGeneration,
                  caseStatus: finalStatus
                },
                { returnDocument: 'after' }
              );

              if (updatedIncident) {
                if (activeAdmins > 0) {
                  io.emit('soar_incident_updated', updatedIncident);
                } else {
                  console.log('[-] Aucun admin en ligne. Escalade par EMAIL en cours...');
                  const actionText = finalStatus === "Ouvert"
                    ? "Action REQUISE : Connectez-vous pour bloquer l'IP."
                    : "Action : IP auto-bloquée en mode Nuit (Auto-Pilote) ou isolée (Zero Trust).";

                  const mailOptions = {
                    from: '"SOC Automatisé" <zed.legacy.02@gmail.com>',
                    to: 'zizoudh06@gmail.com',
                    subject: `🚨 ALERTE SOC : ${updatedIncident.threatType}`,
                    html: `
                            <h2 style="color: ${finalStatus === 'Ouvert' ? 'orange' : 'red'};">Incident de Sécurité Qualifié</h2>
                            <p><strong>IP Malveillante :</strong> ${updatedIncident.maliciousIp}</p>
                            <p><strong>Temps de Génération :</strong> ${dureeGeneration} secondes</p>
                            <p><strong>Score Composé :</strong> ${calculatedConfidence}%</p>
                            <p><strong>Statut :</strong> ${finalStatus}</p>
                            <p><strong>Analyse IA :</strong> <br/> ${updatedIncident.aiSummary.replace(/\n/g, '<br/>')}</p>
                            <br/>
                            <p><i>${actionText}</i></p>
                          `
                  };
                  transporter.sendMail(mailOptions, (error, info) => {
                    if (error) console.error('[-] Erreur envoi email:', error);
                    else console.log('[+] Email d\'alerte envoyé avec succès :', info.response);
                  });
                }
              }
            } else {
              console.log(`[-] Aucun incident 'Analyse IA' trouvé pour l'IP ${payload.src_ip}`);
            }
          }
        } catch (error) {
          console.error("[-] Erreur de traitement Kafka :", error);
        }
      },
    });
  } catch (error) {
    console.error('[-] Erreur Kafka:', error);
  }
}
startKafkaConsumer();


// ========================================================
// ROUTE : AUTHENTIFICATION GLOBALE DU SOC (JWT)
// ========================================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  // Création du profil Administrateur (Toi, le RSSI)
  const adminUser = { 
    id: "ADMIN-001", 
    username: "admin", 
    password: "soc", 
    role: "RSSI", 
    name: "Administrateur SOC" 
  };

  // Vérification stricte
  if (username === adminUser.username && password === adminUser.password) {
    // Génération du Token avec une durée de vie de 8 heures
    const token = jwt.sign(
      { id: adminUser.id, username: adminUser.username, role: adminUser.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    console.log(`[+] Connexion SOC réussie : ${adminUser.name} (Rôle: ${adminUser.role})`);
    
    // On renvoie le token et les infos au front-end
    return res.json({ 
      success: true, 
      token, 
      user: { name: adminUser.name, role: adminUser.role } 
    });
  } else {
    console.log(`[-] Tentative de connexion échouée pour : ${username}`);
    return res.status(401).json({ success: false, error: "Identifiants SOC invalides." });
  }
});

// ========================================================
// 🛡️ MIDDLEWARE ZERO TRUST : VÉRIFICATION DU TOKEN ADMIN
// ========================================================
const verifySOCAdmin = (req, res, next) => {
  // 1. On cherche le token dans l'en-tête "Authorization"
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log(`[-] Accès API refusé (Token manquant) sur ${req.originalUrl}`);
    return res.status(401).json({ error: "Accès refusé. Jeton d'authentification manquant." });
  }

  // 2. On extrait le token (format "Bearer eyJhbGci...")
  const token = authHeader.split(' ')[1];

  try {
    // 3. On vérifie cryptographiquement le token avec notre clé secrète
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // 4. (God's Level) On vérifie le rôle ! Seul le RSSI peut passer.
    if (decoded.role !== 'RSSI') {
      console.log(`[-] Accès API refusé (Privilèges insuffisants) pour ${decoded.username}`);
      return res.status(403).json({ error: "Privilèges insuffisants pour cette action." });
    }

    // 5. Tout est bon, on attache l'utilisateur à la requête et on laisse passer
    req.user = decoded;
    next();
  } catch (error) {
    console.log(`[-] Accès API refusé (Token invalide/expiré)`);
    return res.status(401).json({ error: "Session invalide ou expirée. Veuillez vous reconnecter." });
  }
};

// ========================================================
// 7. ROUTES API & LOGIQUE WEBSOCKET
// ========================================================


// A. Récupérer les sources actives (L'Agent Python l'appellera au démarrage)
app.get('/api/cti-sources', async (req, res) => {
  try {
    // On ne renvoie que les sources que l'admin a laissées actives
    const sources = await CtiSource.find({ actif: true });
    res.json(sources);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la lecture des sources CTI" });
  }
});

// B. Ajouter une nouvelle source OSINT (Le Dashboard Next.js l'appellera)
app.post('/api/cti-sources', async (req, res) => {
  try {
    const { nom, url, type_source } = req.body;
    if (!nom || !url) return res.status(400).json({ error: "Nom et URL requis" });

    const nouvelleSource = await CtiSource.create({ nom, url, type_source });
    console.log(`[+] Nouvelle source CTI ajoutée : ${nom}`);
    res.json({ success: true, source: nouvelleSource });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de l'ajout de la source CTI" });
  }
});

// C. Récupérer le fil d'actualités CTI (Pour la nouvelle page de ton Dashboard)
app.get('/api/cti-actualities', async (req, res) => {
  try {
    const actualites = await CtiActuality.find().sort({ date_publication: -1 }).limit(50);
    res.json(actualites);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la lecture des actualités CTI" });
  }
});

app.get('/api/incidents', async (req, res) => {
  try {
    const history = await SoarCase.find().sort({ timestamp: -1 }).limit(50);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la lecture de la base de données" });
  }
});

app.get('/api/vms', async (req, res) => {
  try {
    const vms = await VmNode.find();
    res.json(vms);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la lecture des VMs" });
  }
});

app.get('/api/whitelist', (req, res) => {
  try {
    const list = getWhitelistData();
    res.json({ whitelist: list });
  } catch (error) {
    res.status(500).json({ error: "Erreur de lecture de la whitelist" });
  }
});

app.post('/api/whitelist', (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: "Adresse IP requise" });

    let list = getWhitelistData();
    if (!list.includes(ip)) {
      list.push(ip);
      saveWhitelistData(list);
      console.log(`[+] Whitelist mise à jour : IP ${ip} ajoutée.`);
      io.emit('sync_whitelist', list);
    }
    res.json({ success: true, whitelist: list });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de l'ajout à la whitelist" });
  }
});

app.delete('/api/whitelist', (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: "Adresse IP requise" });

    let list = getWhitelistData();
    list = list.filter(item => item !== ip);
    saveWhitelistData(list);
    console.log(`[-] Whitelist mise à jour : IP ${ip} retirée.`);
    io.emit('sync_whitelist', list);
    res.json({ success: true, whitelist: list });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la suppression de la whitelist" });
  }
});

io.on('connection', (socket) => {
  const origin = socket.handshake.headers.origin;
  const isDashboard = origin === "http://localhost:3000" || origin === "http://192.168.56.1:3000";

  if (isDashboard) {
    activeAdmins++;
    console.log(`[+] Admin connecté. Total admins en ligne : ${activeAdmins}`);
  } else {
    console.log(`[+] Capteur connecté. ID: ${socket.id}`);
  }

  socket.on('vm_metrics', async (data) => {
    try {
      const updatedNode = await VmNode.findOneAndUpdate(
        { hostname: data.hostname },
        { ...data, lastHeartbeat: new Date(), nodeStatus: 'Online' },
        { upsert: true, returnDocument: 'after' }
      );
      io.emit('dashboard_update', updatedNode);
    } catch (error) {
      console.error("[-] Erreur DB métriques:", error);
    }
  });

  socket.on('new_security_alert', async (alertData) => {
    console.log(`[!] Alerte critique reçue de la Simulation : ${alertData.threatType}`);
    const savedIncident = await SoarCase.create(alertData);
    if (activeAdmins > 0) {
      io.emit('soar_incident_incoming', savedIncident);
    }
  });

  socket.on('send_command', async (commandData) => {
    io.emit('execute_command', commandData);

    if (commandData.incidentId && commandData.action === 'BLOCK_IP') {
      try {
        const pendingIncident = await SoarCase.findOneAndUpdate(
          { _id: commandData.incidentId },
          { caseStatus: "En cours de blocage..." },
          { returnDocument: 'after' }
        );
        io.emit('soar_incident_updated', pendingIncident);
      } catch (error) {
        console.error("[-] Erreur DB lors du passage en pending:", error);
      }
    }
    else if (commandData.incidentId && commandData.action === 'IGNORE_INCIDENT') {
      try {
        const finalizedIncident = await SoarCase.findOneAndUpdate(
          { _id: commandData.incidentId },
          { caseStatus: "Faux Positif (Ignoré)" },
          { returnDocument: 'after' }
        );
        io.emit('soar_incident_updated', finalizedIncident);
        console.log(`[+] Incident ${commandData.incidentId} marqué comme Faux Positif par l'Admin.`);
      } catch (error) {
        console.error("[-] Erreur DB lors de l'ignorance de l'incident:", error);
      }
    }
  });

  socket.on('command_result', async (resultData) => {
    console.log(`[!] Retour d'exécution SOAR : ${resultData.status} pour IP ${resultData.ip}`);
    const finalStatus = resultData.status === 'success' ? "IP Bannie (Résolu)" : "Échec du Blocage";
    try {
      const finalizedIncident = await SoarCase.findOneAndUpdate(
        { _id: resultData.incidentId },
        { caseStatus: finalStatus },
        { returnDocument: 'after' }
      );
      io.emit('soar_incident_updated', finalizedIncident);
    } catch (error) {
      console.error("[-] Erreur DB lors de la validation du blocage:", error);
    }
  });

  socket.on('disconnect', () => {
    if (isDashboard) {
      activeAdmins = Math.max(0, activeAdmins - 1);
      console.log(`[-] Admin déconnecté. Total admins en ligne : ${activeAdmins}`);
    } else {
      console.log(`[-] Capteur déconnecté. ID: ${socket.id}`);
    }
  });
});


// D. [Cible: Next.js & vm-edge] Mettre à jour le statut d'une règle (PENDING -> APPROVED -> DEPLOYED)
app.post('/api/rules/update-status', async (req, res) => {
  try {
    // On récupère error_log en plus
    const { rule_id, status, error_log } = req.body;
    if (!rule_id || !status) return res.status(400).json({ error: "rule_id et status requis" });

    const updatedRule = await CtiActuality.findByIdAndUpdate(
      rule_id,
      { status: status, error_log: error_log || null, last_updated: Date.now() },
      { new: true }
    );

    if (updatedRule) {
      res.json({ message: "Statut mis à jour", new_status: status });
    } else {
      res.status(404).json({ error: "Règle introuvable" });
    }
  } catch (error) {
    res.status(500).json({ error: "Erreur interne" });
  }
});

// [Cible: Next.js] L'admin a corrigé la règle manuellement
app.post('/api/rules/edit', async (req, res) => {
  try {
    const { rule_id, new_rule } = req.body;
    if (!rule_id || !new_rule) return res.status(400).json({ error: "Données manquantes" });

    const updatedRule = await CtiActuality.findByIdAndUpdate(
      rule_id,
      // On met à jour la règle, on efface l'erreur, et on repasse en PENDING
      { regles_suricata: new_rule, status: "PENDING", error_log: null, last_updated: Date.now() },
      { new: true }
    );

    res.json({ message: "Règle corrigée et remise en attente", rule: updatedRule });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la modification" });
  }
});

// E. [Cible: vm-edge] Le pare-feu appelle cette route pour récupérer les règles à injecter à chaud
app.get('/api/rules/pending-deploy', async (req, res) => {
  try {
    const approvedRules = await CtiActuality.find({ status: "APPROVED" });
    res.json({ count: approvedRules.length, rules: approvedRules });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la récupération des règles à déployer" });
  }
});



// Route pour générer le module de formation (Micro-Learning via Gemini)
app.post('/api/formations/generate', async (req, res) => {
  try {
    const { rule_id, titre_menace, resume_ia, source_texte } = req.body;

    if (!rule_id) {
      return res.status(400).json({ error: "L'ID de l'alerte (rule_id) est requis." });
    }

    // Vérification de validité de l'ObjectId MongoDB
    if (!mongoose.Types.ObjectId.isValid(rule_id)) {
      return res.status(400).json({ error: "Format d'ID MongoDB invalide." });
    }

    console.log(`[+] Lancement de la génération du cours pour : ${titre_menace}`);

    const prompt = `
      Tu es un Expert Pédagogue et Formateur en Cybersécurité (Niveau CISSP / CISO).
      Nous avons détecté l'alerte de sensibilisation suivante :
      - Titre : ${titre_menace}
      - Résumé : ${resume_ia}
      - Détails OSINT : ${source_texte || "Non fournis, base-toi sur le contexte du titre et du résumé."}

      MISSION :
      Rédige une formation interactive complète de Micro-Learning pour les employés de l'entreprise.
      Le contenu doit être didactique, très clair, professionnel et approfondi (pas de résumés superficiels).

      CONTRAINTES DE FORMAT :
      Tu DOIS renvoyer STRICTEMENT un objet JSON valide avec cette structure exacte :
      {
        "titre_cours": "Titre engageant et professionnel pour la formation",
        "diagramme_mermaid": "sequenceDiagram\\nparticipant Attaquant\\nparticipant Utilisateur\\nparticipant Serveur\\nNote over Attaquant,Utilisateur: Déroulement de l'attaque...",
        "modules": [
          {
            "chapitre": "1. Anatomie et Définition de la Menace",
            "contenu": "Explication approfondie en plusieurs paragraphes..."
          },
          {
            "chapitre": "2. Vecteurs d'Attaque et Scénarios Réels",
            "contenu": "Comment les attaquants exploitent cette faille étape par étape..."
          },
          {
            "chapitre": "3. Mesures de Prévention et Bonnes Pratiques",
            "contenu": "Consignes de sécurité concrètes et reflexes à adopter..."
          }
        ],
        "quiz": [
          {
            "question": "Texte de la question 1 ?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "reponse_correcte": 0
          },
          {
            "question": "Texte de la question 2 ?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "reponse_correcte": 2
          },
          {
            "question": "Texte de la question 3 ?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "reponse_correcte": 1
          },
          {
            "question": "Texte de la question 4 ?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "reponse_correcte": 3
          },
          {
            "question": "Texte de la question 5 ?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "reponse_correcte": 0
          }
        ]
      }

      RÈGLES STRICTES :
      1. Le champ 'reponse_correcte' doit être un indice entier compris entre 0 et 3 pointant vers la bonne réponse dans le tableau 'options'.
      2. Le champ 'diagramme_mermaid' doit contenir une syntaxe valide (Flowchart ou SequenceDiagram).
      3. Génère entre 5 et 7 questions pertinentes dans le tableau 'quiz'.
      4. Ne renvoie AUCUNE balise markdown (pas de \`\`\`json).
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.5
      }
    });

    const formationJSON = JSON.parse(response.text);

    // Sauvegarde dans MongoDB avec le statut mis à jour
    const updatedAlert = await CtiActuality.findByIdAndUpdate(
      rule_id,
      {
        status: "FORMATION_GENERATED",
        formation_data: formationJSON,
        last_updated: Date.now()
      },
      { new: true }
    );

    if (!updatedAlert) {
      return res.status(404).json({ error: "Alerte CTI introuvable dans la base de données." });
    }

    console.log(`[+] Formation générée et enregistrée avec succès pour l'ID: ${rule_id}`);
    res.json({
      message: "Formation générée avec succès !",
      formation: formationJSON
    });

  } catch (error) {
    console.error("[-] Erreur de l'Agent Cloud Gemini :", error);
    res.status(500).json({ error: "Échec de la génération de la formation.", details: error.message });
  }
});


// 1. Route pour récupérer la liste complète des départements et employés
app.get('/api/employes', (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const dataPath = path.join(__dirname, 'employes.json');

    if (fs.existsSync(dataPath)) {
      const employesData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      res.json(employesData);
    } else {
      res.json({});
    }
  } catch (error) {
    res.status(500).json({ error: "Erreur lecture fichier employés." });
  }
});

// ========================================================
// ROUTE : DIFFUSION PERSONNALISÉE DU FORMATION
// ========================================================
app.post('/api/formations/distribute',verifySOCAdmin, async (req, res) => {
  try {
    const { rule_id, formation_data, targetType, targetValue } = req.body;

    if (!rule_id || !formation_data) {
      return res.status(400).json({ error: "Les données de la formation sont requises." });
    }

    const fs = require('fs');
    const path = require('path');
    const annuaire = JSON.parse(fs.readFileSync(path.join(__dirname, 'employes.json'), 'utf8'));

    let destinataires = [];

    // NOUVEAU : Récupération des objets employés complets (au lieu de juste l'email)
    if (targetType === "DEPARTEMENT" && targetValue && annuaire[targetValue]) {
      destinataires = annuaire[targetValue];
    } else {
      // "ALL" : On fusionne tous les tableaux d'employés
      Object.values(annuaire).forEach(departementList => {
        destinataires.push(...departementList);
      });
    }

    if (destinataires.length === 0) {
      return res.status(400).json({ error: "Aucun destinataire trouvé pour cette cible." });
    }

    console.log(`[+] Lancement de la campagne ciblée pour ${destinataires.length} collaborateurs...`);

    // NOUVEAU : Création d'une boucle de promesses pour envoyer des e-mails individuels
    const emailPromises = destinataires.map(emp => {
      const emailHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f4f7f6; padding: 20px; border-radius: 10px;">
          <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border-top: 5px solid #8b5cf6;">
            <h2 style="color: #1e293b; margin-top: 0; font-size: 24px;">🛡️ Alerte Sécurité & Formation</h2>
            <p style="color: #475569; font-size: 15px; line-height: 1.6;">
              Bonjour <strong>${emp.nom}</strong>,<br><br>
              Notre centre de Cyber Threat Intelligence (CTI) a identifié une nouvelle menace. 
              Dans le cadre de notre politique de <strong>Zero Trust</strong>, une formation de Micro-Learning vous a été assignée.
            </p>
            
            <!-- BLOC IDENTIFIANT EMPLOYÉ -->
            <div style="background-color: #f1f5f9; padding: 15px; border-radius: 6px; text-align: center; margin: 20px 0; border: 1px dashed #cbd5e1;">
              <p style="margin: 0; color: #64748b; font-size: 13px; font-weight: bold;">VOTRE IDENTIFIANT DE CONNEXION :</p>
              <h3 style="margin: 5px 0 0 0; color: #8b5cf6; font-size: 22px; letter-spacing: 2px;">${emp.id_employe}</h3>
            </div>

            <div style="background-color: #f8fafc; border-left: 4px solid #8b5cf6; padding: 15px; margin: 25px 0;">
              <h3 style="color: #334155; margin-top: 0; font-size: 18px;">${formation_data.titre_cours}</h3>
              <p style="color: #64748b; font-size: 14px; margin-bottom: 0;">
                <strong>Extrait :</strong> ${formation_data.modules[0].contenu.substring(0, 150)}...
              </p>
            </div>

            <div style="text-align: center; margin: 35px 0 20px 0;">
              <a href="http://localhost:3000/formations?courseId=${rule_id}" style="background-color: #8b5cf6; color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: bold; border-radius: 6px; font-size: 16px; display: inline-block;">                
                Accéder au Portail LMS
              </a>
            </div>

            <p style="color: #94a3b8; font-size: 12px; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 15px; margin-top: 30px;">
              Ce lien et cet identifiant sont strictement personnels. Ne les partagez pas.<br>
              La complétion de ce module est obligatoire.
            </p>
          </div>
        </div>
      `;

      return transporter.sendMail({
        from: '"SOC Formation Continue" <zed.legacy.02@gmail.com>',
        to: emp.email,
        subject: `Action Requise : Module de sécurité - ${formation_data.titre_cours}`,
        html: emailHtml
      });
    });

    // On attend que tous les emails individuels soient envoyés
    await Promise.all(emailPromises);

    console.log(`[+] Tous les emails ont été envoyés avec succès !`);
    res.json({ message: "Campagne personnalisée diffusée avec succès !", count: destinataires.length });

  } catch (error) {
    console.error("[-] Erreur critique dans la diffusion de la formation :", error);
    res.status(500).json({ error: "Erreur serveur interne." });
  }
});


// ========================================================
// ROUTE : VÉRIFICATION DE L'ID EMPLOYÉ (LOGIN LMS)
// ========================================================
app.post('/api/employes/verify', (req, res) => {
  const { id_employe } = req.body;

  if (!id_employe) {
    return res.status(400).json({ success: false, error: "Identifiant requis." });
  }

  const fs = require('fs');
  const path = require('path');

  try {
    const annuaire = JSON.parse(fs.readFileSync(path.join(__dirname, 'employes.json'), 'utf8'));
    let employeTrouve = null;

    // Parcours de tous les départements pour trouver l'ID
    Object.values(annuaire).forEach(departementList => {
      const found = departementList.find(emp => emp.id_employe === id_employe);
      if (found) employeTrouve = found;
    });

    if (employeTrouve) {
      res.json({ success: true, employe: employeTrouve });
    } else {
      res.status(401).json({ success: false, error: "Identifiant introuvable ou invalide." });
    }
  } catch (err) {
    console.error("Erreur de lecture annuaire :", err);
    res.status(500).json({ success: false, error: "Erreur serveur interne." });
  }
});

// ========================================================
// ROUTES : SUIVI DES RÉSULTATS DE FORMATION
// ========================================================

// A. L'employé soumet son score (Pas besoin de token ici, l'employé est dans son sas)
app.post('/api/formations/submit', async (req, res) => {
  try {
    const { courseId, courseTitle, employeeId, employeeName, department, score } = req.body;
    
    // findOneAndUpdate avec upsert : Si l'employé refait le test, on garde son dernier score
    const record = await FormationRecord.findOneAndUpdate(
      { courseId, employeeId },
      { courseTitle, employeeName, department, score, completedAt: Date.now() },
      { upsert: true, new: true }
    );
    
    console.log(`[🎓 LMS] Résultat enregistré : ${employeeName} a obtenu ${score}% au module "${courseTitle.substring(0, 20)}..."`);
    res.json({ success: true, record });
  } catch (error) {
    console.error("[-] Erreur lors de l'enregistrement du score :", error);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// B. L'administrateur consulte les scores (Protégé par le vigile)
app.get('/api/formations/records', verifySOCAdmin, async (req, res) => {
  try {
    // On récupère tous les records du plus récent au plus ancien
    const records = await FormationRecord.find().sort({ completedAt: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: "Erreur de lecture des résultats." });
  }
});

// ========================================================
// ROUTE : DAILY BRIEFING (Rapport de relève pour l'Admin)
// ========================================================
app.post('/api/briefing', verifySOCAdmin, async (req, res) => {
  try {
    const { last_logout } = req.body;
    
    // Si pas de date de déconnexion (première fois), on recule de 12 heures par défaut
    const sinceDate = last_logout ? new Date(last_logout) : new Date(Date.now() - 12 * 60 * 60 * 1000);

    // 1. Récupération des incidents SOAR survenus pendant l'absence
    const incidents = await SoarCase.find({ timestamp: { $gte: sinceDate } }).sort({ timestamp: -1 });
    
    // On isole ceux que l'Auto-Pilote (Mode Nuit) a gérés tout seul
    const autoBlocked = incidents.filter(inc => 
      inc.caseStatus.includes('Nuit') || 
      inc.caseStatus.includes('Auto-Pilote') || 
      inc.caseStatus.includes('bloqué')
    );
    const criticalAlerts = incidents.filter(inc => inc.aiConfidenceScore >= 80);

    // 2. Récupération des actualités CTI / Formations générées
    const ctiNews = await CtiActuality.find({ date_publication: { $gte: sinceDate } });
    const formationsGenerated = ctiNews.filter(cti => cti.status === 'FORMATION_GENERATED');

    // 3. Construction de la réponse agrégée
    res.json({
      success: true,
      since: sinceDate,
      summary: {
        total_incidents: incidents.length,
        auto_blocked: autoBlocked.length,
        critical_alerts: criticalAlerts.length,
        new_cti: ctiNews.length,
        new_formations: formationsGenerated.length
      },
      // On renvoie les 3 incidents les plus récents pour un aperçu rapide
      recent_incidents: incidents.slice(0, 3) 
    });

    console.log(`[+] Briefing généré pour la période depuis : ${sinceDate.toISOString()}`);
  } catch (error) {
    console.error("[-] Erreur lors de la génération du Briefing :", error);
    res.status(500).json({ error: "Erreur serveur lors de la compilation du rapport." });
  }
});




// ========================================================
// TESTTTTT
// ========================================================
// Route de simulation d'attaque (À utiliser pour la soutenance/démo)
app.get('/api/simulate-attack', (req, res) => {
  const mockIncident = {
    _id: "SIM-" + Math.random().toString(36).substring(2, 9),
    maliciousIp: "185.15.59.224",
    sourceSensor: "Suricata-IDS (Simulation)",
    threatType: "Ransomware C2 Beaconing",
    severity: "Critique",
    caseStatus: "Ouvert",
    timestamp: new Date().toISOString(),
    aiConfidenceScore: 99,
    diagnostic_json: {
      titre_incident: "Test d'Injection - Ransomware",
      resume_executif: "Ceci est un test système du pipeline d'alerte global SOC.",
      niveau_severite: "Critique",
      score_confiance: 99,
      mitre_attack_technique: "T1071.001 (Web Protocols)",
      analyse_technique: "Payload injecté manuellement pour vérifier le routage WebSocket, l'API Web Audio et les modales React.",
      recommandations_actions: [
        "Vérifier le rendu de la modale globale", 
        "Valider le déclenchement du bip sonore", 
        "Vérifier le routage email de secours si hors ligne"
      ]
    }
  };

  // On émet l'événement exactement comme si l'IA venait de parser une vraie attaque
  io.emit("soar_incident_incoming", mockIncident);

  res.json({ success: true, message: "Missile de test envoyé avec succès vers le frontend !" });
});

// ========================================================
// 8. WATCHDOG BACKEND
// ========================================================
setInterval(async () => {
  try {
    const fifteenSecondsAgo = new Date(Date.now() - 15000);
    const deadNodes = await VmNode.find({
      nodeStatus: 'Online',
      lastHeartbeat: { $lt: fifteenSecondsAgo }
    });

    if (deadNodes.length > 0) {
      for (let node of deadNodes) {
        console.log(`[!] Watchdog Backend: ${node.hostname} déclaré Hors Ligne (Timeout).`);
        const updatedNode = await VmNode.findOneAndUpdate(
          { _id: node._id },
          {
            nodeStatus: 'Hors Ligne',
            cpuUsage: 0,
            ramUsage: 0,
            services: node.services.map(s => ({ ...s, active: false }))
          },
          { returnDocument: 'after' }
        );
        io.emit('dashboard_update', updatedNode);
      }
    }
  } catch (error) {
    console.error("[-] Erreur Watchdog Backend :", error);
  }
}, 15000);

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`[+] SOC WebSocket Hub opérationnel sur le port ${PORT}`);
  console.log(`=================================================`);
});