"use client";

import { useState, useEffect, useRef } from "react";
import { GraduationCap, BookOpen, Activity, CheckSquare, Mail, Users, Shield, Clock, ChevronRight, CheckCircle, XCircle, Lock } from "lucide-react";
import mermaid from "mermaid";

// ============================================================================
// COMPOSANT : LECTEUR MERMAID.JS (Rendu interactif des cinématiques d'attaque)
// ============================================================================
const MermaidDiagram = ({ chart }: { chart: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: true, theme: 'dark', background: 'transparent' });
    if (containerRef.current && chart) {
      containerRef.current.innerHTML = '';
      mermaid.render(`mermaid-${Math.random().toString(36).substr(2, 9)}`, chart)
        .then(({ svg }) => {
          if (containerRef.current) containerRef.current.innerHTML = svg;
        })
        .catch(e => console.error("Erreur Mermaid :", e));
    }
  }, [chart]);

  return <div ref={containerRef} className="flex justify-center overflow-x-auto py-6" />;
};

// ============================================================================
// PAGE PRINCIPALE : HUB DE FORMATION
// ============================================================================
export default function FormationsPage() {
  const [formations, setFormations] = useState<any[]>([]);
  const [activeFormation, setActiveFormation] = useState<any | null>(null);

  // États interactifs du Quiz et de l'Email
  const [quizState, setQuizState] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"IDLE" | "SUCCESS" | "ERROR">("IDLE");

  // Nouveaux états pour le ciblage par département
  const [departements, setDepartements] = useState<string[]>([]);
  const [targetType, setTargetType] = useState<string>("ALL");
  const [targetValue, setTargetValue] = useState<string>("");


  // Récupération des données depuis le backend Node.js
  const fetchFormations = async () => {
    try {
      const currentHost = window.location.hostname;
      const response = await fetch(`http://${currentHost}:4000/api/cti-actualities`);
      if (response.ok) {
        const data = await response.json();

        // CORRECTION : On récupère tout ce qui contient des données de formation
        const generatedFormations = data.filter(
          (act: any) => act.status === "FORMATION_GENERATED" || act.formation_data != null
        );

        setFormations(generatedFormations);

        // VÉRIFICATION DU LIEN E-MAIL (Mode Isolation Étudiant)
        let isDirectLink = false;
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          const courseId = params.get("courseId");
          if (courseId) {
            setIsStudentMode(true);
            isDirectLink = true;
            const targetCourse = generatedFormations.find((f: any) => f._id === courseId);
            if (targetCourse) setActiveFormation(targetCourse);
          }
        }

        if (!isDirectLink && generatedFormations.length > 0 && !activeFormation) {
          setActiveFormation(generatedFormations[0]);
        }
      }
    } catch (error) {
      console.error("Erreur de récupération des formations :", error);
    }
  };

  useEffect(() => {
    fetchFormations();

    const storedUser = localStorage.getItem("soc_user");
    if (storedUser) {
      const user = JSON.parse(storedUser);
      if (user.role === "RSSI") setIsAdmin(true); // Seul le RSSI a le pouvoir
    }

    // Récupération des départements depuis le fichier employes.json du backend
    const currentHost = window.location.hostname;
    fetch(`http://${currentHost}:4000/api/employes`)
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          setDepartements(Object.keys(data));
        }
      })
      .catch(err => console.error("Erreur chargement départements :", err));
  }, []);

  // Gestion du changement de cours
  const handleSelectFormation = (formation: any) => {
    setActiveFormation(formation);
    setQuizState({});
    setQuizSubmitted(false);
    setEmailStatus("IDLE");
  };




  // Calcul du score en direct
  const calculateQuizScore = () => {
    if (!activeFormation || !activeFormation.formation_data?.quiz) return 0;
    let score = 0;
    activeFormation.formation_data.quiz.forEach((q: any, idx: number) => {
      if (quizState[idx] === q.reponse_correcte) score += 1;
    });
    return Math.round((score / activeFormation.formation_data.quiz.length) * 100);
  };

  // Fonction de diffusion (Connectée à Nodemailer)
  const handleDistribute = async () => {
    if (!activeFormation) return;
    setSendingEmail(true);

    // 1. Récupération du token depuis les cookies du navigateur
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop()?.split(';').shift();
      return "";
    };
    const token = getCookie("soc_token");

    try {
      const currentHost = window.location.hostname;
      const response = await fetch(`http://${currentHost}:4000/api/formations/distribute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 2. On injecte le token dans l'en-tête d'autorisation !
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          rule_id: activeFormation._id,
          formation_data: activeFormation.formation_data,
          targetType: targetType,
          targetValue: targetValue
        }),
      });

      if (response.ok) {
        setSendingEmail(false);
        setEmailStatus("SUCCESS");
        setTimeout(() => setEmailStatus("IDLE"), 4000);
      } else {
        // Optionnel: Gérer l'erreur 401 si le token a expiré
        if (response.status === 401 || response.status === 403) {
          alert("Erreur de sécurité : Session expirée ou privilèges insuffisants.");
        }
        throw new Error("Échec de l'envoi");
      }
    } catch (error) {
      console.error("Erreur lors de la diffusion :", error);
      setSendingEmail(false);
      setEmailStatus("ERROR");
      setTimeout(() => setEmailStatus("IDLE"), 4000);
    }
  };

  // --- NOUVEAU : Authentification de l'employé pour déverrouiller le cours ---
  const [employeeAuth, setEmployeeAuth] = useState<any>(null);
  const [employeeIdInput, setEmployeeIdInput] = useState("");
  const [authError, setAuthError] = useState("");

  // --- NOUVEAU : Progression type Coursera (Step-by-step) ---
  const [isStudentMode, setIsStudentMode] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // --- NOUVEAU : Contrôle des rôles (RBAC) ---
  const [isAdmin, setIsAdmin] = useState(false);

  // --- NOUVEAU : États pour le tableau de bord des scores ---
  const [viewMode, setViewMode] = useState<"CATALOGUE" | "SUIVI">("CATALOGUE");
  const [records, setRecords] = useState<any[]>([]);

  const fetchRecords = async () => {
    try {
      const getCookie = (name: string) => {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop()?.split(';').shift();
        return "";
      };
      const token = getCookie("soc_token");
      const currentHost = window.location.hostname;
      const response = await fetch(`http://${currentHost}:4000/api/formations/records`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (response.ok) setRecords(await response.json());
    } catch (error) {
      console.error("Erreur lecture records :", error);
    }
  };

  useEffect(() => {
    if (viewMode === "SUIVI") fetchRecords();
  }, [viewMode]);

  const handleEmployeeLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const currentHost = window.location.hostname;
      const response = await fetch(`http://${currentHost}:4000/api/employes/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_employe: employeeIdInput }),
      });
      const data = await response.json();
      if (data.success) {
        setEmployeeAuth(data.employe);
      } else {
        setAuthError(data.error);
      }
    } catch (err) {
      setAuthError("Erreur de connexion au serveur.");
    }
  };

  // Soumission du score au backend
  const handleValidateQuiz = async () => {
    setQuizSubmitted(true);
    const finalScore = calculateQuizScore();

    try {
      const currentHost = window.location.hostname;
      await fetch(`http://${currentHost}:4000/api/formations/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: activeFormation._id,
          courseTitle: activeFormation.formation_data?.titre_cours || activeFormation.titre_menace,
          employeeId: employeeAuth.id_employe,
          employeeName: employeeAuth.nom,
          department: employeeAuth.poste,
          score: finalScore
        })
      });
    } catch (error) {
      console.error("Erreur lors de l'envoi du score :", error);
    }
  };

  return (
    <div className={`p-4 md:p-8 min-h-screen bg-[#070B14] text-slate-200 font-sans flex flex-col h-screen overflow-hidden ${isStudentMode ? 'fixed inset-0 z-[100]' : ''}`}>
      {/* 1. EN-TÊTE DU LMS */}
      <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-800/80 shrink-0">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-purple-600/10 border border-purple-500/30 rounded-xl shadow-[0_0_20px_rgba(168,85,247,0.15)]">
            <GraduationCap className="text-purple-400" size={32} />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-100 tracking-tight flex items-center gap-3">
              Hub de Formation Continue (LMS)
            </h1>
            <p className="text-slate-400 text-xs mt-1 font-medium">
              Modules de Micro-Learning générés par IA pour la sensibilisation des collaborateurs
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-1">
          {!isStudentMode && isAdmin ? (
            <>
              <button
                onClick={() => setViewMode("CATALOGUE")}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${viewMode === "CATALOGUE" ? "bg-purple-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                <BookOpen size={14} /> {formations.length} MODULE(S)
              </button>
              <button
                onClick={() => setViewMode("SUIVI")}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 ${viewMode === "SUIVI" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                <Users size={14} /> SUIVI EMPLOYÉS
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 px-4 py-1.5">
              <BookOpen size={16} className="text-purple-400" />
              <span className="text-xs font-bold text-slate-300">{formations.length} MODULE(S)</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. CORPS PRINCIPAL (SPLIT VIEW) */}
      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">

        {/* --- MENU LATÉRAL : LISTE DES COURS --- */}
        {!isStudentMode && isAdmin && (
          <div className="w-full lg:w-1/3 xl:w-1/4 bg-[#0D1527] border border-slate-800/80 rounded-2xl p-4 flex flex-col shadow-xl shrink-0">
            {/* Garde tout le contenu de ton menu latéral ici */}
            <h2 className="text-xs font-black tracking-widest text-slate-500 uppercase mb-4 px-2 border-b border-slate-800 pb-2">
              Catalogue des Menaces
            </h2>
            <div className="space-y-3 overflow-y-auto custom-scrollbar flex-1 pr-2">
              {formations.length === 0 ? (
                <p className="text-sm text-slate-500 text-center mt-10">Aucun module généré pour le moment.</p>
              ) : (
                formations.map((form) => {
                  const isActive = activeFormation?._id === form._id;
                  return (
                    <button
                      key={form._id}
                      onClick={() => handleSelectFormation(form)}
                      className={`w-full text-left p-4 rounded-xl transition-all border ${isActive
                        ? "bg-purple-900/20 border-purple-500/50 shadow-lg"
                        : "bg-[#070B14] border-slate-800 hover:border-slate-600 hover:bg-slate-900/50"
                        }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isActive ? "bg-purple-500/20 text-purple-300" : "bg-slate-800 text-slate-400"}`}>
                          MICRO-LEARNING
                        </span>
                        <ChevronRight size={14} className={isActive ? "text-purple-400" : "text-slate-600"} />
                      </div>
                      <h3 className={`text-sm font-bold truncate leading-tight ${isActive ? "text-slate-100" : "text-slate-300"}`}>
                        {form.formation_data?.titre_cours || form.titre_menace}
                      </h3>
                      <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1.5">
                        <Clock size={11} /> Généré le {new Date(form.last_updated).toLocaleDateString()}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* --- ZONE PRINCIPALE : LECTEUR DU COURS --- */}
        <div className={`w-full ${isStudentMode ? "lg:w-full xl:w-full" : "lg:w-2/3 xl:w-3/4"} bg-[#0B1120] border border-slate-800/80 rounded-2xl flex flex-col shadow-xl overflow-hidden relative transition-all duration-300`}>

          {/* DÉBUT DE LA NOUVELLE CONDITION */}
          {viewMode === "SUIVI" && !isStudentMode ? (
            <div className="p-8 h-full flex flex-col animate-in fade-in duration-300">
              <h2 className="text-2xl font-black text-slate-100 mb-6 flex items-center gap-3">
                <Users className="text-emerald-400" /> Registre de Conformité (Auditing)
              </h2>
              <div className="bg-[#050810] border border-slate-800 rounded-xl flex-1 overflow-hidden flex flex-col">
                <div className="overflow-y-auto flex-1 p-4 custom-scrollbar">
                  <table className="w-full text-left text-sm text-slate-300">
                    <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Employé</th>
                        <th className="px-4 py-3">Département</th>
                        <th className="px-4 py-3">Module de Formation</th>
                        <th className="px-4 py-3 text-center">Score</th>
                        <th className="px-4 py-3 text-right">Date de Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.length === 0 ? (
                        <tr><td colSpan={5} className="text-center py-8 text-slate-500 font-medium">Aucun résultat enregistré pour le moment.</td></tr>
                      ) : (
                        records.map((rec) => (
                          <tr key={rec._id} className="border-b border-slate-800/50 hover:bg-slate-900/30">
                            <td className="px-4 py-4 font-bold text-slate-200">{rec.employeeName} <br /><span className="text-[10px] text-slate-500 font-normal">{rec.employeeId}</span></td>
                            <td className="px-4 py-4 text-xs">{rec.department}</td>
                            <td className="px-4 py-4 text-xs font-semibold text-purple-300">{rec.courseTitle}</td>
                            <td className="px-4 py-4 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-bold ${rec.score >= 80 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                {rec.score}%
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right text-xs text-slate-500">{new Date(rec.completedAt).toLocaleDateString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : activeFormation ? (
            <>
              {/* Lueur d'ambiance */}
              < div className="absolute top-0 right-0 w-[500px] h-[500px] bg-purple-600/5 rounded-full blur-[100px] pointer-events-none"></div>

              {/* Header du Cours Actif */}
              <div className="p-6 md:p-8 border-b border-slate-800 bg-slate-900/30 z-10 flex flex-col md:flex-row md:items-start justify-between gap-6 shrink-0">
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-slate-100 mb-2 leading-tight">
                    {activeFormation.formation_data?.titre_cours}
                  </h2>
                  <p className="text-sm text-slate-400 flex items-center gap-2">
                    Basé sur l'alerte : <span className="text-purple-400 font-semibold">{activeFormation.titre_menace}</span>
                  </p>
                </div>

                {/* Sélecteur de ciblage & Bouton de Diffusion Email (Invisible pour l'étudiant) */}
                {!isStudentMode && (
                  <div className="shrink-0 flex flex-col items-end gap-3">
                    {/* Garde tout le contenu de la div des selecteurs et du bouton handleDistribute ici */}
                    <div className="flex items-center gap-2 bg-[#070B14] border border-slate-800 p-1.5 rounded-xl">
                      <select
                        value={targetType}
                        onChange={(e) => {
                          setTargetType(e.target.value);
                          if (e.target.value === "ALL") setTargetValue("");
                        }}
                        className="bg-slate-900 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 focus:outline-none focus:border-purple-500"
                      >
                        <option value="ALL">Toute l'entreprise</option>
                        <option value="DEPARTEMENT">Par Département</option>
                      </select>

                      {targetType === "DEPARTEMENT" && (
                        <select
                          value={targetValue}
                          onChange={(e) => setTargetValue(e.target.value)}
                          className="bg-slate-900 text-purple-300 text-xs font-semibold px-3 py-1.5 rounded-lg border border-purple-500/50 focus:outline-none"
                        >
                          <option value="">-- Choisir --</option>
                          {departements.map((dep) => (
                            <option key={dep} value={dep}>{dep}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    <button
                      onClick={handleDistribute}
                      disabled={sendingEmail || emailStatus === "SUCCESS" || (targetType === "DEPARTEMENT" && !targetValue)}
                      className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold transition-all shadow-lg disabled:opacity-50 ${emailStatus === "SUCCESS" ? "bg-emerald-600 text-white" :
                        emailStatus === "ERROR" ? "bg-rose-600 text-white" :
                          "bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                        }`}
                    >
                      {sendingEmail ? <><Activity size={16} className="animate-spin" /> PRÉPARATION ENVOI...</> :
                        emailStatus === "SUCCESS" ? <><CheckCircle size={16} /> CAMPAGNE DIFFUSÉE</> :
                          <><Mail size={16} /> DIFFUSER AUX COLLABORATEURS</>}
                    </button>

                    <p className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Users size={12} /> Via SMTP (Nodemailer) - Annuaire Active Directory Local
                    </p>
                  </div>
                )}
              </div>

              {/* Contenu Scrollable (Modules + Quiz) */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-12 z-10 custom-scrollbar">

                {!employeeAuth ? (
                  <div className="flex flex-col items-center justify-center p-12 border border-slate-800 rounded-2xl bg-slate-900/50 backdrop-blur-md relative overflow-hidden mt-8">
                    {/* Effet de bruit cinématique en CSS pur via SVG data URI */}
                    <div
                      className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none"
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
                      }}
                    ></div>
                    <Lock size={48} className="text-slate-500 mb-6" />
                    <h3 className="text-xl font-bold text-slate-200 mb-2">Accès Restreint</h3>
                    <p className="text-sm text-slate-400 text-center mb-8 max-w-md">
                      Veuillez saisir l'identifiant personnel reçu par e-mail pour déverrouiller ce module de formation.
                    </p>

                    <form onSubmit={handleEmployeeLogin} className="flex flex-col gap-4 w-full max-w-sm relative z-10">
                      <input
                        type="text"
                        value={employeeIdInput}
                        onChange={(e) => setEmployeeIdInput(e.target.value.toUpperCase())}
                        placeholder="Ex: EMP-FIN-001"
                        className="bg-[#050810] border border-slate-700 text-center text-slate-200 text-lg font-bold tracking-widest rounded-xl py-3 focus:border-purple-500 outline-none"
                      />
                      {authError && <span className="text-rose-500 text-xs font-bold text-center">{authError}</span>}
                      <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                        DÉVERROUILLER LE COURS
                      </button>
                    </form>
                  </div>
                ) : (
                  <>
                    {/* Message de bienvenue à l'employé */}
                    <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl flex items-center justify-between mb-8">
                      <div>
                        <p className="text-emerald-400 text-sm font-bold flex items-center gap-2">
                          <CheckCircle size={16} /> Identité vérifiée : {employeeAuth.nom}
                        </p>
                        <p className="text-slate-400 text-xs mt-1">Département : {employeeAuth.poste}</p>
                      </div>
                      <button onClick={() => setEmployeeAuth(null)} className="text-slate-500 hover:text-slate-300 text-xs font-bold underline">
                        Déconnexion
                      </button>
                    </div>
                    {/* --- MOTEUR DE PROGRESSION (STEP-BY-STEP LMS) --- */}
                    {(() => {
                      const hasDiagram = !!activeFormation.formation_data?.diagramme_mermaid;
                      const modulesCount = activeFormation.formation_data?.modules?.length || 0;
                      // Nombre d'étapes : Diagramme (Optionnel) + Tous les modules individuels + Quiz final
                      const totalSteps = (hasDiagram ? 1 : 0) + modulesCount + 1;
                      const stepDiagramIndex = hasDiagram ? 0 : -1;
                      const stepQuizIndex = totalSteps - 1;

                      return (
                        <div className="space-y-6 animate-fade-in">
                          {/* Barre de Progression Style Coursera */}
                          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl flex items-center justify-between mb-8 shadow-md">
                            <div className="flex-1 mr-8">
                              <div className="w-full bg-slate-800 rounded-full h-2 mb-3 overflow-hidden">
                                <div className="bg-purple-500 h-2 rounded-full transition-all duration-700 ease-out" style={{ width: `${((currentStep) / (totalSteps - 1)) * 100}%` }}></div>
                              </div>
                              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                                Progression du cours : Étape {currentStep + 1} sur {totalSteps}
                              </p>
                            </div>
                            <div className="text-purple-400 font-black text-2xl drop-shadow-[0_0_10px_rgba(168,85,247,0.4)]">
                              {Math.round(((currentStep) / (totalSteps - 1)) * 100)}%
                            </div>
                          </div>

                          {/* RENDU DYNAMIQUE DE L'ÉTAPE COURANTE */}

                          {/* 1. ÉTAPE DIAGRAMME */}
                          {currentStep === stepDiagramIndex && (
                            <section className="animate-in slide-in-from-right-4 duration-500">
                              <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest border-b border-slate-800 pb-2 mb-6 flex items-center gap-2">
                                <Shield size={16} className="text-cyan-400" /> Cinématique & Vecteur d'Attaque
                              </h3>
                              <div className="bg-[#050810] border border-slate-800/80 rounded-2xl p-6 shadow-inner overflow-hidden">
                                <MermaidDiagram chart={activeFormation.formation_data.diagramme_mermaid} />
                              </div>
                            </section>
                          )}

                          {/* 2. ÉTAPE MODULE INDIVIDUEL */}
                          {currentStep > stepDiagramIndex && currentStep < stepQuizIndex && (() => {
                            const modIdx = currentStep - (hasDiagram ? 1 : 0);
                            const mod = activeFormation.formation_data.modules[modIdx];
                            return (
                              <section className="animate-in slide-in-from-right-4 duration-500">
                                <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest border-b border-slate-800 pb-2 mb-6 flex items-center gap-2">
                                  <BookOpen size={16} className="text-purple-400" /> Chapitre d'apprentissage
                                </h3>
                                <div className="bg-slate-900/40 border border-purple-500/30 rounded-xl p-8 shadow-[0_0_30px_rgba(168,85,247,0.05)]">
                                  <h4 className="text-xl font-bold text-slate-100 mb-6 flex items-center gap-4">
                                    <span className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center text-lg">{modIdx + 1}</span>
                                    {mod.chapitre}
                                  </h4>
                                  <p className="text-base text-slate-300 leading-relaxed whitespace-pre-wrap">{mod.contenu}</p>
                                </div>
                              </section>
                            );
                          })()}

                          {/* 3. ÉTAPE QUIZ FINAL */}
                          {currentStep === stepQuizIndex && (
                            <section className="animate-in slide-in-from-right-4 duration-500">
                              <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest border-b border-slate-800 pb-2 mb-6 flex items-center gap-2">
                                <CheckSquare size={16} className="text-emerald-400" /> Évaluation Finale (Obligatoire)
                              </h3>

                              <div className="space-y-8">
                                {/* Garder exactement l'ancien code du Quiz ici */}
                                {activeFormation.formation_data?.quiz?.map((q: any, qIdx: number) => (
                                  <div key={qIdx} className="bg-[#050810] border border-slate-800 rounded-2xl p-6 md:p-8">
                                    <p className="text-base font-bold text-slate-200 mb-6 flex gap-3">
                                      <span className="text-slate-500">{qIdx + 1}.</span> {q.question}
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      {q.options.map((opt: string, optIdx: number) => {
                                        const isSelected = quizState[qIdx] === optIdx;
                                        const isCorrect = optIdx === q.reponse_correcte;
                                        let btnClass = "border-slate-700 bg-slate-900 hover:border-purple-500 hover:bg-slate-800 text-slate-300";
                                        let Icon = null;
                                        if (quizSubmitted) {
                                          if (isCorrect) {
                                            btnClass = "border-emerald-500 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]";
                                            Icon = <CheckCircle size={18} className="text-emerald-500" />;
                                          } else if (isSelected && !isCorrect) {
                                            btnClass = "border-rose-500 bg-rose-500/10 text-rose-400";
                                            Icon = <XCircle size={18} className="text-rose-500" />;
                                          } else {
                                            btnClass = "border-slate-800 bg-slate-900/30 text-slate-600 opacity-50";
                                          }
                                        } else if (isSelected) {
                                          btnClass = "border-purple-500 bg-purple-500/20 text-purple-300 shadow-md";
                                        }
                                        return (
                                          <button
                                            key={optIdx}
                                            disabled={quizSubmitted}
                                            onClick={() => setQuizState(prev => ({ ...prev, [qIdx]: optIdx }))}
                                            className={`w-full text-left px-5 py-4 rounded-xl border text-sm transition-all flex items-center justify-between ${btnClass}`}
                                          >
                                            <span>{opt}</span>
                                            {Icon && <span>{Icon}</span>}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <div className="mt-8 flex flex-col md:flex-row items-center justify-between bg-slate-900/80 border border-slate-700 p-6 md:p-8 rounded-2xl shadow-xl">
                                {quizSubmitted ? (
                                  <div className="text-center md:text-left mb-6 md:mb-0">
                                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Score Final de l'Évaluation</p>
                                    <p className={`text-4xl md:text-5xl font-black ${calculateQuizScore() >= 80 ? 'text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'text-amber-400'}`}>
                                      {calculateQuizScore()}%
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-sm text-slate-400 text-center md:text-left mb-6 md:mb-0">
                                    Sélectionnez une réponse pour chaque question afin de valider le module.
                                  </p>
                                )}
                                {!quizSubmitted && (
                                  <button
                                    onClick={handleValidateQuiz}
                                    disabled={Object.keys(quizState).length !== activeFormation.formation_data?.quiz?.length}
                                    className="w-full md:w-auto px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:opacity-50 disabled:shadow-none"
                                  >
                                    VÉRIFIER MES RÉPONSES & VALIDER LE COURS
                                  </button>
                                )}
                              </div>
                            </section>
                          )}

                          {/* NAVIGATION (Bouton SUIVANT) - Impossible de passer au quiz sans cliquer ici */}
                          {currentStep < stepQuizIndex && (
                            <div className="flex justify-end mt-8 border-t border-slate-800 pt-6">
                              <button
                                onClick={() => {
                                  setCurrentStep(prev => prev + 1);
                                  window.scrollTo({ top: 0, behavior: 'smooth' }); // Remonte automatiquement en haut
                                }}
                                className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-8 rounded-xl flex items-center gap-2 shadow-[0_0_15px_rgba(168,85,247,0.3)] transition-all"
                              >
                                ÉTAPE SUIVANTE <ChevronRight size={18} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Spacer pour le scroll */}
                    <div className="h-10"></div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8 text-center">
              <BookOpen size={48} className="mb-4 opacity-20" />
              <p className="text-lg font-semibold text-slate-400">Aucune formation sélectionnée</p>
              <p className="text-sm mt-2 max-w-md">
                Sélectionnez un module de Micro-Learning dans le menu latéral pour afficher son contenu pédagogique interactif.
              </p>
            </div>
          )}
        </div>
      </div >
    </div >
  );
}