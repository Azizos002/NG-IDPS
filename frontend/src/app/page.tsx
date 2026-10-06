"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation"; // Pour la redirection vers la page des incidents
import { Shield, Server, AlertOctagon, Clock, Activity, TrendingUp, AlertTriangle, X, ExternalLink, GraduationCap, BrainCircuit, Cloud, Cpu, FileCheck2, Zap } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { io } from "socket.io-client";

import DailyBriefingModal from "@/components/DailyBriefingModal";

interface ThreatData {
    name: string;
    value: number;
    color: string;
}

interface TrendData {
    day: string;
    suricata: number;
    ml_ia: number;
}

const JOURS_SEMAINE = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const COULEURS_DONUT = ["#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#10b981", "#ec4899"];

export default function DashboardOverview() {
    const router = useRouter();

    // États dynamiques globaux
    const [totalIncidents, setTotalIncidents] = useState<number>(0);
    const [activeNodesCount, setActiveNodesCount] = useState<string>("0 / 3");
    const [globalStatus, setGlobalStatus] = useState<string>("SÉCURISÉ");
    const [statusColor, setStatusColor] = useState<string>("text-cyan-500 bg-cyan-950/50 border-cyan-900/50");
    const [avgConfidence, setAvgConfidence] = useState<string>("0.0");
    const [autoRemediation, setAutoRemediation] = useState<{ rate: string; auto: number; blocked: number }>({ rate: "—", auto: 0, blocked: 0 });
    // --- Nouveaux panneaux de synthèse (Sprints 4, 5, 6) ---
    const [ctiPendingCount, setCtiPendingCount] = useState<number>(0);
    const [providerStats, setProviderStats] = useState<{ gemini: number; mistral: number; ollama: number }>({ gemini: 0, mistral: 0, ollama: 0 });
    const [formationStats, setFormationStats] = useState<{ total: number; avgScore: number; passRate: number }>({ total: 0, avgScore: 0, passRate: 0 });

    // États dynamiques pour les Graphiques
    const [attackTrends, setAttackTrends] = useState<TrendData[]>([]);
    const [threatDistribution, setThreatDistribution] = useState<ThreatData[]>([]);

    // --- ÉTATS & REFS POUR LA NOTIFICATION ACTIVE ---
    const [isAlerting, setIsAlerting] = useState<boolean>(false);
    const [latestThreatName, setLatestThreatName] = useState<string>("");
    const blinkIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Fonction de déclenchement de l'Alerte (Son + Titre + Banner)
    const triggerActiveAlert = (incidentName: string) => {
        setIsAlerting(true);
        setLatestThreatName(incidentName);

        // 1. Jouer un son (Nécessite un fichier alert.mp3 dans le dossier public/ de Next.js)
        try {
            const audio = new Audio('/alert.mp3');
            audio.play().catch(e => console.log("Le son est bloqué par le navigateur (interaction requise)."));
        } catch (error) { }

        // 2. Faire clignoter l'onglet (Tab Blinking)
        if (!blinkIntervalRef.current) {
            let isRed = false;
            blinkIntervalRef.current = setInterval(() => {
                document.title = isRed ? "Dashboard SOC | PFE" : "🚨 ALERTE CRITIQUE 🚨";
                isRed = !isRed;
            }, 1000);
        }
    };

    // Fonction pour fermer la notification et arrêter le clignotement
    const dismissAlert = () => {
        setIsAlerting(false);
        if (blinkIntervalRef.current) {
            clearInterval(blinkIntervalRef.current);
            blinkIntervalRef.current = null;
        }
        document.title = "Dashboard SOC | PFE"; // Restaure le titre original
    };

    const getCookie = (name: string) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop()?.split(';').shift();
        return "";
    };

    const fetchDashboardData = async () => {
        const currentHost = window.location.hostname;
        const backendUrl = `http://${currentHost}:4000`;

        try {
            // 1. Appel des incidents depuis MongoDB (collection soarcases)
            const resIncidents = await fetch(`${backendUrl}/api/incidents`);
            const incidents = await resIncidents.json();

            if (Array.isArray(incidents)) {
                setTotalIncidents(incidents.length);

                // --- KPI: CALCUL DYNAMIQUE DU SCORE DE CONFIANCE MOYEN ---
                if (incidents.length > 0) {
                    const totalScore = incidents.reduce((acc: number, inc: any) => acc + (inc.aiConfidenceScore || 0), 0);
                    const avg = (totalScore / incidents.length).toFixed(1);
                    setAvgConfidence(avg);
                }

                // --- KPI: CALCUL DYNAMIQUE DU TEMPS DE RÉPONSE MOYEN ---
                // Basé sur duree_generation_sec, mesuré réellement à chaque incident
                // (agent_ia.py / bypass Zero Trust) -- remplace l'ancienne valeur
                // statique "< 1.5s" codée en dur.
                const bloques = incidents.filter((inc: any) => {
                    const s = inc.caseStatus || "";
                    return s.includes("Bannie") || s.includes("Auto-bloqué");
                });
                const automatiques = bloques.filter((inc: any) => (inc.caseStatus || "").includes("Auto"));
                setAutoRemediation({
                    rate: bloques.length > 0 ? `${Math.round((automatiques.length / bloques.length) * 100)}%` : "—",
                    auto: automatiques.length,
                    blocked: bloques.length,
                });

                // --- MISE À JOUR DU STATUT GLOBAL ---
                // Critique = incident NON résolu (ni bloqué, ni écarté) et grave.
                const criticalUnresolved = incidents.filter((inc: any) => {
                    const s = inc.caseStatus || "";
                    const resolu = s.includes("Bannie") || s.includes("Résolu") ||
                        s.includes("Faux Positif") || s.includes("Ignoré") || s.includes("Protégée");
                    return !resolu && (s === "Ouvert" || s.includes("Action requise") || (inc.aiConfidenceScore || 0) > 90);
                });

                if (criticalUnresolved.length > 0) {
                    setGlobalStatus("MENACE CRITIQUE");
                    setStatusColor("text-red-500 bg-red-950/50 border-red-900/50 animate-pulse");
                } else {
                    setGlobalStatus("SÉCURISÉ");
                    setStatusColor("text-cyan-500 bg-cyan-950/50 border-cyan-900/50");
                }

                // --- CALCUL DYNAMIQUE DU DONUT ---
                // --- CALCUL DYNAMIQUE DU DONUT (AVEC NORMALISATION IA) ---
                const categoryCount: Record<string, number> = {};

                // Fonction pour regrouper les mots-clés de l'IA en catégories propres
                const normaliserMenace = (menaceBrute: string) => {
                    const texte = menaceBrute.toLowerCase();
                    if (texte.includes("spamhaus") || texte.includes("spam") || texte.includes("drop listed")) return "Trafic Malveillant (Spamhaus/Blacklist)";
                    if (texte.includes("ddos") || texte.includes("flood") || texte.includes("déni de service")) return "Déni de Service (DDoS / Flood)";
                    if (texte.includes("escalade") || texte.includes("privilege") || texte.includes("access")) return "Tentative d'Escalade de Privilèges";
                    if (texte.includes("latéral") || texte.includes("lateral")) return "Mouvement Latéral (Zero Trust)";
                    if (texte.includes("spoof") || texte.includes("usurpation")) return "Usurpation d'IP (Spoofing)";
                    if (texte.includes("injection") || texte.includes("lfi") || texte.includes("cve")) return "Exploitation Web (CVE / Injection)";
                    return "Autre Menace Suspecte";
                };

                incidents.forEach((inc: any) => {
                    const rawThreat = inc.threatType || "Menace Inconnue";
                    const catName = normaliserMenace(rawThreat); // On applique le filtre ici !
                    categoryCount[catName] = (categoryCount[catName] || 0) + 1;
                });

                const dynamicThreats = Object.entries(categoryCount)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, count], index) => ({
                        name: name.length > 25 ? name.substring(0, 25) + "..." : name,
                        value: count,
                        color: COULEURS_DONUT[index % COULEURS_DONUT.length]
                    }));
                setThreatDistribution(dynamicThreats.length > 0 ? dynamicThreats : [{ name: "Aucune menace", value: 1, color: "#1e293b" }]);

                // --- CALCUL DYNAMIQUE DE L'AREA CHART ---
                const trendsMap: Record<string, TrendData> = {
                    "Lun": { day: "Lun", suricata: 0, ml_ia: 0 },
                    "Mar": { day: "Mar", suricata: 0, ml_ia: 0 },
                    "Mer": { day: "Mer", suricata: 0, ml_ia: 0 },
                    "Jeu": { day: "Jeu", suricata: 0, ml_ia: 0 },
                    "Ven": { day: "Ven", suricata: 0, ml_ia: 0 },
                    "Sam": { day: "Sam", suricata: 0, ml_ia: 0 },
                    "Dim": { day: "Dim", suricata: 0, ml_ia: 0 },
                };

                incidents.forEach((inc: any) => {
                    const dateVal = inc.timestamp || inc.createdAt;
                    if (!dateVal) return;

                    const date = new Date(dateVal);
                    const dayName = JOURS_SEMAINE[date.getDay()];

                    if (trendsMap[dayName]) {
                        const source = (inc.sourceSensor || "").toLowerCase();
                        if (source.includes('suricata')) {
                            trendsMap[dayName].suricata += 1;
                        } else {
                            trendsMap[dayName].ml_ia += 1;
                        }
                    }
                });

                const orderedDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
                setAttackTrends(orderedDays.map(d => trendsMap[d]));
            }

            // 2. Appel de l'état des nœuds
            const resVms = await fetch(`${backendUrl}/api/vms`);
            const vms = await resVms.json();
            if (Array.isArray(vms)) {
                const onlineCount = vms.filter((vm: any) => vm.nodeStatus === "Online").length;
                setActiveNodesCount(`${onlineCount} / ${vms.length}`);
            }

        } catch (error) {
            console.error("[-] Erreur lors de la récupération des métriques :", error);
        }
    };

    const fetchSystemPulse = async () => {
        const currentHost = window.location.hostname;
        const backendUrl = `http://${currentHost}:4000`;

        try {
            // 1. Renseignement CTI en attente + répartition par palier de résilience IA
            const resCti = await fetch(`${backendUrl}/api/cti-actualities`);
            const ctiNews = await resCti.json();

            if (Array.isArray(ctiNews)) {
                const enAttente = ctiNews.filter((a: any) => a.status === "PENDING" || a.status === "PENDING_FORMATION").length;
                setCtiPendingCount(enAttente);

                const stats = { gemini: 0, mistral: 0, ollama: 0 };
                ctiNews.forEach((a: any) => {
                    const provider = a.formation_data?._meta_provider || "";
                    if (provider.startsWith("gemini")) stats.gemini += 1;
                    else if (provider.startsWith("mistral")) stats.mistral += 1;
                    else if (provider.startsWith("ollama") || provider.includes("llama")) stats.ollama += 1;
                });
                setProviderStats(stats);
            }

            // 2. Conformité des formations (nécessite le jeton RSSI)
            const token = getCookie("soc_token");
            if (token) {
                const resFormations = await fetch(`${backendUrl}/api/formations/records`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (resFormations.ok) {
                    const records = await resFormations.json();
                    if (Array.isArray(records) && records.length > 0) {
                        const avgScore = records.reduce((acc: number, r: any) => acc + (r.score || 0), 0) / records.length;
                        const passRate = (records.filter((r: any) => r.score >= 70).length / records.length) * 100;
                        setFormationStats({ total: records.length, avgScore: Math.round(avgScore), passRate: Math.round(passRate) });
                    }
                }
            }
        } catch (error) {
            console.error("[-] Erreur lors de la récupération du pouls système :", error);
        }
    };

    useEffect(() => {
        // Définir le titre initial du document
        document.title = "Dashboard SOC | PFE";

        const currentHost = window.location.hostname;
        const backendUrl = `http://${currentHost}:4000`;

        fetchDashboardData();
        fetchSystemPulse();

        const socket = io(backendUrl);

        // Réception d'un nouvel incident en direct
        socket.on("new_incident", (incidentData) => {
            fetchDashboardData();
            // Déclenche l'alerte in-app avec le nom de l'incident reçu (ou valeur par défaut)
            const alertName = incidentData?.threatType || incidentData?.category || "Trafic Malveillant Détecté";
            triggerActiveAlert(alertName);
        });

        socket.on("dashboard_update", () => {
            fetchDashboardData();
        });

        return () => {
            socket.disconnect();
            if (blinkIntervalRef.current) clearInterval(blinkIntervalRef.current);
        };
    }, []);

    return (

        <div className="w-full max-w-screen-2xl mx-auto space-y-8 relative">
            {/* LE MODAL DAILY BRIEFING EST INJECTÉ ICI */}
            <DailyBriefingModal />
            {/* --- PANNEAU DE NOTIFICATION CRITIQUE IN-APP --- */}
            {isAlerting && (
                <div className="fixed top-20 right-8 z-50 bg-slate-900 border-2 border-red-500 rounded-xl shadow-2xl shadow-red-900/20 p-5 min-w-[350px] transform transition-all animate-in slide-in-from-right-10 duration-300">
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-red-500/20 rounded-full animate-pulse">
                                <AlertTriangle className="text-red-500" size={24} />
                            </div>
                            <h3 className="font-bold text-red-500 text-lg">Action Requise</h3>
                        </div>
                        <button onClick={dismissAlert} className="text-slate-400 hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                    <p className="text-slate-300 text-sm mb-4">
                        Une nouvelle menace a été interceptée par le SOAR :<br />
                        <strong className="text-white">{latestThreatName}</strong>
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => {
                                dismissAlert();
                                router.push('/incidents'); // Redirection vers la page SOAR
                            }}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 px-4 rounded flex items-center justify-center gap-2 transition-colors"
                        >
                            Ouvrir SOAR <ExternalLink size={16} />
                        </button>
                        <button
                            onClick={dismissAlert}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold py-2 px-4 rounded border border-slate-700 transition-colors"
                        >
                            Ignorer
                        </button>
                    </div>
                </div>
            )}

            {/* En-tête */}
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
                        <Activity className="text-cyan-500" size={32} />
                        Vue d'ensemble du SOC
                    </h1>
                    <p className="text-slate-400 mt-2">Métriques de Cyberdéfense Active et Télémétrie Globale</p>
                </div>
                <div className="text-right">
                    <p className={`text-sm font-mono px-3 py-1 rounded border ${statusColor} transition-colors duration-500`}>
                        Statut Global: {globalStatus}
                    </p>
                </div>
            </div>

            {/* Cartes KPI */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg relative overflow-hidden">
                    {/* Effet rouge subtil derrière la carte si alerte */}
                    {isAlerting && <div className="absolute inset-0 bg-red-500/5 animate-pulse pointer-events-none"></div>}
                    <div className="flex justify-between items-start relative z-10">
                        <div>
                            <p className="text-sm font-semibold text-slate-400">Total Incidents</p>
                            <h3 className="text-3xl font-bold text-slate-100 mt-2">{totalIncidents}</h3>
                        </div>
                        <div className={`p-3 rounded-lg ${isAlerting ? 'bg-red-500/30' : 'bg-red-500/10'}`}>
                            <AlertOctagon className={isAlerting ? "text-red-400 animate-bounce" : "text-red-500"} size={24} />
                        </div>
                    </div>
                    <p className="text-xs text-red-400 mt-4 flex items-center gap-1 font-medium relative z-10">
                        <TrendingUp size={14} /> SOAR Cases (MongoDB)
                    </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-sm font-semibold text-slate-400">Confiance IA Moyenne</p>
                            <h3 className="text-3xl font-bold text-slate-100 mt-2">{avgConfidence}%</h3>
                        </div>
                        <div className="p-3 bg-cyan-500/10 rounded-lg">
                            <Shield className="text-cyan-500" size={24} />
                        </div>
                    </div>
                    <p className="text-xs text-cyan-400 mt-4 flex items-center gap-1 font-medium">
                        Score Llama 3 &amp; LSTM-VAE
                    </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-sm font-semibold text-slate-400">Remédiation Automatique</p>
                            <h3 className="text-3xl font-bold text-slate-100 mt-2">{autoRemediation.rate}</h3>
                        </div>
                        <div className="p-3 bg-green-500/10 rounded-lg">
                            <Zap className="text-green-500" size={24} />
                        </div>
                    </div>
                    <p className="text-xs text-green-400 mt-4 flex items-center gap-1 font-medium">
                        {autoRemediation.auto} / {autoRemediation.blocked} blocages sans intervention
                    </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-sm font-semibold text-slate-400">Nœuds Actifs</p>
                            <h3 className="text-3xl font-bold text-slate-100 mt-2">{activeNodesCount}</h3>
                        </div>
                        <div className="p-3 bg-purple-500/10 rounded-lg">
                            <Server className="text-purple-500" size={24} />
                        </div>
                    </div>
                    <p className="text-xs text-purple-400 mt-4 flex items-center gap-1 font-medium">
                        Suricata, ML Engine &amp; Response
                    </p>
                </div>
            </div>

            {/* Section Graphiques */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-8">
                {/* Graphique principal : Tendance */}
                <div className="xl:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col">
                    <h3 className="text-lg font-bold text-slate-200 mb-6">Volume d'Attaques (Répartition Hebdomadaire)</h3>
                    <div className="flex-1 min-h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={attackTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorSuricata" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorML" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                <XAxis dataKey="day" stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                                    itemStyle={{ color: '#e2e8f0' }}
                                />
                                <Area type="monotone" dataKey="suricata" name="Signatures Suricata" stroke="#f59e0b" fillOpacity={1} fill="url(#colorSuricata)" />
                                <Area type="monotone" dataKey="ml_ia" name="Détections ML & Zero Trust" stroke="#ef4444" fillOpacity={1} fill="url(#colorML)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Graphique secondaire : Donut */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                    <h3 className="text-lg font-bold text-slate-200 mb-6">Typologie des Menaces (SOAR)</h3>
                    <div className="h-[250px] w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={threatDistribution}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={90}
                                    paddingAngle={5}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    {threatDistribution.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                                    itemStyle={{ color: '#e2e8f0' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        {/* Centre du Donut */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                            <span className="text-3xl font-bold text-slate-100">{totalIncidents}</span>
                            <span className="text-xs text-slate-500">Alertes</span>
                        </div>
                    </div>
                    {/* Légende personnalisée Dynamique -- texte agrandi pour lisibilité */}
                    <div className="grid grid-cols-1 gap-2.5 mt-5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                        {threatDistribution.map((threat, index) => {
                            const pct = totalIncidents > 0 ? Math.round((threat.value / totalIncidents) * 100) : 0;
                            return (
                                <div key={index} className="flex items-center justify-between py-1">
                                    <div className="flex items-center gap-2.5 overflow-hidden">
                                        <div className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: threat.color }}></div>
                                        <span className="text-sm text-slate-200 font-medium truncate" title={threat.name}>{threat.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <span className="text-xs text-slate-500">{pct}%</span>
                                        <span className="text-sm font-bold text-slate-100 bg-slate-800 px-2.5 py-1 rounded-full min-w-[2.5rem] text-center">{threat.value}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Section Pouls du Système : relie CTI, Formation et Résilience IA */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">

                {/* Panneau 1 : Chaîne de Résilience IA */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                    <h3 className="text-base font-bold text-slate-200 mb-5 flex items-center gap-2">
                        <BrainCircuit className="text-indigo-400" size={20} />
                        Chaîne de Résilience IA
                    </h3>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-sm text-slate-300"><Cloud size={16} className="text-cyan-400" /> Gemini (Palier 1)</span>
                            <span className="text-base font-bold text-slate-100">{providerStats.gemini}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-sm text-slate-300"><Cloud size={16} className="text-amber-400" /> Mistral (Palier 2)</span>
                            <span className="text-base font-bold text-slate-100">{providerStats.mistral}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-sm text-slate-300"><Cpu size={16} className="text-rose-400" /> Ollama local (Palier 3)</span>
                            <span className="text-base font-bold text-slate-100">{providerStats.ollama}</span>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-5 pt-4 border-t border-slate-800">
                        Répartition des générations IA par fournisseur effectif
                    </p>
                </div>

                {/* Panneau 2 : Renseignement CTI en attente */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col">
                    <h3 className="text-base font-bold text-slate-200 mb-5 flex items-center gap-2">
                        <FileCheck2 className="text-purple-400" size={20} />
                        Veille CTI
                    </h3>
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <span className="text-5xl font-black text-slate-100">{ctiPendingCount}</span>
                        <span className="text-sm text-slate-400 mt-2">bulletin(s) en attente de validation</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-5 pt-4 border-t border-slate-800">
                        Règles Suricata et contenus de sensibilisation à réviser
                    </p>
                </div>

                {/* Panneau 3 : Conformité Formation */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
                    <h3 className="text-base font-bold text-slate-200 mb-5 flex items-center gap-2">
                        <GraduationCap className="text-emerald-400" size={20} />
                        Conformité Formation
                    </h3>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Modules complétés</span>
                            <span className="text-base font-bold text-slate-100">{formationStats.total}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Score moyen</span>
                            <span className="text-base font-bold text-slate-100">{formationStats.avgScore}%</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-300">Taux de réussite (≥70%)</span>
                            <span className={`text-base font-bold ${formationStats.passRate >= 50 ? "text-emerald-400" : "text-amber-400"}`}>{formationStats.passRate}%</span>
                        </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-5 pt-4 border-t border-slate-800">
                        Sensibilisation post-incident des collaborateurs (Sprint 5)
                    </p>
                </div>
            </div>
        </div>
    );
}