"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { ShieldAlert, Activity, Server, Settings, LayoutDashboard, Globe, GraduationCap, LogOut } from "lucide-react";
import { io } from "socket.io-client";

interface SidebarProps {
  isOpen: boolean;
}

export default function Sidebar({ isOpen }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [incidents, setIncidents] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("soc_user");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }

    const currentHost = window.location.hostname;
    const backendUrl = `http://${currentHost}:4000`;

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

  const handleLogout = () => {
    localStorage.setItem("soc_last_logout", new Date().toISOString());
    sessionStorage.removeItem("briefing_seen");
    localStorage.removeItem("soc_user");
    document.cookie = "soc_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
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

  // Disparition totale uniquement sur la page de login (inchangé)
  if (pathname === "/login") {
    return null;
  }

  return (
    <div
      className={`h-screen bg-slate-900 border-r border-slate-800 fixed left-0 top-0 flex flex-col z-50
        transition-all duration-300 ease-in-out
        ${isOpen
          ? "w-64 translate-x-0"
          : "w-64 -translate-x-full lg:translate-x-0 lg:w-20"
        }`}
    >
      {/* --- Logo / En-tête --- */}
      <div className={`p-6 flex items-center ${isOpen ? "justify-start" : "lg:justify-center"} shrink-0`}>
        <div className={isOpen ? "block" : "hidden lg:block"}>
          <h1
            className={`font-bold text-red-500 tracking-widest transition-all duration-200 ${
              isOpen ? "text-2xl" : "lg:text-xl"
            }`}
          >
            {isOpen ? "SOC" : <span className="lg:inline hidden">S</span>}
          </h1>
          {isOpen && <p className="text-xs text-slate-400 mt-1 whitespace-nowrap">Cyberdéfense Active</p>}
        </div>
        {/* Version mobile toujours en texte complet (la sidebar mobile n'est jamais en mode icônes) */}
        <div className="block lg:hidden">
          <h1 className="text-2xl font-bold text-red-500 tracking-widest">SOC</h1>
          <p className="text-xs text-slate-400 mt-1">Cyberdéfense Active</p>
        </div>
      </div>

      {/* --- Navigation --- */}
      <nav className="flex-1 px-3 space-y-2 mt-4 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.path;
          const hasAlert = item.name === "Incidents SOAR" && openCount > 0;

          return (
            <Link
              key={item.path}
              href={item.path}
              title={!isOpen ? item.name : undefined}
              className={`flex items-center px-3 py-3 rounded-lg transition-all duration-200 w-full ${
                isOpen ? "justify-between" : "lg:justify-center justify-between"
              } ${
                isActive
                  ? "bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              <div className={`flex items-center ${isOpen ? "space-x-3" : "lg:space-x-0 space-x-3"}`}>
                <div className="relative shrink-0">
                  <Icon size={20} />
                  {/* En mode icônes seules, le badge se superpose directement sur l'icône */}
                  {hasAlert && !isOpen && (
                    <span className="hidden lg:flex absolute -top-1 -right-1 h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    </span>
                  )}
                </div>
                <span
                  className={`font-medium text-sm whitespace-nowrap transition-all duration-200 ${
                    isOpen ? "opacity-100 w-auto" : "lg:opacity-0 lg:w-0 lg:overflow-hidden opacity-100 w-auto"
                  }`}
                >
                  {item.name}
                </span>
              </div>

              {/* Badge classique (texte visible) -- masqué en mode icônes seules desktop */}
              {hasAlert && (
                <div className={`items-center gap-2 ml-auto ${isOpen ? "flex" : "lg:hidden flex"}`}>
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

      {/* --- Profil utilisateur --- */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/50 shrink-0">
        <div className={`flex items-center ${isOpen ? "justify-between" : "lg:justify-center justify-between lg:flex-col lg:gap-3"}`}>
          <div className={`flex items-center space-x-3 ${!isOpen && "lg:space-x-0"}`}>
            <div className="h-9 w-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-cyan-500">
                {user?.name ? user.name.substring(0, 2).toUpperCase() : "AD"}
              </span>
            </div>
            <div className={isOpen ? "block" : "lg:hidden block"}>
              <p className="text-sm font-semibold text-slate-200 truncate max-w-[100px]">
                {user?.name || "Administrateur"}
              </p>
              <div className="flex items-center space-x-1 mt-0.5">
                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                <p className="text-xs text-slate-400 truncate">{user?.role || "En ligne"}</p>
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            title="Se déconnecter"
            className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}