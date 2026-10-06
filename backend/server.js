const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { Kafka } = require('kafkajs');
const jwt = require('jsonwebtoken');


const { GoogleGenAI } = require('@google/genai');
const { Mistral } = require('@mistralai/mistralai');

require('dotenv').config();



// Initialisation du client Gemini avec la nouvelle librairie unifiée
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Mistral =  fallback cloud
const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

// Ollama / Llama 3.2 = dernier fallback local
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

// JWT = jeton de sécurité pour les sessions utilisateur
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
  type_article: { type: String, default: "TECHNICAL_THREAT" },
  iocs_extraits: Array,
  regles_suricata: String,
  fiabilite_score: Number,
  status: { type: String, default: "PENDING" },
  error_log: { type: String, default: null },
  formation_data: { type: Object, default: null },
  cible_diffusion_type: { type: String, default: null },
  cible_diffusion_value: { type: String, default: null },
  date_diffusion: { type: Date, default: null },
  last_updated: { type: Date, default: Date.now },
  date_publication: { type: Date, default: Date.now }
});
const CtiActuality = mongoose.model('CtiActuality', CtiActualitySchema);

// ============================================================
// SERVICE CTI À LA DEMANDE (agent_cti_runner.py sur VM-Response)
// ============================================================
const CtiRunLogSchema = new mongoose.Schema({
  key: { type: String, default: 'last', unique: true },
  status: String,
  startedAt: Date,
  finishedAt: Date,
  exitCode: Number,
  lines: [String],
});
const CtiRunLog = mongoose.model('CtiRunLog', CtiRunLogSchema);

const MAX_CTI_LOG_LINES = 3000;
let ctiRunnerSocketId = null;
let ctiRun = { status: 'IDLE', startedAt: null, finishedAt: null, exitCode: null, lines: [] };

const ctiRunPublic = () => ({
  status: ctiRun.status,
  startedAt: ctiRun.startedAt,
  finishedAt: ctiRun.finishedAt,
  exitCode: ctiRun.exitCode,
  lineCount: ctiRun.lines.length,
});

async function finishCtiRun(status, exitCode) {
  ctiRun.status = status;
  ctiRun.exitCode = exitCode;
  ctiRun.finishedAt = new Date();
  io.emit('cti_run_status', ctiRunPublic());
  try {
    await CtiRunLog.findOneAndUpdate({ key: 'last' }, { key: 'last', ...ctiRun }, { upsert: true });
  } catch (e) {
    console.error("[-] Sauvegarde du journal CTI impossible :", e);
  }
}


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

    // --- Service CTI à la demande ---
    socket.on('cti_runner_register', () => {
      ctiRunnerSocketId = socket.id;
      console.log(`[+] Service CTI enregistré (VM-Response). ID: ${socket.id}`);
    });
  
    socket.on('cti_runner_line', (data) => {
      if (socket.id !== ctiRunnerSocketId || ctiRun.status !== 'RUNNING') return;
      const line = String((data && data.line) || '').slice(0, 2000);
      if (ctiRun.lines.length < MAX_CTI_LOG_LINES) ctiRun.lines.push(line);
      io.emit('cti_log_line', { line });
    });
  
    socket.on('cti_runner_done', async (data) => {
      if (socket.id !== ctiRunnerSocketId || ctiRun.status !== 'RUNNING') return;
      const exitCode = data && typeof data.exitCode === 'number' ? data.exitCode : -1;
      await finishCtiRun(exitCode === 0 ? 'SUCCESS' : 'FAILED', exitCode);
    });
  
    socket.on('disconnect', async () => {
      if (socket.id === ctiRunnerSocketId) {
        ctiRunnerSocketId = null;
        if (ctiRun.status === 'RUNNING') {
          ctiRun.lines.push("[!] Service CTI déconnecté pendant l'exécution.");
          await finishCtiRun('FAILED', -1);
        }
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

app.post('/api/cti/run', verifySOCAdmin, (req, res) => {
  if (!ctiRunnerSocketId) {
    return res.status(503).json({ error: "Service CTI hors ligne : agent_cti_runner.py n'est pas connecté sur VM-Response." });
  }
  if (ctiRun.status === 'RUNNING') {
    return res.status(409).json({ error: "Une exécution est déjà en cours." });
  }
  ctiRun = { status: 'RUNNING', startedAt: new Date(), finishedAt: null, exitCode: null, lines: [] };
  io.to(ctiRunnerSocketId).emit('cti_runner_start');
  io.emit('cti_run_status', ctiRunPublic());
  res.json({ success: true });
});

app.get('/api/cti/last-run', verifySOCAdmin, async (req, res) => {
  try {
    if (ctiRun.status === 'IDLE') {
      const last = await CtiRunLog.findOne({ key: 'last' }).lean();
      if (last) {
        ctiRun = { status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, exitCode: last.exitCode, lines: last.lines || [] };
      }
    }
    res.json({ ...ctiRunPublic(), lines: ctiRun.lines });
  } catch (e) {
    res.status(500).json({ error: "Lecture du journal impossible." });
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



// ========================================================
// Génération des formations (Micro-Learning) — Chaîne de résilience IA
// Ordre : Gemini (cloud, primaire) -> Mistral (cloud, secours) -> Llama3.2 via Ollama (local, dernier recours)
// Rationale : un échec de capacité chez un fournisseur cloud (503 "model overloaded", 429 quota)
// ne doit jamais bloquer la génération. Ollama reste le dernier recours car il partage le GPU
// avec agent_ia.py / agent_cti.py : cette route ne doit jamais être prioritaire sur une réponse
// d'incident en cours, elle attend simplement son tour sur la même instance déjà chargée en VRAM.
// ========================================================

// Prompt commun aux 3 fournisseurs — le schéma JSON attendu est strictement identique partout
function buildFormationPrompt(titre_menace, resume_ia, source_texte) {
  return `
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
      4. Ne renvoie AUCUNE balise markdown (pas de \`\`\`json), AUCUN texte avant ou après l'objet JSON.
    `;
}

// Répare les erreurs JSON les plus fréquentes chez les petits modèles (Ministral-8B,
// Llama3.2:3b) : des retours à la ligne bruts (non échappés) laissés A L'INTERIEUR d'une
// valeur de chaîne (typiquement dans les champs "contenu" rédigés sur plusieurs paragraphes),
// et des virgules finales avant une accolade/crochet fermant. On ne touche qu'aux caractères
// réellement situés entre guillemets (suivi d'état inString/escape), jamais à la structure JSON.
function repairJSONText(str) {
  let out = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escapeNext) {
      out += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch === '\n') { out += '\\n'; continue; }
    if (inString && ch === '\r') { out += '\\r'; continue; }
    if (inString && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, '$1'); // virgules finales avant } ou ]
}

// Extrait un objet JSON d'une chaîne, même si le modèle a entouré la réponse de
// texte parasite ou de balises markdown (fréquent avec les petits modèles locaux type Llama3.2:3b)
function extractFormationJSON(rawText) {
  if (!rawText) throw new Error("Réponse vide du modèle.");
  let cleaned = rawText.trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Aucun objet JSON détecté dans la réponse du modèle.");
  }
  const jsonSlice = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonSlice);
  } catch (firstErr) {
    // Tentative de réparation avant d'abandonner (newlines bruts dans les chaînes, virgules finales)
    try {
      const repaired = repairJSONText(jsonSlice);
      const parsed = JSON.parse(repaired);
      console.warn(`[!] JSON réparé automatiquement (erreur initiale : ${firstErr.message})`);
      return parsed;
    } catch (secondErr) {
      throw new Error(`JSON invalide même après tentative de réparation : ${firstErr.message}`);
    }
  }
}

// Valide que le JSON généré respecte le schéma métier attendu par le frontend.
// Une réponse malformée (fréquent avec Llama3.2:3b qui respecte moins bien le JSON strict
// que Gemini/Mistral) déclenche elle aussi la bascule vers le fournisseur suivant.
function validateFormationSchema(obj) {
  if (!obj || typeof obj !== 'object') throw new Error("Structure JSON invalide.");
  if (!obj.titre_cours || typeof obj.titre_cours !== 'string') throw new Error("Champ 'titre_cours' manquant ou invalide.");
  if (!obj.diagramme_mermaid || typeof obj.diagramme_mermaid !== 'string') throw new Error("Champ 'diagramme_mermaid' manquant ou invalide.");
  if (!Array.isArray(obj.modules) || obj.modules.length === 0) throw new Error("Champ 'modules' manquant ou vide.");
  for (const m of obj.modules) {
    if (!m || !m.chapitre || !m.contenu) throw new Error("Un module est incomplet (chapitre/contenu).");
  }
  if (!Array.isArray(obj.quiz) || obj.quiz.length < 5 || obj.quiz.length > 7) throw new Error("Le quiz doit contenir entre 5 et 7 questions.");
  for (const q of obj.quiz) {
    if (!q || !q.question || !Array.isArray(q.options) || q.options.length !== 4) throw new Error("Une question du quiz est mal formée.");
    if (!Number.isInteger(q.reponse_correcte) || q.reponse_correcte < 0 || q.reponse_correcte > 3) throw new Error("Index 'reponse_correcte' invalide dans le quiz.");
  }
  return true;
}

const _formationSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Tier 1 : Gemini (cloud, primaire) ---
// Chaîne de repli interne entre 2 modèles Gemini + backoff court sur erreurs transitoires
// (503 "model overloaded", 429 quota) avant de basculer vers Mistral.
async function generateFormationWithGemini(prompt) {
  const GEMINI_FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  let lastError;
  for (const model of GEMINI_FALLBACK_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: "application/json", temperature: 0.5 }
        });
        const parsed = extractFormationJSON(response.text);
        validateFormationSchema(parsed);
        console.log(`[+] Formation générée via Gemini (${model}, tentative ${attempt})`);
        return { data: parsed, provider: `gemini:${model}` };
      } catch (err) {
        lastError = err;
        const transient = /503|429|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(err.message || '');
        const modelGone = /404|NOT_FOUND|no longer available|not found for API version/i.test(err.message || '');
        console.warn(`[!] Gemini (${model}, tentative ${attempt}) échec : ${err.message}`);
        if (modelGone) break; // ce modèle n'existe plus / plus disponible -> inutile de réessayer, on passe au suivant
        if (!transient) break; // erreur non transitoire (clé invalide, prompt rejeté...) -> inutile de réessayer ce modèle
        if (attempt < 2) await _formationSleep(800 * attempt);
      }
    }
  }
  throw lastError || new Error("Échec Gemini inconnu.");
}

// --- Tier 2 : Mistral (cloud, secours) ---
// IMPORTANT : on pin des noms de modèles explicites et versionnés (mistral-small-2603,
// ministral-8b-2512) plutôt que l'alias 'mistral-small-latest', qui ne correspond à aucun
// modèle réellement provisionné sur le compte (absent de la page Admin Console -> Limits) et
// provoquait un 429 trompeur plutôt qu'une erreur claire de modèle introuvable.
// ministral-8b-2512 sert de repli interne : quota plus large (625K TPM / 3.13 req/s contre
// 20K TPM / 1 req/s pour mistral-small-2603) et modèle distinct -> bucket de quota séparé.
async function generateFormationWithMistral(prompt) {
  // Un seul essai par modèle : un 429 Mistral en environnement "Experiment" est un throttle
  // au niveau de l'organisation (bucket partagé entre modèles), donc réessayer LE MÊME modèle
  // retape sur le même bucket. Mieux vaut basculer immédiatement vers un modèle différent,
  // dont le quota (TPM/req-s) est distinct -> bascule plus rapide, moins d'appels gaspillés.
  const MISTRAL_FALLBACK_MODELS = ['mistral-small-2603', 'ministral-8b-2512'];
  let lastError;
  for (const model of MISTRAL_FALLBACK_MODELS) {
    try {
      const response = await mistral.chat.complete({
        model,
        messages: [{ role: 'user', content: prompt }],
        responseFormat: { type: 'json_object' },
        temperature: 0.5
      });
      const rawText = response?.choices?.[0]?.message?.content;
      const parsed = extractFormationJSON(rawText);
      validateFormationSchema(parsed);
      console.log(`[+] Formation générée via Mistral (${model})`);
      return { data: parsed, provider: `mistral:${model}` };
    } catch (err) {
      lastError = err;
      console.warn(`[!] Mistral (${model}) échec : ${err.message}`);
      // Quelle que soit la cause (429 partagé, modèle non provisionné, JSON invalide...),
      // on passe directement au modèle suivant de la chaîne plutôt que de réessayer celui-ci.
    }
  }
  throw lastError || new Error("Échec Mistral inconnu.");
}

// --- Tier 3 : Ollama / Llama3.2 (local, dernier recours) ---
// Garantit l'autonomie 24/7 du système même si les 2 fournisseurs cloud sont injoignables.
// Utilise l'instance Ollama déjà chargée en VRAM pour agent_ia.py / agent_cti.py (aucun coût GPU
// supplémentaire) ; requiert Node.js 18+ pour l'API fetch native.
async function generateFormationWithOllama(prompt) {
  const OLLAMA_TIMEOUT_MS = 60000; // les petits modèles locaux peuvent être lents sur un 4GB VRAM
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        format: 'json',
        stream: false,
        options: { temperature: 0.4 }
      }),
      signal: controller.signal
    });
  } catch (networkErr) {
    // "fetch failed" = la connexion elle-même a échoué (Ollama non démarré, mauvais OLLAMA_URL,
    // port bloqué, ou timeout) — ce n'est PAS une erreur HTTP, donc res n'existe pas ici.
    if (networkErr.name === 'AbortError') {
      throw new Error(`Ollama injoignable : délai de ${OLLAMA_TIMEOUT_MS}ms dépassé sur ${OLLAMA_URL} (le modèle ${OLLAMA_MODEL} met-il trop de temps à répondre ?).`);
    }
    throw new Error(`Ollama injoignable à ${OLLAMA_URL} — vérifier que le service Ollama est démarré ('ollama serve'), que le modèle '${OLLAMA_MODEL}' est bien présent ('ollama list'), et que OLLAMA_URL pointe vers la bonne machine/port. Détail : ${networkErr.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status} : ${await res.text()}`);
  }
  const body = await res.json();
  const parsed = extractFormationJSON(body.response);
  validateFormationSchema(parsed);
  console.log(`[+] Formation générée via Ollama local (${OLLAMA_MODEL})`);
  return { data: parsed, provider: `ollama:${OLLAMA_MODEL}` };
}

// Route pour générer le module de formation (Micro-Learning)
// Chaîne de résilience : Gemini (cloud) -> Mistral (cloud) -> Llama3.2 via Ollama (local)
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

    const prompt = buildFormationPrompt(titre_menace, resume_ia, source_texte);

    let result;
    const providersTried = [];

    try {
      result = await generateFormationWithGemini(prompt);
    } catch (errGemini) {
      providersTried.push(`gemini(échec: ${errGemini.message})`);
      console.warn('[!] Bascule vers Mistral après échec Gemini.');
      try {
        result = await generateFormationWithMistral(prompt);
      } catch (errMistral) {
        providersTried.push(`mistral(échec: ${errMistral.message})`);
        console.warn('[!] Bascule vers Llama3.2 local (Ollama) après échec Mistral.');
        try {
          result = await generateFormationWithOllama(prompt);
        } catch (errOllama) {
          providersTried.push(`ollama(échec: ${errOllama.message})`);
          console.error('[-] Échec des 3 fournisseurs IA pour la génération de formation.', providersTried);
          return res.status(503).json({
            error: "Échec de la génération de la formation : Gemini, Mistral et Llama3.2 local sont tous indisponibles.",
            details: providersTried
          });
        }
      }
    }

    const formationJSON = result.data;
    // Traçabilité : conserve le fournisseur qui a effectivement généré le contenu (utile pour le rapport/soutenance)
    formationJSON._meta_provider = result.provider;

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

    console.log(`[+] Formation générée (${result.provider}) et enregistrée avec succès pour l'ID: ${rule_id}`);

    // Notification temps réel (même mécanisme Socket.io que soar_incident_incoming / dashboard_update)
    // pour alerter le RSSI dans le centre de notifications dès qu'une formation est prête, et
    // signaler si une bascule (fallback) IA a eu lieu pendant la génération.
    io.emit('formation_generated', {
      rule_id,
      titre_menace,
      titre_cours: formationJSON.titre_cours,
      provider: result.provider,
      isFallback: !result.provider.startsWith('gemini:'),
      generated_at: Date.now()
    });

    res.json({
      message: "Formation générée avec succès !",
      formation: formationJSON
    });

  } catch (error) {
    console.error("[-] Erreur inattendue lors de la génération de la formation :", error);
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
app.post('/api/formations/distribute', verifySOCAdmin, async (req, res) => {
  try {
    const { rule_id, formation_data, targetType, targetValue } = req.body;

    if (!rule_id || !formation_data) {
      return res.status(400).json({ error: "Les données de la formation sont requises." });
    }

    const fs = require('fs');
    const path = require('path');
    const annuaire = JSON.parse(fs.readFileSync(path.join(__dirname, 'employes.json'), 'utf8'));

    let destinataires = [];

    if (targetType === "DEPARTEMENT" && targetValue && annuaire[targetValue]) {
      destinataires = annuaire[targetValue];
    } else {
      Object.values(annuaire).forEach(departementList => {
        destinataires.push(...departementList);
      });
    }

    // NOUVEAU : persiste la cible réelle de cette campagne -- condition
    // sine qua non pour que la vérification d'éligibilité fonctionne.
    await CtiActuality.findByIdAndUpdate(rule_id, {
      cible_diffusion_type: targetType === "DEPARTEMENT" ? "DEPARTEMENT" : "ALL",
      cible_diffusion_value: targetType === "DEPARTEMENT" ? targetValue : null,
      date_diffusion: new Date(),
    });

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
app.post('/api/employes/verify', async (req, res) => {
  const { id_employe, courseId } = req.body;

  if (!id_employe) {
    return res.status(400).json({ success: false, error: "Identifiant requis." });
  }
  if (!courseId) {
    return res.status(400).json({ success: false, error: "Identifiant de cours requis." });
  }

  const fs = require('fs');
  const path = require('path');

  try {
    // 1. Récupérer la campagne de diffusion de CE cours précis
    const campagne = await CtiActuality.findById(courseId);
    if (!campagne || !campagne.cible_diffusion_type) {
      return res.status(404).json({ success: false, error: "Ce cours n'a pas encore été diffusé." });
    }

    // 2. Retrouver l'employé ET son département réel
    const annuaire = JSON.parse(fs.readFileSync(path.join(__dirname, 'employes.json'), 'utf8'));
    let employeTrouve = null;
    let departementTrouve = null;

    Object.entries(annuaire).forEach(([departement, liste]) => {
      const found = liste.find(emp => emp.id_employe === id_employe);
      if (found) {
        employeTrouve = found;
        departementTrouve = departement;
      }
    });

    if (!employeTrouve) {
      return res.status(401).json({ success: false, error: "Identifiant introuvable ou invalide." });
    }

    // 3. VÉRIFICATION D'ÉLIGIBILITÉ -- le vrai correctif de sécurité
    const estEligible =
      campagne.cible_diffusion_type === "ALL" ||
      (campagne.cible_diffusion_type === "DEPARTEMENT" && campagne.cible_diffusion_value === departementTrouve);

    if (!estEligible) {
      return res.status(403).json({
        success: false,
        error: "Identifiant valide, mais vous n'êtes pas éligible à ce module de formation."
      });
    }

    res.json({ success: true, employe: { ...employeTrouve, departement: departementTrouve } });
    
  } catch (err) {
    console.error("Erreur de vérification d'éligibilité :", err);
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