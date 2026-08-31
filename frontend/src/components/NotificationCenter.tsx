"use client";

import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { Bell, CheckCheck, ShieldAlert, Clock, Activity, ShieldCheck } from "lucide-react";
import Link from "next/link";

interface SOCNotification {
    id: string;
    type: string;
    ip: string;
    sensor: string;
    timestamp: string;
    read: boolean;
}

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

    // Écoute des attaques via WebSocket
    useEffect(() => {
        const currentHost = window.location.hostname;
        const socket = io(`http://${currentHost}:4000`);

        socket.on("soar_incident_incoming", (data: any) => {
            const newNotif: SOCNotification = {
                id: data._id || Math.random().toString(36).substring(7),
                type: data.threatType || "Alerte de Sécurité",
                ip: data.maliciousIp || "IP Inconnue",
                sensor: data.sourceSensor || "Core-IDS",
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
                <div className="absolute left-0 mt-3 w-80 sm:w-96 bg-slate-900/95 backdrop-blur-xl border border-slate-700 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">

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
                                {notifications.map((notif) => (
                                    <div
                                        key={notif.id}
                                        onClick={() => markAsRead(notif.id)}
                                        className={`relative p-4 border-b border-slate-800/50 cursor-pointer transition-all hover:bg-slate-800/50 group ${notif.read ? "opacity-60 bg-transparent" : "bg-red-500/5"
                                            }`}
                                    >
                                        {/* Ligne rouge latérale pour les non-lus */}
                                        {!notif.read && (
                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div>
                                        )}

                                        <div className="flex gap-3">
                                            <div className={`mt-0.5 p-1.5 rounded-full h-fit ${notif.read ? "bg-slate-800 text-slate-400" : "bg-red-950 text-red-500"}`}>
                                                <ShieldAlert size={16} />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex justify-between items-start mb-1">
                                                    <p className={`text-sm font-bold ${notif.read ? "text-slate-300" : "text-white"}`}>
                                                        {notif.type}
                                                    </p>
                                                    <span className="text-[10px] flex items-center gap-1 text-slate-500 font-mono">
                                                        <Clock size={10} /> {notif.timestamp}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-400 font-mono flex items-center gap-2">
                                                    <span className="text-red-400/80">{notif.ip}</span>
                                                    <span className="text-slate-600">•</span>
                                                    <span className="text-cyan-500/70">{notif.sensor}</span>
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
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