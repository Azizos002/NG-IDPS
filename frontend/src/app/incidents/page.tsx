"use client";

import { useState, useEffect } from "react";
import { ShieldAlert, AlertTriangle, CheckCircle, Crosshair, BrainCircuit, ShieldBan, ExternalLink, Unlock, FileText, Filter, Activity } from "lucide-react";
import { io } from "socket.io-client";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

// ==========================================
// 1. Interfaces TypeScript
// ==========================================
interface DiagnosticJSON {
  titre_incident?: string;
  resume_executif?: string;
  niveau_severite?: string;
  score_confiance?: number;
  mitre_attack_technique?: string;
  analyse_technique?: string;
  recommandations_actions?: string[];
}

interface AlertData {
  id: string;
  kibanaUrl: string;
  sourceSensor: string;
  maliciousIp: string;
  threatType: string;
  severity: string;
  aiSummary?: string;
  diagnostic_json?: DiagnosticJSON;
  aiConfidenceScore?: number;
  caseStatus: string;
  timestamp: string;
}

// Fonction utilitaire pour simuler un GeoIP Rapide sur le front-end
const getIpBadge = (ip: string) => {
  if (ip.startsWith("192.168.56") || ip.startsWith("10.") || ip.startsWith("127.")) return "🏢 Interne (LAN)";
  if (ip.startsWith("192.168")) return "🏢 External Interne (LAN)";
  if (ip === "95.163.255.1") return "🇷🇺 RU";
  if (ip === "23.22.21.20") return "🇺🇸 US";
  return "🌐 Externe";
};

// ==========================================
// 2. Composant de Parsing du Rapport IA (Mode JSON)
// ==========================================
const AiReportFormatter = ({ data, fallbackText }: { data?: DiagnosticJSON, fallbackText?: string }) => {
  if (!data && !fallbackText) {
    return (
      <div className="flex items-center gap-3 text-slate-400 italic text-sm p-4 bg-slate-900/50 rounded-lg border border-slate-800">
        <BrainCircuit className="animate-pulse" size={18} />
        En attente de l'analyse sémantique Llama 3...
      </div>
    );
  }

  // Fallback si l'ancien format texte est détecté
  if (!data || !data.titre_incident) {
    return <div className="text-slate-300 leading-relaxed text-sm whitespace-pre-line bg-slate-900/40 p-4 rounded-lg border border-slate-800">{fallbackText}</div>;
  }

  const getSeverityColor = (sev: string = "") => {
    const lower = sev.toLowerCase();
    if (lower.includes("critique") || lower.includes("haut") || lower.includes("élevé")) return "text-red-400 bg-red-500/10 border-red-500/40";
    if (lower.includes("moyen") || lower.includes("modéré")) return "text-orange-400 bg-orange-500/10 border-orange-500/40";
    return "text-yellow-400 bg-yellow-500/10 border-yellow-500/40";
  };

  return (
    <div className="space-y-4 mt-2">
      {/* Ligne 1 : Titre et Badges Techniques */}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <span className="text-sm font-bold text-white bg-slate-800 px-3 py-1.5 rounded-md border border-slate-700 shadow-sm">
          🎯 {data.titre_incident}
        </span>
        <span className={`text-xs font-bold px-3 py-1.5 rounded-md border shadow-sm flex items-center gap-2 ${getSeverityColor(data.niveau_severite)}`}>
          🚨 Sévérité IA : {data.niveau_severite}
        </span>
        {data.mitre_attack_technique && data.mitre_attack_technique !== "N/A" && (
          <span className="text-xs font-mono font-semibold text-slate-300 bg-slate-800 px-3 py-1.5 rounded-md border border-slate-600 flex items-center gap-2">
            🛡️ MITRE : {data.mitre_attack_technique}
          </span>
        )}
      </div>

      {/* Ligne 2 : Résumé et Analyse (Mode Split) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900/60 p-4 rounded-lg border-l-2 border-cyan-500 shadow-inner">
          <span className="text-cyan-400 text-[10px] font-bold uppercase tracking-widest block mb-2">Résumé Exécutif</span>
          <p className="text-slate-300 text-sm leading-relaxed">{data.resume_executif}</p>
        </div>

        <div className="bg-slate-900/60 p-4 rounded-lg border-l-2 border-purple-500 shadow-inner">
          <span className="text-purple-400 text-[10px] font-bold uppercase tracking-widest block mb-2">Analyse Technique</span>
          <p className="text-slate-300 text-sm leading-relaxed">{data.analyse_technique}</p>
        </div>
      </div>

      {/* Ligne 3 : Checklist Interactive de Remédiation */}
      {data.recommandations_actions && data.recommandations_actions.length > 0 && (
        <div className="bg-cyan-950/20 border border-cyan-900/50 p-4 rounded-lg mt-4">
          <span className="font-bold text-cyan-500 text-[10px] uppercase tracking-widest block mb-3 flex items-center gap-2">
            <Activity size={14} />
            Playbook de Remédiation Suggéré
          </span>
          <div className="space-y-2.5">
            {data.recommandations_actions.map((rec, idx) => (
              <label key={idx} className="flex items-start gap-3 cursor-pointer group p-2 hover:bg-slate-900/50 rounded transition-colors">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-cyan-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/50 cursor-pointer accent-cyan-500"
                />
                <span className="text-cyan-100/70 text-sm group-hover:text-cyan-100 transition-colors leading-tight">{rec}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 3. Page Principale des Incidents
// ==========================================
export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<AlertData[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"OPEN" | "RESOLVED" | "ALL">("OPEN");

  const [exportingId, setExportingId] = useState<string | null>(null);


  // Générateur de Rapport PDF Exécutif (God's Level - Sandboxing via Iframe)
  const generatePDF = async (incident: AlertData) => {
    setExportingId(incident.id);
    try {
      const diag = incident.diagnostic_json;
      const title = diag?.titre_incident || incident.threatType;
      const summary = diag?.resume_executif || incident.aiSummary || "Analyse non disponible.";
      const technicalAnalysis = diag?.analyse_technique || "Aucune analyse technique avancée n'est requise pour cet incident.";
      const mitigation = diag?.recommandations_actions ? diag.recommandations_actions.map(r => `<li>${r}</li>`).join('') : "<li>Aucune recommandation spécifique.</li>";
      const mitre = diag?.mitre_attack_technique && diag.mitre_attack_technique !== "N/A" ? diag.mitre_attack_technique : "Non classifié";
      const confidence = diag?.score_confiance || incident.aiConfidenceScore || "N/A";
      const rawLogsUrl = incident.kibanaUrl || "http://192.168.56.130:5601/app/dashboards#/view/2bfeba8b-1699-4c22-8a2a-4eb9835c8628?_g=(filters:!(),refreshInterval:(pause:!t,value:60000),time:(from:now-15m,to:now))";

      // 1. Création du Sas d'Isolement (Iframe agrandie pour le contenu extra)
      const iframe = document.createElement("iframe");
      iframe.style.position = "absolute";
      iframe.style.width = "800px";
      iframe.style.height = "1600px";
      iframe.style.left = "-9999px";
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow?.document;
      if (!iframeDoc) throw new Error("Iframe impossible à créer");

      // 2. Injection du code avec CSS étendu
      iframeDoc.open();
      iframeDoc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { padding: 50px; background-color: #ffffff; color: #0f172a; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; }
          .header { border-bottom: 3px solid #ef4444; padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: flex-end; }
          .header h1 { color: #ef4444; font-size: 26px; margin: 0; font-weight: 900; letter-spacing: 1px; }
          .header p { color: #64748b; font-size: 13px; margin: 5px 0 0 0; }
          .header-right { text-align: right; color: #64748b; font-size: 12px; }
          
          .box-primary { margin-bottom: 25px; padding: 15px; background-color: #f8fafc; border-left: 4px solid #3b82f6; border-radius: 4px; }
          .box-primary h2 { margin: 0 0 10px 0; font-size: 16px; color: #0f172a; }
          
          .grid-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px;}
          .grid-table th { background-color: #f1f5f9; padding: 8px; text-align: left; color: #475569; border: 1px solid #e2e8f0; width: 25%; }
          .grid-table td { padding: 8px; border: 1px solid #e2e8f0; color: #0f172a; }

          .section-title { color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; margin-top: 25px; font-size: 16px; font-weight: bold; }
          p, ul { font-size: 13px; line-height: 1.6; color: #334155; }
          
          .technical-box { background-color: #1e293b; color: #e2e8f0; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 12px; margin-top: 15px; }
          .technical-box strong { color: #38bdf8; }

          .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>RAPPORT D'INCIDENT CYBER</h1>
            <p>SOC Intelligence Artificielle - Génération Automatique</p>
          </div>
          <div class="header-right">
            <strong>ID Incident :</strong> ${incident.id}<br/>
            <strong>Horodatage :</strong> ${incident.timestamp}
          </div>
        </div>

        <div class="box-primary">
          <h2>Alerte Détectée : ${title}</h2>
        </div>

        <table class="grid-table">
          <tr>
            <th>IP Hostile</th><td>${incident.maliciousIp}</td>
            <th>Capteur Source</th><td>${incident.sourceSensor}</td>
          </tr>
          <tr>
            <th>Sévérité Estimée</th>
            <td>
              <strong className="text-red-400">
                ${incident.diagnostic_json?.niveau_severite}
              </strong>
            </td>
            <th>Statut SOAR</th>
            <td>${incident.caseStatus}</td>
          </tr>
          <tr>
            <th>Tactique MITRE</th><td>${mitre}</td>
            <th>Score Confiance IA</th><td>${confidence}%</td>
          </tr>
        </table>

        <div class="section-title">1. Synthèse Exécutive</div>
        <p>${summary}</p>

        <div class="section-title">2. Analyse Technique Structurée</div>
        <p class="technical-box">
          <strong>[PROCESS_DUMP]</strong> > Analyse du comportement et vecteurs de compromission :<br/><br/>
          ${technicalAnalysis}
        </p>

        <div class="section-title">3. Playbook de Remédiation (Zero Trust)</div>
        <ul>${mitigation}</ul>

        <div class="section-title">4. Piste d'Audit & Conformité</div>
        <p>
          <strong>Corrélation SIEM (Logs Bruts) :</strong> Les logs complets de cet incident sont archivés sur le cluster Elastic. Cliquez sur le lien interactif ci-dessous pour y accéder en toute sécurité.<br/>
          <span style="color: #3b82f6; font-size: 12px; word-break: break-all;">${rawLogsUrl}</span>
        </p>
        
        <!-- Espace réservé pour que le lien cliquable natif ne chevauche pas le footer -->
        <div style="height: 35px;"></div>

        <div class="footer">
          Ce document est la propriété exclusive du Centre d'Opérations de Sécurité. La diffusion externe est strictement interdite sans l'autorisation préalable de la direction informatique.<br/>
          Généré par le sous-système d'Intelligence Artificielle Autonome.
        </div>
      </body>
    </html>
  `);
      iframeDoc.close();

      await new Promise(resolve => setTimeout(resolve, 300));

      const canvas = await html2canvas(iframeDoc.body, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff"
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);

      // =========================================================
      // INJECTION DU LIEN NATIF CLIQUABLE PAR-DESSUS LE PDF
      // =========================================================
      pdf.setFontSize(10);
      pdf.setTextColor(59, 130, 246); // Bleu (#3b82f6)

      const linkText = "Ouvrir les logs bruts dans Kibana";
      const textWidth = pdf.getTextWidth(linkText);
      const xPos = 14; // Aligné à la marge de gauche (14mm)

      // Position verticale dynamique juste au-dessus du footer
      const yPos = pdfHeight - 25;

      // Création du lien interactif cliquable
      pdf.textWithLink(linkText, xPos, yPos, { url: rawLogsUrl });

      // Soulignement du lien pour indiquer l'interactivité visuelle
      pdf.setDrawColor(59, 130, 246);
      pdf.setLineWidth(0.3);
      pdf.line(xPos, yPos + 1, xPos + textWidth, yPos + 1);

      pdf.save(`Audit_SOC_${incident.id}.pdf`);

      document.body.removeChild(iframe);
    } catch (error) {
      console.error("[-] Erreur lors de l'export PDF :", error);
      alert("Erreur inattendue lors de la création du document.");
    } finally {
      setExportingId(null);
    }
  };

  useEffect(() => {
    const currentHost = window.location.hostname;
    const backendUrl = `http://${currentHost}:4000`;

    const fetchHistory = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/incidents`);
        const data = await response.json();
        const formattedData = data.map((inc: any) => ({
          ...inc,
          id: inc._id,
          timestamp: new Date(inc.timestamp).toLocaleString("fr-FR", { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        }));
        setIncidents(formattedData);
      } catch (error) {
        console.error("[-] Impossible de charger l'historique :", error);
      }
    };

    fetchHistory();

    const socket = io(backendUrl);

    socket.on("connect", () => setWsConnected(true));
    socket.on("disconnect", () => setWsConnected(false));

    socket.on("soar_incident_incoming", (data: any) => {
      const newIncident: AlertData = {
        ...data,
        id: data._id || Math.random().toString(36).substring(7),
        timestamp: new Date(data.timestamp || Date.now()).toLocaleString("fr-FR", { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      };
      setIncidents((prev) => [newIncident, ...prev]);
    });

    socket.on("soar_incident_updated", (updatedIncident: any) => {
      setIncidents((prev) => prev.map(inc =>
        inc.id === updatedIncident._id
          ? {
            ...updatedIncident,
            id: updatedIncident._id,
            timestamp: new Date(updatedIncident.timestamp || Date.now()).toLocaleString("fr-FR", { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          }
          : inc
      ));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Action SOAR : Bloquer
  const handleBlockIp = (ip: string, id: string) => {
    const currentHost = window.location.hostname;
    const socket = io(`http://${currentHost}:4000`);
    socket.emit("send_command", { action: "BLOCK_IP", targetIp: ip, sensor: "Firewall-Core", incidentId: id });
    setTimeout(() => { socket.disconnect(); }, 1000);
  };

  // Action SOAR : Ignorer
  const handleIgnore = (ip: string, id: string) => {
    const currentHost = window.location.hostname;
    const socket = io(`http://${currentHost}:4000`);
    socket.emit("send_command", { action: "IGNORE_INCIDENT", targetIp: ip, sensor: "Admin-Sec", incidentId: id });
    setTimeout(() => { socket.disconnect(); }, 1000);
  };

  const checkIsResolved = (status: string) => status.includes("Bannie") || status.includes("Résolu") || status.includes("Faux Positif") || status.includes("Ignoré");

  const filteredIncidents = incidents.filter(incident => {
    if (activeFilter === "ALL") return true;
    const isResolved = checkIsResolved(incident.caseStatus);
    if (activeFilter === "RESOLVED") return isResolved;
    if (activeFilter === "OPEN") return !isResolved;
    return true;
  });

  const openCount = incidents.filter(inc => !checkIsResolved(inc.caseStatus)).length;
  const resolvedCount = incidents.filter(inc => checkIsResolved(inc.caseStatus)).length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* HEADER */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-red-500 flex items-center gap-3">
            <ShieldAlert size={32} />
            Incidents SOAR & Décisions IA
          </h1>
          <p className="text-slate-400 mt-2">Centre de commandement des ripostes automatisées (Tier 3)</p>
        </div>
        <div className={`px-4 py-2 rounded-full border ${wsConnected ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-red-500/10 border-red-500/30 text-red-400'} flex items-center gap-2`}>
          <div className={`h-2.5 w-2.5 rounded-full ${wsConnected ? 'bg-cyan-400 animate-pulse' : 'bg-red-500'}`}></div>
          <span className="text-sm font-semibold">{wsConnected ? 'Pipeline IA Actif' : 'Hub Déconnecté'}</span>
        </div>
      </div>

      {/* FILTRES */}
      <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded-lg border border-slate-800 w-fit mb-8 shadow-sm">
        <button
          onClick={() => setActiveFilter("OPEN")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${activeFilter === "OPEN" ? "bg-red-500/20 text-red-400 border border-red-500/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "text-slate-400 hover:text-slate-200"}`}
        >
          <Filter size={16} />
          À traiter
          {openCount > 0 && <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full ml-1">{openCount}</span>}
        </button>

        <button
          onClick={() => setActiveFilter("RESOLVED")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${activeFilter === "RESOLVED" ? "bg-green-500/20 text-green-400 border border-green-500/30" : "text-slate-400 hover:text-slate-200"}`}
        >
          <CheckCircle size={16} />
          Résolus
          {resolvedCount > 0 && <span className="bg-slate-800 text-slate-300 text-xs px-2 py-0.5 rounded-full ml-1">{resolvedCount}</span>}
        </button>

        <button
          onClick={() => setActiveFilter("ALL")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${activeFilter === "ALL" ? "bg-slate-700 text-white shadow-inner" : "text-slate-400 hover:text-slate-200"}`}
        >
          Tous ({incidents.length})
        </button>
      </div>

      {/* LISTE DES INCIDENTS */}
      {filteredIncidents.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-24 border border-dashed border-slate-700 rounded-xl bg-slate-900/30 shadow-inner">
          <CheckCircle size={64} className="text-green-500 mb-4 opacity-30" />
          <h3 className="text-xl font-bold text-slate-300">
            {activeFilter === "OPEN" ? "Excellente nouvelle ! Aucun incident en attente." : "Aucun incident trouvé dans cette catégorie."}
          </h3>
          <p className="text-slate-500 mt-2">L'infrastructure réseau est sécurisée.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {filteredIncidents.map((incident) => {

            // Détection du Zero Trust pour styliser la carte en Violet
            const isZeroTrust = incident.sourceSensor?.includes("Zero Trust") || incident.threatType?.includes("Bypass");
            // Récupération dynamique du score IA
            const confianceLlama = incident.diagnostic_json?.score_confiance || incident.aiConfidenceScore || 0;

            return (
              <div key={incident.id} className={`bg-slate-900 border rounded-xl overflow-hidden shadow-2xl transition-all duration-300 ${isZeroTrust ? 'border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.15)]' : 'border-slate-800'}`}>

                {/* En-tête de la carte */}
                <div className={`p-4 border-b flex justify-between items-center ${isZeroTrust ? 'bg-purple-950/20 border-purple-900/50' : 'bg-slate-950 border-slate-800'}`}>
                  <div className="flex items-center gap-4">
                    {!checkIsResolved(incident.caseStatus) ? (
                      <AlertTriangle className={`${isZeroTrust ? 'text-purple-400' : 'text-red-500'} animate-pulse`} size={28} />
                    ) : (
                      <CheckCircle className="text-green-500" size={28} />
                    )}
                    <div>
                      <h3 className="text-lg font-bold text-slate-100">{incident.threatType}</h3>
                      <p className="text-xs font-mono text-slate-400 mt-1">
                        {incident.timestamp} • Détecté par : <span className={isZeroTrust ? 'text-purple-300 font-bold' : 'text-cyan-400 font-bold'}>{incident.sourceSensor}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Badge GeoIP & IP Hostile */}
                    <span className="font-mono text-red-400 bg-red-950/40 px-3 py-1.5 rounded border border-red-900/50 flex items-center gap-2 shadow-inner">
                      <Crosshair size={14} />
                      {incident.maliciousIp}
                      <span className="text-slate-300 ml-2 border-l border-red-900/50 pl-2 text-xs">{getIpBadge(incident.maliciousIp)}</span>
                    </span>

                    {/* Badge de Statut SOAR Dynamique */}
                    <span className={`text-sm px-4 py-1.5 rounded font-bold uppercase tracking-wider shadow-sm
                      ${checkIsResolved(incident.caseStatus) ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                        incident.caseStatus.includes("Analyse") ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse' :
                          incident.caseStatus.includes("cours de blocage") ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 animate-pulse' :
                            'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'}`}>
                      {incident.caseStatus}
                    </span>
                  </div>
                </div>

                {/* Corps de la Carte : Analyse IA et Boutons */}
                <div className="p-6">
                  <div className="flex flex-col lg:flex-row gap-6">

                    {/* Colonne de Gauche : Rapport Llama 3 */}
                    <div className="flex-1 bg-slate-950/50 p-5 rounded-lg border border-cyan-900/30 relative shadow-inner">
                      <div className={`absolute -top-3 -left-3 border p-2 rounded-full ${isZeroTrust ? 'bg-purple-950 border-purple-800' : 'bg-cyan-950 border-cyan-800'}`}>
                        <BrainCircuit size={20} className={isZeroTrust ? 'text-purple-400' : 'text-cyan-400'} />
                      </div>

                      <div className="flex justify-between items-center mb-4 ml-6">
                        <h4 className={`${isZeroTrust ? 'text-purple-400' : 'text-cyan-400'} text-sm font-bold uppercase tracking-widest`}>
                          Diagnostic de l'Agent IA
                        </h4>
                      </div>

                      {/* Le Parser Magique */}
                      <AiReportFormatter data={incident.diagnostic_json} fallbackText={incident.aiSummary} />

                      {/* Jauge de Confiance XAI */}
                      <div className="mt-6 flex items-center gap-4 bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Confiance du Modèle :</span>
                        <div className="flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden shadow-inner relative">
                          <div
                            className="absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ease-out"
                            style={{
                              width: `${confianceLlama}%`,
                              backgroundImage: `linear-gradient(to right, ${confianceLlama > 80 ? '#10b981, #3b82f6' : '#eab308, #ef4444'})`
                            }}
                          ></div>
                        </div>
                        <span className="text-sm font-bold text-slate-200">{confianceLlama}%</span>
                      </div>
                    </div>

                    {/* Colonne de Droite : Actions Human-in-the-Loop */}
                    <div className="w-full lg:w-72 space-y-3 flex flex-col justify-center">
                      {incident.caseStatus === "Ouvert" ? (
                        <>
                          <button
                            onClick={() => handleBlockIp(incident.maliciousIp, incident.id)}
                            className="w-full py-4 px-4 rounded-lg flex items-center justify-center gap-3 font-bold transition-all bg-red-600 hover:bg-red-500 text-white shadow-[0_0_20px_rgba(220,38,38,0.4)] hover:scale-[1.02]"
                          >
                            <ShieldBan size={20} />
                            Approuver le Blocage
                          </button>
                          <button
                            onClick={() => handleIgnore(incident.maliciousIp, incident.id)}
                            className="w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-semibold text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all border border-slate-700 hover:border-slate-500"
                          >
                            Ignorer (Faux Positif)
                          </button>
                        </>
                      ) : incident.caseStatus.includes("Analyse") || incident.caseStatus.includes("cours") ? (
                        <button disabled className="w-full py-4 px-4 rounded-lg flex items-center justify-center gap-2 font-bold bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700 shadow-inner">
                          <BrainCircuit size={18} className="animate-pulse" />
                          Traitement en cours...
                        </button>
                      ) : (
                        <>
                          <a
                            href={incident.kibanaUrl || "http://192.168.56.130:5601/app/dashboards#/view/2bfeba8b-1699-4c22-8a2a-4eb9835c8628?_g=(filters:!(),refreshInterval:(pause:!t,value:60000),time:(from:now-15m,to:now))"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-bold transition-all bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30"
                          >
                            <ExternalLink size={18} />
                            Voir les logs bruts
                          </a>

                          <button
                            onClick={() => generatePDF(incident)}
                            disabled={exportingId === incident.id}
                            className="w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2 font-semibold text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all border border-slate-700 disabled:opacity-50"
                          >
                            {exportingId === incident.id ? (
                              <><Activity size={16} className="animate-spin" /> Génération en cours...</>
                            ) : (
                              <><FileText size={16} /> Exporter l'Audit PDF</>
                            )}
                          </button>

                          {incident.caseStatus.includes("Bannie") && (
                            <button className="w-full py-2 px-4 mt-2 rounded-lg flex items-center justify-center gap-2 font-semibold text-xs text-slate-500 hover:text-orange-400 transition-all hover:bg-slate-800">
                              <Unlock size={14} />
                              Débloquer (Whitelist)
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}