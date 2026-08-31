"use client";

import { useState, useEffect } from "react";
import { 
  ShieldAlert, ShieldCheck, BrainCircuit, Globe, 
  BookOpen, Clock, Activity, CheckCircle2, ChevronRight 
} from "lucide-react";

export default function DailyBriefingModal() {
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    // 1. On utilise le sessionStorage pour ne l'afficher qu'UNE SEULE FOIS par session (jusqu'à ce que l'onglet soit fermé)
    if (sessionStorage.getItem("briefing_seen") === "true") return;

    const fetchBriefing = async () => {
      try {
        const lastLogout = localStorage.getItem("soc_last_logout");
        
        // 2. Extraction du token pour franchir le vigile Backend (Zero Trust)
        const getCookie = (name: string) => {
          const value = `; ${document.cookie}`;
          const parts = value.split(`; ${name}=`);
          if (parts.length === 2) return parts.pop()?.split(';').shift();
          return "";
        };
        const token = getCookie("soc_token");

        if (!token) return;

        const currentHost = window.location.hostname;
        const res = await fetch(`http://${currentHost}:4000/api/briefing`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ last_logout: lastLogout })
        });

        if (res.ok) {
          const result = await res.json();
          setData(result);
          // On affiche le modal seulement s'il y a eu de l'activité, ou pour la démo
          setShow(true); 
        }
      } catch (error) {
        console.error("[-] Erreur récupération Briefing :", error);
      } finally {
        setLoading(false);
      }
    };

    fetchBriefing();
  }, []);

  const handleAcknowledge = () => {
    sessionStorage.setItem("briefing_seen", "true");
    setShow(false);
  };

  if (!show || loading || !data) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-[#050810]/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-500">
      
      {/* Conteneur Principal du Modal */}
      <div className="bg-[#0B1120] border border-slate-700/80 rounded-3xl w-full max-w-4xl shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-500">
        
        {/* Lueur d'ambiance holographique */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-[200px] bg-purple-600/10 blur-[80px] pointer-events-none"></div>

        {/* --- HEADER --- */}
        <div className="px-8 py-6 border-b border-slate-800/80 flex items-start justify-between bg-slate-900/40 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <h2 className="text-[10px] font-black tracking-[0.3em] text-emerald-400 uppercase">Daily Briefing • Auto-Pilote IA</h2>
            </div>
            <h1 className="text-3xl font-black text-slate-100 tracking-tight">Rapport de Relève SOC</h1>
            <p className="text-sm text-slate-400 mt-2 flex items-center gap-2">
              <Clock size={14} /> Synthèse des événements survenus depuis votre dernière déconnexion.
            </p>
          </div>
          <div className="p-3 bg-[#050810] border border-slate-800 rounded-2xl shadow-inner">
            <BrainCircuit size={32} className="text-purple-400" />
          </div>
        </div>

        {/* --- CORPS DU RAPPORT --- */}
        <div className="p-8 space-y-8 relative z-10">
          
          {/* Métriques Clés (Grid) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            
            {/* Stat 1 : Auto-bloqués */}
            <div className="bg-slate-900/50 border border-emerald-500/20 p-5 rounded-2xl">
              <ShieldCheck size={20} className="text-emerald-400 mb-3" />
              <p className="text-3xl font-black text-slate-100">{data.summary.auto_blocked}</p>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">Attaques bloquées (Nuit)</p>
            </div>

            {/* Stat 2 : Critiques */}
            <div className="bg-slate-900/50 border border-rose-500/20 p-5 rounded-2xl relative overflow-hidden">
              {data.summary.critical_alerts > 0 && (
                <div className="absolute top-0 right-0 w-16 h-16 bg-rose-500/10 blur-xl"></div>
              )}
              <ShieldAlert size={20} className="text-rose-400 mb-3" />
              <p className="text-3xl font-black text-slate-100">{data.summary.critical_alerts}</p>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">Alertes Critiques</p>
            </div>

            {/* Stat 3 : CTI */}
            <div className="bg-slate-900/50 border border-cyan-500/20 p-5 rounded-2xl">
              <Globe size={20} className="text-cyan-400 mb-3" />
              <p className="text-3xl font-black text-slate-100">{data.summary.new_cti}</p>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">Nouvelles CTI</p>
            </div>

            {/* Stat 4 : Formations */}
            <div className="bg-slate-900/50 border border-purple-500/20 p-5 rounded-2xl">
              <BookOpen size={20} className="text-purple-400 mb-3" />
              <p className="text-3xl font-black text-slate-100">{data.summary.new_formations}</p>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">Micro-Learnings</p>
            </div>
          </div>

          {/* Liste des événements récents */}
          {data.recent_incidents?.length > 0 && (
            <div>
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-2 mb-4">
                Derniers événements interceptés
              </h3>
              <div className="space-y-3">
                {data.recent_incidents.map((inc: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between bg-[#050810] border border-slate-800 p-4 rounded-xl">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${inc.caseStatus.includes('bloqué') || inc.caseStatus.includes('Bannie') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        <Activity size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-200">{inc.threatType}</p>
                        <p className="text-xs text-slate-500">Cible/IP : {inc.maliciousIp}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded border ${inc.caseStatus.includes('bloqué') || inc.caseStatus.includes('Bannie') ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
                        {inc.caseStatus}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* --- FOOTER (Bouton d'acquittement) --- */}
        <div className="p-6 border-t border-slate-800 bg-[#050810] flex justify-end">
          <button 
            onClick={handleAcknowledge}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-8 py-3.5 rounded-xl font-bold shadow-[0_0_20px_rgba(168,85,247,0.3)] transition-all"
          >
            <CheckCircle2 size={20} />
            ACQUITTER ET DÉMARRER LA SESSION
            <ChevronRight size={18} className="ml-2" />
          </button>
        </div>
        
      </div>
    </div>
  );
}