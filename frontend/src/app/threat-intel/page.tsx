"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Globe, ShieldAlert, Code, Link as LinkIcon, Plus, Trash2,
  CheckCircle, Activity, Cpu, Target, Filter,
  Server, ShieldCheck, Clock, AlertTriangle, Send,
  XCircle, X, Save, Search, Flame, Bug, RefreshCw, ExternalLink,
  Shield, Radio, Check, GraduationCap, BookOpen
} from "lucide-react";
import Link from 'next/link'; // Import ajouté pour la redirection

export default function ThreatIntelPage() {
  const [actualities, setActualities] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Formulaire d'ajout de source
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");

  // États d'action techniques (Suricata)
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>("");

  // État d'action Formation
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  // Filtres UI/UX
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "DEPLOYED" | "AWARENESS">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "CVE" | "MALWARE" | "PHISHING" | "NEWS">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchBackend = async () => {
    try {
      setIsRefreshing(true);
      const currentHost = window.location.hostname;
      const backendUrl = `http://${currentHost}:4000`;

      const resActs = await fetch(`${backendUrl}/api/cti-actualities`);
      if (resActs.ok) setActualities(await resActs.json());

      const resSources = await fetch(`${backendUrl}/api/cti-sources`);
      if (resSources.ok) setSources(await resSources.json());
    } catch (error) {
      console.error("Erreur de connexion au backend :", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBackend();
    const interval = setInterval(fetchBackend, 15000);
    return () => clearInterval(interval);
  }, []);

  // Détection automatique de la catégorie de la menace
  const getThreatCategory = (act: any) => {
    const text = `${act.titre_menace || ""} ${act.resume_ia || ""} ${(act.iocs_extraits || []).join(" ")} ${act.regles_suricata || ""}`.toLowerCase();
    if (text.includes("phish") || text.includes("scam") || text.includes("social-engineering") || text.includes("ingénierie sociale") || act.type_article === "AWARENESS") return "PHISHING";
    if (text.includes("cve-") || text.includes("vulnérabilité") || text.includes("vulnerability") || text.includes("faille")) return "CVE";
    if (text.includes("trojan") || text.includes("backdoor") || text.includes("malware") || text.includes("c2") || text.includes("ransomware") || text.includes("rootkit")) return "MALWARE";
    return "NEWS";
  };

  // Filtrage combiné (Statut + Catégorie + Recherche)
  const filteredActualities = useMemo(() => {
    return actualities.filter((act) => {
      const status = act.status || "PENDING";
      const type = act.type_article || "TECHNICAL_THREAT";
      const category = getThreatCategory(act);

      // Filtre statut étendu
      if (statusFilter === "PENDING" && status !== "PENDING" && status !== "REJECTED") return false;
      if (statusFilter === "DEPLOYED" && status !== "DEPLOYED") return false;
      if (statusFilter === "AWARENESS" && type !== "AWARENESS" && status !== "FORMATION_GENERATED") return false;

      // Filtre catégorie
      if (categoryFilter !== "ALL" && category !== categoryFilter) return false;

      // Filtre barre de recherche
      if (searchQuery.trim() !== "") {
        const query = searchQuery.toLowerCase();
        const matchTitle = (act.titre_menace || "").toLowerCase().includes(query);
        const matchSource = (act.source_osint || "").toLowerCase().includes(query);
        const matchResume = (act.resume_ia || "").toLowerCase().includes(query);
        const matchIoc = (act.iocs_extraits || []).some((ioc: string) => ioc.toLowerCase().includes(query));
        if (!matchTitle && !matchSource && !matchResume && !matchIoc) return false;
      }

      return true;
    });
  }, [actualities, statusFilter, categoryFilter, searchQuery]);

  // Statistiques calculées
  const stats = useMemo(() => {
    const total = actualities.length;
    const critical = actualities.filter(a => (a.fiabilite_score || 0) >= 80 && a.type_article !== "AWARENESS").length;
    const deployed = actualities.filter(a => a.status === "DEPLOYED").length;
    const pending = actualities.filter(a => (!a.status || a.status === "PENDING" || a.status === "REJECTED") && a.type_article !== "AWARENESS").length;
    const awarenessCount = actualities.filter(a => a.type_article === "AWARENESS" || a.status === "FORMATION_GENERATED").length;
    return { total, critical, deployed, pending, awarenessCount };
  }, [actualities]);

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName || !newSourceUrl) return;
    try {
      const currentHost = window.location.hostname;
      const response = await fetch(`http://${currentHost}:4000/api/cti-sources`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom: newSourceName, url: newSourceUrl, type_source: "RSS" }),
      });
      if (response.ok) { setNewSourceName(""); setNewSourceUrl(""); fetchBackend(); }
    } catch (error) { console.error("Erreur lors de l'ajout de la source :", error); }
  };

  const handleDeployRule = async (ruleId: string) => {
    setDeployingId(ruleId);
    try {
      const currentHost = window.location.hostname;
      const response = await fetch(`http://${currentHost}:4000/api/rules/update-status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: ruleId, status: "APPROVED" }),
      });
      if (response.ok) {
        setActualities(prev => prev.map(act => act._id === ruleId ? { ...act, status: "APPROVED" } : act));
      }
    } catch (error) {
      console.error("Erreur réseau lors de l'approbation :", error);
    } finally { setDeployingId(null); }
  };

  const handleSaveEdit = async (ruleId: string) => {
    try {
      const currentHost = window.location.hostname;
      const response = await fetch(`http://${currentHost}:4000/api/rules/edit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: ruleId, new_rule: editContent }),
      });
      if (response.ok) { setEditingId(null); fetchBackend(); }
    } catch (error) { console.error("Erreur d'édition :", error); }
  };

  const handleGenerateFormation = async (act: any) => {
    setGeneratingId(act._id);
    try {
      const currentHost = window.location.hostname;
      const response = await fetch(`http://${currentHost}:4000/api/formations/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: act._id, titre_menace: act.titre_menace, resume_ia: act.resume_ia }),
      });
      if (response.ok) fetchBackend(); // Met à jour le statut en "FORMATION_GENERATED"
    } catch (error) {
      console.error("Erreur lors de la génération :", error);
    } finally { setGeneratingId(null); }
  };

  // Badge de Statut de Déploiement
  const renderStatusBadge = (status: string = "PENDING", type: string = "TECHNICAL_THREAT") => {
    if (type === "AWARENESS") {
      if (status === "FORMATION_GENERATED") {
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-bold rounded-full shadow-[0_0_12px_rgba(168,85,247,0.25)]">
            <GraduationCap size={12} /> MODULE DISPONIBLE
          </div>
        );
      }
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold rounded-full animate-pulse">
          <Clock size={12} /> EN ATTENTE DE FORGE IA
        </div>
      );
    }

    switch (status) {
      case "PENDING":
        return <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold rounded-full animate-pulse"><Clock size={12} /> EN ATTENTE DE VALIDATION</div>;
      case "APPROVED":
        return <div className="flex items-center gap-1.5 px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold rounded-full"><Server size={12} className="animate-spin" /> SYNCHRONISATION PARE-FEU...</div>;
      case "DEPLOYED":
        return <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold rounded-full shadow-[0_0_12px_rgba(16,185,129,0.25)]"><ShieldCheck size={12} /> ACTIVE EN PRODUCTION</div>;
      case "REJECTED":
        return <div className="flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 border border-rose-500/40 text-rose-400 text-[10px] font-bold rounded-full shadow-[0_0_12px_rgba(244,63,94,0.2)]"><XCircle size={12} /> REJET DRY-RUN (SYNTAXE)</div>;
      default: return null;
    }
  };

  const renderSeverityGauge = (score: number = 50) => {
    let label = "FAIBLE";
    let colorClass = "from-blue-500 to-cyan-400 text-blue-400";
    let borderClass = "border-blue-500/30 bg-blue-500/10";
    if (score >= 80) { label = "CRITIQUE (IMMÉDIAT)"; colorClass = "from-rose-600 to-red-500 text-red-400"; borderClass = "border-red-500/40 bg-red-500/10"; }
    else if (score >= 60) { label = "ÉLEVÉ (MAJEUR)"; colorClass = "from-amber-500 to-orange-500 text-amber-400"; borderClass = "border-amber-500/30 bg-amber-500/10"; }
    else if (score >= 40) { label = "MOYEN"; colorClass = "from-yellow-500 to-amber-400 text-yellow-400"; borderClass = "border-yellow-500/30 bg-yellow-500/10"; }

    return (
      <div className="mt-5 p-3 rounded-lg bg-[#070b14] border border-slate-800 flex flex-col gap-2">
        <div className="flex justify-between items-center text-[10px] font-bold tracking-wider uppercase">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Flame size={13} className={score >= 80 ? "text-red-500 animate-pulse" : "text-slate-400"} />
            Niveau de Gravité & Dangerosité
          </span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-black border ${borderClass}`}>
            {label} ({score}/100)
          </span>
        </div>
        <div className="w-full h-2 bg-slate-800/80 rounded-full overflow-hidden p-0.5">
          <div className={`h-full rounded-full bg-gradient-to-r ${colorClass} transition-all duration-700 shadow-sm`} style={{ width: `${score}%` }}></div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 min-h-screen bg-[#070B14] text-slate-200 font-sans">

      {/* 1. EN-TÊTE PRINCIPAL SOC */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-6 gap-4 border-b border-slate-800/80 pb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/10 border border-blue-500/30 rounded-xl shadow-inner">
            <Globe className="text-blue-400" size={28} />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-100 tracking-tight flex items-center gap-3">
              Cyber Threat Intelligence (CTI)
            </h1>
            <p className="text-slate-400 text-xs mt-1">Radar d'interception OSINT & Tri des Menaces (Réseau vs Sensibilisation)</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchBackend} disabled={isRefreshing} className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition-all shadow-sm disabled:opacity-50">
            <RefreshCw size={13} className={isRefreshing ? "animate-spin text-blue-400" : ""} /> Actualiser
          </button>
        </div>
      </div>

      {/* 2. COMPTEURS DE STATISTIQUES SOC */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#0D1527] border border-slate-800/80 p-4 rounded-xl flex items-center justify-between shadow-lg">
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Bulletins</p><h3 className="text-2xl font-black text-slate-100 mt-1">{stats.total}</h3></div>
          <div className="p-3 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg"><Radio size={20} /></div>
        </div>
        <div className="bg-[#0D1527] border border-slate-800/80 p-4 rounded-xl flex items-center justify-between shadow-lg">
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">À Réviser (Suricata)</p><h3 className="text-2xl font-black text-amber-400 mt-1">{stats.pending}</h3></div>
          <div className="p-3 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-lg"><Clock size={20} /></div>
        </div>
        <div className="bg-[#0D1527] border border-slate-800/80 p-4 rounded-xl flex items-center justify-between shadow-lg">
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">En Production (Edge)</p><h3 className="text-2xl font-black text-emerald-400 mt-1">{stats.deployed}</h3></div>
          <div className="p-3 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg"><ShieldCheck size={20} /></div>
        </div>
        <div className="bg-[#0D1527] border border-purple-900/40 p-4 rounded-xl flex items-center justify-between shadow-[0_0_15px_rgba(168,85,247,0.1)]">
          <div><p className="text-[11px] font-bold uppercase tracking-wider text-purple-400">Cibles Humaines (Formations)</p><h3 className="text-2xl font-black text-purple-300 mt-1">{stats.awarenessCount}</h3></div>
          <div className="p-3 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-lg"><GraduationCap size={20} /></div>
        </div>
      </div>

      {/* 3. BARRE DE NAVIGATION (ONGLETS) */}
      <div className="bg-[#0D1527] border border-slate-800/80 p-3 rounded-xl mb-8 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4 shadow-xl">
        <div className="flex flex-wrap items-center gap-1.5 bg-[#070B14] p-1.5 rounded-lg border border-slate-800/80">
          <button onClick={() => setStatusFilter("ALL")} className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${statusFilter === "ALL" ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}>
            <Filter size={13} /> Flux Continu ({stats.total})
          </button>
          <button onClick={() => setStatusFilter("PENDING")} className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${statusFilter === "PENDING" ? "bg-amber-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}>
            <AlertTriangle size={13} /> Attente Suricata ({stats.pending})
          </button>
          <button onClick={() => setStatusFilter("AWARENESS")} className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${statusFilter === "AWARENESS" ? "bg-purple-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}>
            <GraduationCap size={13} /> Sensibilisation ({stats.awarenessCount})
          </button>
        </div>

        <div className="relative min-w-[240px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrer par mot-clé, IoC, CVE..."
            className="w-full bg-[#070B14] border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      </div>

      {/* 4. GRILLE PRINCIPALE (CARTES + SOURCES) */}
      <div className="grid grid-cols-1 xl:grid-cols-4 2xl:grid-cols-5 gap-8">

        {/* COLONNE GAUCHE : FLUX D'ACTUALITÉS */}
        <div className="xl:col-span-3 2xl:col-span-4 space-y-6">
          {filteredActualities.length === 0 ? (
            <div className="bg-[#0D1527] border border-slate-800 p-12 rounded-2xl text-center flex flex-col items-center justify-center">
              <Activity className="text-slate-600 mb-4 animate-pulse" size={48} />
              <p className="text-slate-400 font-semibold">Aucun bulletin ne correspond aux filtres sélectionnés.</p>
            </div>
          ) : (
            filteredActualities.map((act) => {
              const status = act.status || "PENDING";
              const type = act.type_article || "TECHNICAL_THREAT";
              const isAwareness = type === "AWARENESS";
              const isDeployed = status === "DEPLOYED";
              const isRejected = status === "REJECTED";
              const isGenerated = status === "FORMATION_GENERATED";
              const isEditing = editingId === act._id;
              const severityScore = act.fiabilite_score || 50;

              return (
                <div key={act._id} className={`bg-[#0D1527] border ${isAwareness ? 'border-purple-500/30 hover:border-purple-500/50' :
                  isDeployed ? 'border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.06)]' :
                    isRejected ? 'border-rose-500/30' : 'border-slate-800/80 hover:border-slate-700'
                  } rounded-2xl p-6 shadow-xl flex flex-col transition-all relative overflow-hidden`}
                >
                  {/* Lueur d'ambiance dynamique */}
                  {isAwareness && <div className="absolute top-0 right-0 w-72 h-72 bg-purple-500/5 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2"></div>}
                  {!isAwareness && isDeployed && <div className="absolute top-0 right-0 w-72 h-72 bg-emerald-500/5 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2"></div>}
                  {!isAwareness && isRejected && <div className="absolute top-0 right-0 w-72 h-72 bg-rose-500/5 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2"></div>}

                  {/* EN-TÊTE DE LA CARTE */}
                  <div className="flex flex-col lg:flex-row justify-between items-start gap-4 z-10">
                    <div className="flex gap-4 flex-1">
                      <div className="mt-1">
                        {isAwareness ? (
                          <GraduationCap className="text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.4)]" size={26} />
                        ) : (
                          <ShieldAlert className={severityScore >= 80 ? "text-rose-500" : "text-amber-500"} size={26} />
                        )}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          {isAwareness ? (
                            <span className="px-2.5 py-0.5 bg-purple-500/10 border border-purple-500/30 text-purple-400 text-[10px] font-bold rounded flex items-center gap-1">
                              <Target size={11} /> CIBLE HUMAINE
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] font-bold rounded flex items-center gap-1">
                              <Server size={11} /> CIBLE RÉSEAU
                            </span>
                          )}
                          <span className="text-[11px] text-slate-400 flex items-center gap-1.5"><Clock size={11} /> {new Date(act.date_publication).toLocaleTimeString()}</span>
                        </div>
                        <h2 className="text-lg md:text-xl font-bold text-slate-100 leading-snug">{act.titre_menace}</h2>
                        <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">Capteur Source : <span className="text-blue-400 font-semibold">{act.source_osint}</span></p>
                      </div>
                    </div>
                  </div>

                  {/* RAPPORT IA */}
                  <div className="mt-6 lg:ml-10 relative z-10">
                    <div className="hidden lg:block absolute -left-[2.1rem] top-6 w-8 h-px bg-slate-700"></div>
                    <div className="hidden lg:flex absolute -left-[2.8rem] top-4 bg-[#070B14] border border-slate-700 rounded-full p-1.5 items-center justify-center z-10 shadow-lg">
                      <Cpu size={14} className={isAwareness ? "text-purple-400" : "text-cyan-400"} />
                    </div>

                    <div className="bg-[#070B14] border border-slate-800/80 rounded-xl p-5 shadow-inner">
                      <div className="flex justify-between items-center mb-3">
                        <h3 className={`text-[11px] font-black tracking-widest uppercase flex items-center gap-2 ${isAwareness ? 'text-purple-400' : 'text-cyan-400'}`}>
                          <Activity size={13} /> Rapport Synthétique de l'Agent IA
                        </h3>
                        {renderStatusBadge(status, type)}
                      </div>

                      <p className={`text-sm text-slate-300 leading-relaxed border-l-2 pl-4 mb-5 ${isAwareness ? 'border-purple-500/40' : 'border-cyan-500/40'}`}>
                        {act.resume_ia}
                      </p>

                      {/* --- BLOC CONDITIONNEL : AWARENESS (LMS) vs TECHNICAL (SURICATA) --- */}

                      {isAwareness ? (
                        /* BLOC AWARENESS : Générateur de Formation */
                        <div className="mt-3 bg-purple-950/20 border border-purple-900/50 rounded-xl p-4 flex justify-between items-center transition-all">
                          <div className="flex items-center gap-2 text-purple-300">
                            <BookOpen size={16} />
                            <span className="text-xs font-bold uppercase tracking-wider">Plan de Sensibilisation</span>
                          </div>
                          {isGenerated ? (
                            <Link href={`/formations`} className="bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold px-4 py-2 rounded-lg transition-all shadow-[0_0_15px_rgba(168,85,247,0.3)] flex items-center gap-2">
                              <GraduationCap size={14} /> OUVRIR LE HUB FORMATION
                            </Link>
                          ) : (
                            <button onClick={() => handleGenerateFormation(act)} disabled={generatingId === act._id} className="bg-slate-800 hover:bg-slate-700 text-purple-400 border border-purple-900 text-[10px] font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all">
                              {generatingId === act._id ? <><Activity size={14} className="animate-spin" /> FORGE EN COURS...</> : <><Cpu size={14} /> GÉNÉRER LE MODULE</>}
                            </button>
                          )}
                        </div>
                      ) : (
                        /* BLOC TECHNICAL : Terminal Suricata Original */
                        act.regles_suricata && act.regles_suricata !== "N/A" && (
                          <div className={`mt-3 bg-[#03060E] border ${isDeployed ? 'border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : isRejected ? 'border-rose-500/40' : 'border-slate-800'
                            } rounded-xl overflow-hidden transition-all`}>

                            <div className={`flex justify-between items-center px-4 py-2.5 ${isDeployed ? 'bg-emerald-500/10' : isRejected ? 'bg-rose-500/10' : 'bg-slate-900/60'} border-b border-slate-800`}>
                              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                <Code size={13} className={isDeployed ? "text-emerald-400" : "text-blue-400"} />
                                {isEditing ? "Éditeur de Signature (Expert Réseaux)" : "Signature Suricata Proposée"}
                              </div>
                              {(status === "PENDING" || status === "REJECTED") && !isEditing && (
                                <button onClick={() => handleDeployRule(act._id)} disabled={deployingId === act._id} className={`flex items-center gap-1.5 px-3.5 py-1.5 text-white text-[10px] font-bold uppercase rounded-lg shadow-lg transition-all disabled:opacity-50 ${status === "REJECTED" ? "bg-amber-600 hover:bg-amber-500" : "bg-blue-600 hover:bg-blue-500"}`}>
                                  {deployingId === act._id ? <><Activity size={12} className="animate-spin" /> VÉRIFICATION...</> : <><Send size={12} /> {status === "REJECTED" ? "RETENTER" : "APPROUVER & INJECTER"}</>}
                                </button>
                              )}
                            </div>

                            <div className="p-4 relative group">
                              {isRejected && act.error_log && !isEditing && (
                                <div className="mb-4 p-3.5 bg-rose-950/40 border-l-4 border-rose-500 rounded-r-lg text-rose-300 text-[11px] font-mono max-h-32 overflow-y-auto">
                                  <strong className="text-rose-400 flex items-center gap-1.5 mb-1 text-xs"><XCircle size={14} /> Rejet du Moteur Suricata (Dry-Run Failed) :</strong>
                                  {act.error_log}
                                </div>
                              )}

                              {isEditing ? (
                                <div>
                                  <textarea className="w-full bg-[#020408] border border-blue-500/50 rounded-lg p-3 text-[11px] font-mono text-cyan-300 focus:outline-none focus:border-cyan-400 transition-colors h-28 resize-none shadow-inner" value={editContent} onChange={(e) => setEditContent(e.target.value)} />
                                  <div className="flex justify-end gap-2 mt-3">
                                    <button onClick={() => setEditingId(null)} className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 text-slate-300 text-[10px] font-bold uppercase rounded-lg hover:bg-slate-700 transition-colors"><X size={13} /> Annuler</button>
                                    <button onClick={() => handleSaveEdit(act._id)} className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 text-white text-[10px] font-bold uppercase rounded-lg shadow-lg hover:bg-blue-500 transition-all"><Save size={13} /> Sauvegarder</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="relative">
                                  <code className={`text-[11px] font-mono break-words whitespace-pre-wrap block leading-relaxed ${isDeployed ? 'text-emerald-400' : isRejected ? 'text-rose-400' : 'text-slate-300'}`}>{act.regles_suricata}</code>
                                  {!isDeployed && (
                                    <button onClick={() => { setEditingId(act._id); setEditContent(act.regles_suricata); }} className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 bg-slate-800 border border-slate-700 p-2 rounded-lg text-slate-300 hover:text-blue-400 transition-all"><Code size={15} /></button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      )}
                      {/* NOUVEAU : Bouton de génération discret pour les alertes techniques */}
                      <div className="mt-3 flex items-center justify-end">
                        {isGenerated ? (
                          <Link href={`/formations`} className="text-purple-400 hover:text-purple-300 text-[10px] font-bold flex items-center gap-1.5 transition-colors">
                            <GraduationCap size={14} /> MODULE DÉJÀ GÉNÉRÉ (VOIR LE HUB)
                          </Link>
                        ) : (
                          <button
                            onClick={() => handleGenerateFormation(act)}
                            disabled={generatingId === act._id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-slate-400 hover:text-purple-400 bg-slate-900/50 hover:bg-purple-900/20 border border-slate-800 hover:border-purple-500/50 text-[10px] font-bold rounded-lg transition-all"
                          >
                            {generatingId === act._id ? (
                              <><Activity size={12} className="animate-spin" /> FORGE EN COURS...</>
                            ) : (
                              <><Cpu size={12} /> CRÉER UNE FORMATION TECHNIQUE (OPTIONNEL)</>
                            )}
                          </button>
                        )}
                      </div>
                      {!isAwareness && renderSeverityGauge(severityScore)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* COLONNE DROITE : CAPTEURS ET SOURCES (INTACT) */}
        <div className="xl:col-span-1">
          <div className="bg-[#0D1527] border border-slate-800/80 rounded-2xl p-6 sticky top-8 shadow-xl">
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2 mb-3">
              <LinkIcon className="text-blue-400" size={18} /> Capteurs OSINT
            </h2>
            <form onSubmit={handleAddSource} className="space-y-4 mb-6">
              <div><input type="text" value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} placeholder="Nom du flux" className="w-full bg-[#070B14] border border-slate-800 rounded-lg px-3.5 py-2 text-xs" /></div>
              <div><input type="url" value={newSourceUrl} onChange={(e) => setNewSourceUrl(e.target.value)} placeholder="URL RSS" className="w-full bg-[#070B14] border border-slate-800 rounded-lg px-3.5 py-2 text-xs" /></div>
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-2 rounded-lg"><Plus size={14} className="inline mr-1" /> Ajouter</button>
            </form>
            <div className="space-y-2 max-h-[350px] overflow-y-auto">
              {sources.map(s => (
                <div key={s._id} className="flex justify-between items-center bg-[#070B14] border border-slate-800 p-2.5 rounded-lg group">
                  <div className="truncate"><p className="text-xs font-bold">{s.nom}</p></div>
                  <button className="text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}