"use client";

import { useState, useEffect } from "react";
import { BrainCircuit, Server, Clock, Activity, Code, FileJson, Terminal, ChevronDown, ChevronUp, Cpu } from "lucide-react";
import { io } from "socket.io-client";

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

interface AiActivityData {
  id: string;
  maliciousIp: string;
  timestamp: string;
  prompt_contexte?: string;
  diagnostic_json?: DiagnosticJSON;
  aiSummary?: string; // Ancien format de secours
  duree_generation_sec?: number;
  aiConfidenceScore?: number;
}

// ==========================================
// 2. Composant Carte d'Activité IA
// ==========================================
const AiActivityCard = ({ activity }: { activity: AiActivityData }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const duree = activity.duree_generation_sec ? `${activity.duree_generation_sec}s` : "N/A";
  const confiance = activity.diagnostic_json?.score_confiance || activity.aiConfidenceScore || 0;
  
  // Formatage propre du JSON pour l'affichage
  const jsonString = activity.diagnostic_json 
    ? JSON.stringify(activity.diagnostic_json, null, 2) 
    : JSON.stringify({ erreur: "Format non structuré", texte: activity.aiSummary }, null, 2);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg transition-all">
      {/* Header de la carte (Toujours visible) */}
      <div 
        className="p-4 bg-slate-950 flex flex-wrap gap-4 justify-between items-center cursor-pointer hover:bg-slate-900/80 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-4">
          <div className="bg-purple-500/10 p-2 rounded-lg border border-purple-500/30">
            <Terminal className="text-purple-400" size={24} />
          </div>
          <div>
            <h3 className="font-bold text-slate-200 flex items-center gap-2">
              Inférence LLM <span className="text-purple-400 font-mono text-sm">#{activity.id.substring(0, 8)}</span>
            </h3>
            <p className="text-xs text-slate-500 font-mono mt-1">Cible : {activity.maliciousIp} • {activity.timestamp}</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Métriques d'inférence */}
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Temps de Génération</span>
            <span className="text-sm font-mono text-cyan-400 flex items-center gap-1">
              <Clock size={12} /> {duree}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Confiance IA</span>
            <span className={`text-sm font-mono font-bold ${confiance > 80 ? 'text-green-400' : 'text-yellow-400'}`}>
              {confiance}%
            </span>
          </div>
          <div className="text-slate-600">
            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
      </div>

      {/* Détails du Prompt et du JSON (Menu déroulant) */}
      {isExpanded && (
        <div className="p-6 border-t border-slate-800 grid grid-cols-1 xl:grid-cols-2 gap-6 bg-slate-900/50">
          
          {/* Colonne 1 : Le Prompt Injecté */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-slate-400 mb-2">
              <Code size={16} />
              <h4 className="text-xs font-bold uppercase tracking-wider">Contexte Injecté (Prompt)</h4>
            </div>
            <div className="bg-[#0d1117] border border-slate-800 rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs text-slate-300 shadow-inner custom-scrollbar">
              <pre className="whitespace-pre-wrap">{activity.prompt_contexte || "Prompt non enregistré pour cet incident."}</pre>
            </div>
          </div>

          {/* Colonne 2 : La Sortie JSON */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-purple-400 mb-2">
              <FileJson size={16} />
              <h4 className="text-xs font-bold uppercase tracking-wider">Sortie Structurée (JSON)</h4>
            </div>
            <div className="bg-[#0d1117] border border-purple-900/30 rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs text-purple-300 shadow-inner custom-scrollbar">
              <pre className="whitespace-pre-wrap">{jsonString}</pre>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};

// ==========================================
// 3. Page Principale Activité IA
// ==========================================
export default function IaActivityPage() {
  const [activities, setActivities] = useState<AiActivityData[]>([]);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    const currentHost = window.location.hostname;
    const backendUrl = `http://${currentHost}:4000`;

    // Récupérer l'historique
    const fetchHistory = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/incidents`);
        const data = await response.json();
        
        // On ne garde que les incidents qui ont fait appel à l'IA (qui ont un aiSummary ou un diagnostic_json)
        const aiData = data
          .filter((inc: any) => inc.aiSummary || inc.diagnostic_json)
          .map((inc: any) => ({
            ...inc,
            id: inc._id,
            timestamp: new Date(inc.timestamp).toLocaleString(),
          }));
        setActivities(aiData);
      } catch (error) {
        console.error("[-] Impossible de charger l'historique IA :", error);
      }
    };

    fetchHistory();

    // Connexion Websocket
    const socket = io(backendUrl);
    socket.on("connect", () => setWsConnected(true));
    socket.on("disconnect", () => setWsConnected(false));

    socket.on("soar_incident_updated", (updatedIncident: any) => {
      if (updatedIncident.aiSummary || updatedIncident.diagnostic_json) {
        setActivities((prev) => {
          const exists = prev.find(a => a.id === updatedIncident._id);
          if (exists) {
            return prev.map(a => a.id === updatedIncident._id ? { ...updatedIncident, id: updatedIncident._id, timestamp: new Date(updatedIncident.timestamp).toLocaleString() } : a);
          } else {
            return [{ ...updatedIncident, id: updatedIncident._id, timestamp: new Date(updatedIncident.timestamp).toLocaleString() }, ...prev];
          }
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Calcul des KPIs
  const totalInferences = activities.length;
  const avgTime = totalInferences > 0 
    ? (activities.reduce((acc, curr) => acc + (curr.duree_generation_sec || 0), 0) / totalInferences).toFixed(2) 
    : 0;
  
  const avgConfidence = totalInferences > 0 
    ? Math.round(activities.reduce((acc, curr) => acc + (curr.diagnostic_json?.score_confiance || curr.aiConfidenceScore || 0), 0) / totalInferences)
    : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      
      {/* HEADER */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-purple-400 flex items-center gap-3">
            <BrainCircuit size={32} />
            Journal d'Inférence IA (Llama 3)
          </h1>
          <p className="text-slate-400 mt-2">Traçabilité, audit et explicabilité du modèle sémantique.</p>
        </div>
        
        {/* Status du Modèle IA */}
        <div className="flex items-center gap-4">
          <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg flex items-center gap-3">
            <Cpu className="text-slate-400" size={18} />
            <div>
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Moteur Actif</div>
              <div className="text-sm font-mono text-slate-300">Llama-3.2:3B</div>
            </div>
          </div>
          <div className={`px-4 py-3 rounded-lg border ${wsConnected ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'} flex items-center gap-2 shadow-inner`}>
            <div className={`h-2.5 w-2.5 rounded-full ${wsConnected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`}></div>
            <span className="text-sm font-bold">{wsConnected ? 'Agent IA En Ligne' : 'Agent Déconnecté'}</span>
          </div>
        </div>
      </div>

      {/* KPIs LLMOps */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-sm flex items-center gap-4">
          <div className="bg-blue-500/10 p-3 rounded-lg border border-blue-500/20">
            <Activity className="text-blue-400" size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total Inférences</p>
            <h4 className="text-2xl font-bold text-slate-200">{totalInferences}</h4>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-sm flex items-center gap-4">
          <div className="bg-cyan-500/10 p-3 rounded-lg border border-cyan-500/20">
            <Clock className="text-cyan-400" size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Temps Moyen (Génération)</p>
            <h4 className="text-2xl font-bold text-slate-200">{avgTime} <span className="text-sm text-slate-500 font-normal">secondes</span></h4>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-sm flex items-center gap-4">
          <div className="bg-purple-500/10 p-3 rounded-lg border border-purple-500/20">
            <Server className="text-purple-400" size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Confiance Moyenne (Self-Eval)</p>
            <h4 className="text-2xl font-bold text-slate-200">{avgConfidence}%</h4>
          </div>
        </div>
      </div>

      {/* LISTE DES ACTIVITÉS */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-300 mb-4 flex items-center gap-2">
          <Terminal size={18} /> Logs d'Audit (Prompt Engineering)
        </h2>
        
        {activities.length === 0 ? (
          <div className="text-center p-12 bg-slate-900/50 border border-dashed border-slate-800 rounded-xl text-slate-500">
            Aucune inférence IA enregistrée pour le moment.
          </div>
        ) : (
          activities.map((activity) => (
            <AiActivityCard key={activity.id} activity={activity} />
          ))
        )}
      </div>

    </div>
  );
}