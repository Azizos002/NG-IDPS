"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { ShieldAlert, Activity, Server, Settings, LayoutDashboard, Globe, GraduationCap, LogOut } from "lucide-react";
import { io } from "socket.io-client";
import NotificationCenter from "./NotificationCenter";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter(); // <-- NOUVEAU : Pour la redirection de déconnexion

  const [incidents, setIncidents] = useState<any[]>([]);
  // NOUVEAU : État pour stocker les informations du profil connecté
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // 1. Récupérer l'utilisateur connecté depuis le LocalStorage
    const storedUser = localStorage.getItem("soc_user");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }

    const currentHost = window.location.hostname;
    const backendUrl = `http://${currentHost}:4000`;

    // 2. Charger l'historique initial
    const fetchHistory = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/incidents`);
        const data = await response.json();
        setIncidents(data);
      } catch (error) {
        console.error("[-] Impossible de charger l'historique pour la sidebar :", error);
      }
    };

    fetchHistory();

    // 3. WebSockets
    const socket = io(backendUrl);

    socket.on("soar_incident_incoming", (data: any) => {
      setIncidents((prev) => [data, ...prev]);
    });

    socket.on("soar_incident_updated", (updatedIncident: any) => {
      setIncidents((prev) => prev.map(inc =>
        inc._id === updatedIncident._id ? updatedIncident : inc
      ));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Fonction de déconnexion
  const handleLogout = () => {
    // NOUVEAU : On sauvegarde l'heure exacte de la déconnexion
    localStorage.setItem("soc_last_logout", new Date().toISOString());

    sessionStorage.removeItem("briefing_seen");
    localStorage.removeItem("soc_user");
    document.cookie = "soc_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    // Expulsion vers la page de login
    router.push("/login");
  };

  const checkIsResolved = (status: string) => {
    if (!status) return false;
    return status.includes("Bannie") || status.includes("Résolu") || status.includes("Faux Positif") || status.includes("Ignoré");
  };

  const openCount = incidents.filter(inc => !checkIsResolved(inc.caseStatus)).length;

  const menuItems = [
    { name: "Vue d'ensemble", path: "/", icon: LayoutDashboard },
    { name: "Infrastructure", path: "/infrastructure", icon: Server },
    { name: "Incidents SOAR", path: "/incidents", icon: ShieldAlert },
    { name: "Veille CTI", path: "/threat-intel", icon: Globe },
    { name: "Hub Formations", path: "/formations", icon: GraduationCap },
    { name: "Activité IA", path: "/ia-activity", icon: Activity },
    { name: "Configuration", path: "/settings", icon: Settings },
  ];

  // =====================================================================
  // 🛡️ LA MAGIE EST ICI : Disparition de la Sidebar sur la page Login
  // =====================================================================
  if (pathname === "/login") {
    return null; // On ne rend absolument rien dans le DOM !
  }

  return (
    <div className="h-screen w-64 bg-slate-900 border-r border-slate-800 fixed left-0 top-0 flex flex-col z-50">
      <div className="flex items-center justify-between">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-red-500 tracking-widest">SOC</h1>
          <p className="text-xs text-slate-400 mt-1">Cyberdéfense Active</p>
        </div>
        <NotificationCenter />
      </div>

      <nav className="flex-1 px-4 space-y-2 mt-4">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.path;

          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center justify-between px-4 py-3 rounded-lg transition-all duration-200 w-full ${isActive
                ? "bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
            >
              <div className="flex items-center space-x-3">
                <Icon size={20} />
                <span className="font-medium text-sm">{item.name}</span>
              </div>

              {item.name === "Incidents SOAR" && openCount > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Profil de l'utilisateur avec bouton de déconnexion */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
              {/* On récupère les initiales ou "AD" par défaut */}
              <span className="text-sm font-bold text-cyan-500">
                {user?.name ? user.name.substring(0, 2).toUpperCase() : "AD"}
              </span>
            </div>
            <div>
              {/* Affichage dynamique du nom et du rôle */}
              <p className="text-sm font-semibold text-slate-200 truncate max-w-[100px]">
                {user?.name || "Administrateur"}
              </p>
              <div className="flex items-center space-x-1 mt-0.5">
                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                <p className="text-xs text-slate-400 truncate">{user?.role || "En ligne"}</p>
              </div>
            </div>
          </div>

          {/* Bouton de Déconnexion */}
          <button
            onClick={handleLogout}
            title="Se déconnecter"
            className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}