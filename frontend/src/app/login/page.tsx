"use client";

import { useState } from "react";
import { Shield, User, Lock, Activity, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const currentHost = window.location.hostname;
      const res = await fetch(`http://${currentHost}:4000/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (data.success) {
        // GOD'S LEVEL : On stocke le token dans un Cookie sécurisé pour le Middleware
        document.cookie = `soc_token=${data.token}; path=/; max-age=28800; samesite=strict`;
        // Et on stocke le rôle en local pour l'interface
        localStorage.setItem("soc_user", JSON.stringify(data.user));
        
        router.push("/"); // Redirection vers le Dashboard après connexion
      } else {
        setError(data.error || "Échec de l'authentification.");
      }
    } catch (err) {
      setError("Serveur SOC injoignable.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070B14] flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Effets volumétriques d'arrière-plan */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-cyan-600/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md bg-[#0D1527]/80 backdrop-blur-xl border border-slate-800 rounded-3xl shadow-2xl p-8 z-10 relative">
        
        {/* En-tête */}
        <div className="flex flex-col items-center mb-8">
          <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-2xl shadow-[0_0_30px_rgba(168,85,247,0.2)] mb-4">
            <Shield size={40} className="text-purple-400" />
          </div>
          <h1 className="text-2xl font-black text-slate-100 tracking-tight">Système SOC Hybride</h1>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-2">Authentification requise</p>
        </div>

        {/* Gestion des erreurs */}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm p-3 rounded-xl mb-6 text-center font-bold">
            {error}
          </div>
        )}

        {/* Formulaire */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-[10px] font-black text-slate-400 tracking-widest mb-2 ml-1">IDENTIFIANT</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <User size={18} className="text-slate-500" />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-[#050810] border border-slate-700 text-slate-200 text-sm rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all shadow-inner"
                placeholder="Ex: admin"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 tracking-widest mb-2 ml-1">MOT DE PASSE</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock size={18} className="text-slate-500" />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#050810] border border-slate-700 text-slate-200 text-sm rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all shadow-inner"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-4 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3.5 rounded-xl transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)] disabled:opacity-70"
          >
            {loading ? <Activity size={20} className="animate-spin" /> : "ACCÉDER AU TERMINAL"}
            {!loading && <ChevronRight size={18} />}
          </button>
        </form>
      </div>
    </div>
  );
}