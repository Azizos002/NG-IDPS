"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import NotificationCenter from "@/components/NotificationCenter";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // État centralisé de la sidebar -- remonté ici (et non dans Sidebar)
  // pour que la marge du contenu principal et la barre supérieure
  // réagissent toutes les deux au même état.
  const [isOpen, setIsOpen] = useState(true);
  const [mounted, setMounted] = useState(false);

  // 1. Charge la préférence sauvegardée, APRÈS le premier rendu --
  //    évite un flash d'hydratation (le serveur ne connaît pas le localStorage).
  useEffect(() => {
    const stored = localStorage.getItem("soc_sidebar_open");
    if (stored !== null) setIsOpen(stored === "true");
    setMounted(true);
  }, []);

  // 2. Persiste la préférence à chaque changement (une fois monté)
  useEffect(() => {
    if (mounted) localStorage.setItem("soc_sidebar_open", String(isOpen));
  }, [isOpen, mounted]);

  // 3. Raccourci clavier Ctrl+B (Cmd+B sur Mac) -- empêche le comportement
  //    par défaut du navigateur (barre de favoris) avant de basculer.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // SI ON EST SUR LE LOGIN : enfant pur, aucune topologie
  if (pathname === "/login") {
    return <main className="w-full min-h-screen bg-[#070B14]">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-[#070B14]">
      <Sidebar isOpen={isOpen} />

      {/* Fond semi-transparent -- uniquement visible sur mobile (lg:hidden)
          quand la sidebar est ouverte en superposition. Cliquer dessus ferme. */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out ${
          isOpen ? "lg:ml-64" : "lg:ml-20"
        }`}
      >
        {/* Barre supérieure persistante -- TOUJOURS visible, peu importe
            l'état (ouvert/fermé/mobile) de la sidebar. */}
        <header className="h-16 shrink-0 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
          <button
            onClick={() => setIsOpen((prev) => !prev)}
            title={`${isOpen ? "Réduire" : "Ouvrir"} la barre latérale (Ctrl+B)`}
            className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
          >
            {isOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>

          <NotificationCenter />
        </header>

        <main className="flex-1 p-4 lg:p-8 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}