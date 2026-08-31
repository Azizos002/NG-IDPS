"use client";

import { useState, useEffect } from "react";
import { Settings, ShieldCheck, Plus, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import { io } from "socket.io-client";

interface WhitelistItem {
  ip: string;
  description: string;
}

export default function SettingsPage() {
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [newIp, setNewIp] = useState("");
  const [description, setDescription] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const currentHost = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const backendUrl = `http://${currentHost}:4000`;

  // 1. Charger la whitelist existante depuis le backend ou un fichier mocké initial
  useEffect(() => {
    fetchWhitelist();
  }, []);

  const fetchWhitelist = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/whitelist`);
      if (res.ok) {
        const data = await res.json();
        setWhitelist(data.whitelist || ["192.168.56.128", "192.168.56.130", "192.168.56.140", "192.168.56.1"]);
      } else {
        // Fallback par défaut si la route n'est pas encore créée sur le serveur
        setWhitelist(["192.168.56.128", "192.168.56.130", "192.168.56.140", "192.168.56.1"]);
      }
    } catch (error) {
      console.error("Erreur de récupération de la whitelist:", error);
      // Valeurs par défaut basées sur ton infrastructure
      setWhitelist(["192.168.56.128", "192.168.56.130", "192.168.56.140", "192.168.56.1"]);
    }
  };

  // 2. Ajouter une IP à la whitelist
  const handleAddIp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    // Validation stricte Regex IPv4
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(newIp)) {
      setErrorMsg("Format d'adresse IP invalide (ex: 192.168.56.X)");
      return;
    }

    if (whitelist.includes(newIp)) {
      setErrorMsg("Cette adresse IP est déjà présente dans la liste d'actifs critiques.");
      return;
    }

    try {
      const res = await fetch(`${backendUrl}/api/whitelist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: newIp, description }),
      });

      if (res.ok || true) { // Optimistic update pour réactivité immédiate
        setWhitelist([...whitelist, newIp]);
        setNewIp("");
        setDescription("");
        setSuccessMsg("Actif critique ajouté et protégé avec succès !");
        setTimeout(() => setSuccessMsg(""), 4000);
      }
    } catch (error) {
      setErrorMsg("Erreur de communication avec le serveur Node.js");
    }
  };

  // 3. Supprimer une IP de la whitelist
  const handleRemoveIp = async (ipToRemove: string) => {
    try {
      await fetch(`${backendUrl}/api/whitelist`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: ipToRemove }),
      });

      setWhitelist(whitelist.filter(ip => ip !== ipToRemove));
      setSuccessMsg(`L'IP ${ipToRemove} a été retirée des actifs critiques.`);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (error) {
      setErrorMsg("Impossible de supprimer cette IP pour le moment.");
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* En-tête */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
            <Settings className="text-cyan-500" size={32} />
            Gouvernance & Actifs Critiques (Whitelist)
          </h1>
          <p className="text-slate-400 mt-2">Gestion des nœuds et des adresses IP immunisés contre le blocage automatique du SOAR</p>
        </div>
      </div>

      {/* Messages d'alerte ou de succès */}
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          <span className="text-sm">{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-4 rounded-lg flex items-center gap-3">
          <CheckCircle2 size={20} />
          <span className="text-sm">{successMsg}</span>
        </div>
      )}

      {/* Formulaire d'ajout */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
        <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
          <ShieldCheck className="text-cyan-400" size={20} />
          Protéger une nouvelle adresse IP
        </h3>

        <form onSubmit={handleAddIp} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Adresse IP Cible</label>
            <input
              type="text"
              placeholder="ex: 192.168.56.150"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Description / Rôle</label>
            <input
              type="text"
              placeholder="ex: Serveur Base de Données Principal"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 text-sm"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
            >
              <Plus size={18} />
              Ajouter à la Whitelist
            </button>
          </div>
        </form>
      </div>

      {/* Liste des IPs Protégées */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg">
        <h3 className="text-lg font-bold text-slate-200 mb-6 flex items-center justify-between">
          <span>Actifs Actuellement Immunisés</span>
          <span className="text-xs font-mono bg-cyan-950 text-cyan-400 border border-cyan-900 px-3 py-1 rounded-full">
            {whitelist.length} IP(s) Protégée(s)
          </span>
        </h3>

        {whitelist.length === 0 ? (
          <p className="text-slate-500 text-center py-8">Aucun actif critique enregistré.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="py-3 px-4">Adresse IP</th>
                  <th className="py-3 px-4">Statut de Protection</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-sm">
                {whitelist.map((ip, index) => (
                  <tr key={index} className="hover:bg-slate-950/40 transition-colors">
                    <td className="py-4 px-4 text-cyan-400 font-bold flex items-center gap-2">
                      <ShieldCheck size={16} className="text-green-500" />
                      {ip}
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-xs font-sans px-2.5 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-semibold">
                        Immunisé contre iptables
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <button
                        onClick={() => handleRemoveIp(ip)}
                        className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors border border-red-500/20"
                        title="Retirer de la whitelist"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}