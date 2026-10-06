"use client";

import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { Bell, CheckCheck, ShieldAlert, Clock, Activity, ShieldCheck, GraduationCap, AlertTriangle } from "lucide-react";
import Link from "next/link";

// "INCIDENT" = alerte de sécurité (comportement existant, inchangé)
// "FORMATION" = notification de fin de génération d'un module de Micro-Learning
type NotificationKind = "INCIDENT" | "FORMATION";

interface SOCNotification {
    id: string;
    kind: NotificationKind;
    type: string;
    timestamp: string;
    read: boolean;
    // Champs spécifiques aux incidents (INCIDENT)
    ip?: string;
    sensor?: string;
    // Champs spécifiques aux formations (FORMATION)
    ruleId?: string;
    provider?: string;
    isFallback?: boolean;
}

// Libellé court du fournisseur IA pour affichage compact dans la notification.
// Repose sur le même préfixe "provider:model" que formation_data._meta_provider
// (voir server.js — chaîne de résilience Gemini -> Mistral -> Llama3.2 local).
const getProviderLabel = (provider?: string): string => {
    if (!provider) return "Fournisseur inconnu";
    const [p] = provider.split(":");
    if (p === "gemini") return "Gemini";
    if (p === "mistral") return "Mistral (secours cloud)";
    if (p === "ollama") return "Llama3.2 local (secours)";
    return p;
};

export default function NotificationCenter() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<SOCNotification[]>([]);
    const panelRef = useRef<HTMLDivElement>(null);

    // Fermer le panneau si on clique en dehors
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Écoute des attaques + des formations générées via WebSocket
    useEffect(() => {
        const currentHost = window.location.hostname;
        const socket = io(`http://${currentHost}:4000`);

        socket.on("soar_incident_incoming", (data: any) => {
            const newNotif: SOCNotification = {
                id: data._id || Math.random().toString(36).substring(7),
                kind: "INCIDENT",
                type: data.threatType || "Alerte de Sécurité",
                ip: data.maliciousIp || "IP Inconnue",
                sensor: data.sourceSensor || "Core-IDS",
                timestamp: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
                read: false,
            };
            setNotifications((prev) => [newNotif, ...prev]);
        });

        // Émis par server.js à la fin de /api/formations/generate (chaîne Gemini -> Mistral -> Llama3.2 local)
        socket.on("formation_generated", (data: any) => {
            const newNotif: SOCNotification = {
                id: data.rule_id || Math.random().toString(36).substring(7),
                kind: "FORMATION",
                type: data.titre_cours || "Formation générée",
                ruleId: data.rule_id,
                provider: data.provider,
                isFallback: !!data.isFallback,
                timestamp: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
                read: false,
            };
            setNotifications((prev) => [newNotif, ...prev]);
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    const unreadCount = notifications.filter((n) => !n.read).length;

    const markAllAsRead = () => {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    };

    const markAsRead = (id: string) => {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    };

    return (
        <div className="relative ml-10" ref={panelRef}>
            {/* Icône de Cloche avec Badge */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-full bg-slate-900 border border-slate-800 hover:bg-slate-800 transition-all focus:outline-none focus:ring-2 focus:ring-red-500/50"
                style={{right: 20 }}
            >
                <Bell className={`text-slate-300 ${unreadCount > 0 ? "animate-[wiggle_1s_ease-in-out_infinite]" : ""}`} size={20} />

                {unreadCount > 0 && (
                    <span className="absolute ml-10 -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 border-2 border-slate-950 text-[10px] font-bold text-white shadow-[0_0_10px_rgba(239,68,68,0.8)]">
                        {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                )}
            </button>

            {/* Panneau de Notifications */}
            {isOpen && (
                <div className="absolute right-0 mt-3 w-80 sm:w-96 bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">

                    {/* Header du panneau */}
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Activity size={16} className="text-cyan-500" />
                            Journal des Alertes
                        </h3>
                        {unreadCount > 0 && (
                            <button
                                onClick={markAllAsRead}
                                className="text-xs flex items-center gap-1 text-slate-400 hover:text-cyan-400 transition-colors font-semibold"
                            >
                                <CheckCheck size={14} />
                                Tout lire
                            </button>
                        )}
                    </div>

                    {/* Liste des Notifications (Scrollable) */}
                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                        {notifications.length === 0 ? (
                            <div className="p-8 flex flex-col items-center justify-center text-center">
                                <ShieldCheck size={40} className="text-slate-700 mb-3" />
                                <p className="text-sm font-bold text-slate-400">Aucune alerte récente</p>
                                <p className="text-xs text-slate-500 mt-1">Le périmètre est sécurisé.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                {notifications.map((notif) => {
                                    const isFormation = notif.kind === "FORMATION";

                                    // Couleurs : incidents = rouge (inchangé) ; formations = émeraude en succès direct
                                    // (Gemini), ambre si une bascule IA (fallback) a eu lieu — cohérent avec le badge
                                    // ProviderBadge déjà affiché dans le Hub de Formation (page.tsx).
                                    const accentClass = !isFormation
                                        ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
                                        : notif.isFallback
                                            ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]"
                                            : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]";

                                    const iconWrapClass = !isFormation
                                        ? notif.read ? "bg-slate-800 text-slate-400" : "bg-red-950 text-red-500"
                                        : notif.read
                                            ? "bg-slate-800 text-slate-400"
                                            : notif.isFallback
                                                ? "bg-amber-950 text-amber-500"
                                                : "bg-emerald-950 text-emerald-500";

                                    const ItemIcon = !isFormation ? ShieldAlert : notif.isFallback ? AlertTriangle : GraduationCap;

                                    const content = (
                                        <>
                                            {/* Ligne latérale de couleur pour les non-lus */}
                                            {!notif.read && (
                                                <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentClass}`}></div>
                                            )}

                                            <div className="flex gap-3">
                                                <div className={`mt-0.5 p-1.5 rounded-full h-fit ${iconWrapClass}`}>
                                                    <ItemIcon size={16} />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex justify-between items-start mb-1">
                                                        <p className={`text-sm font-bold ${notif.read ? "text-slate-300" : "text-white"}`}>
                                                            {isFormation && "🎓 "}{notif.type}
                                                        </p>
                                                        <span className="text-[10px] flex items-center gap-1 text-slate-500 font-mono">
                                                            <Clock size={10} /> {notif.timestamp}
                                                        </span>
                                                    </div>
                                                    {isFormation ? (
                                                        <p className="text-xs text-slate-400 font-mono flex items-center gap-2">
                                                            <span className={notif.isFallback ? "text-amber-400/80" : "text-emerald-400/80"}>
                                                                {getProviderLabel(notif.provider)}
                                                            </span>
                                                            {notif.isFallback && (
                                                                <>
                                                                    <span className="text-slate-600">•</span>
                                                                    <span className="text-amber-500/80">Bascule IA</span>
                                                                </>
                                                            )}
                                                        </p>
                                                    ) : (
                                                        <p className="text-xs text-slate-400 font-mono flex items-center gap-2">
                                                            <span className="text-red-400/80">{notif.ip}</span>
                                                            <span className="text-slate-600">•</span>
                                                            <span className="text-cyan-500/70">{notif.sensor}</span>
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    );

                                    const itemClassName = `relative p-4 border-b border-slate-800/50 cursor-pointer transition-all hover:bg-slate-800/50 group ${
                                        notif.read ? "opacity-60 bg-transparent" : isFormation ? (notif.isFallback ? "bg-amber-500/5" : "bg-emerald-500/5") : "bg-red-500/5"
                                    }`;

                                    // Pour une formation, cliquer ouvre directement le cours concerné dans le Hub de
                                    // Formation (page.tsx lit déjà ?courseId=... pour sélectionner le module ciblé).
                                    if (isFormation && notif.ruleId) {
                                        return (
                                            <Link
                                                key={notif.id}
                                                href={`/formations?courseId=${notif.ruleId}`}
                                                onClick={() => {
                                                    markAsRead(notif.id);
                                                    setIsOpen(false);
                                                }}
                                                className={itemClassName}
                                            >
                                                {content}
                                            </Link>
                                        );
                                    }

                                    return (
                                        <div
                                            key={notif.id}
                                            onClick={() => markAsRead(notif.id)}
                                            className={itemClassName}
                                        >
                                            {content}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Footer du panneau */}
                    <div className="p-3 bg-slate-950 border-t border-slate-800 text-center">
                        <Link
                            href="/incidents"
                            onClick={() => setIsOpen(false)}
                            className="text-xs font-bold text-cyan-500 hover:text-cyan-400 uppercase tracking-widest transition-colors"
                        >
                            Ouvrir le SOC
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}