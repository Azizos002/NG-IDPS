"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { ShieldAlert, X, Crosshair, Activity, Siren } from "lucide-react";
import Link from "next/link";

interface GlobalAlert {
    id: string;
    ip: string;
    type: string;
    sensor: string;
    severity: string;
}

export default function GlobalAlertListener() {
    const [alerts, setAlerts] = useState<GlobalAlert[]>([]);


    // ==========================================
    // Alarme d'Intrusion Numérique (Web Audio)
    // ==========================================
    const playSiren = () => {
        try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            const now = audioCtx.currentTime;

            // Onde "square" (carrée) pour un son très électronique, strident et agressif
            osc.type = "square";

            // Alternance brutale de deux fréquences (High-Low-High-Low)
            osc.frequency.setValueAtTime(987.77, now);        // Haute
            osc.frequency.setValueAtTime(739.99, now + 0.15); // Basse
            osc.frequency.setValueAtTime(987.77, now + 0.30);
            osc.frequency.setValueAtTime(739.99, now + 0.45);
            osc.frequency.setValueAtTime(987.77, now + 0.60);
            osc.frequency.setValueAtTime(739.99, now + 0.75);

            // Volume CONSTANT sans aucun fade-out.
            // On met juste un infime ramp de 0.02s au tout début et à la toute fin 
            // pour éviter un "clic" matériel qui abîmerait le haut-parleur.
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(0.15, now + 0.02); // Attaque immédiate

            // Le volume reste statique jusqu'à 0.88s
            gainNode.gain.setValueAtTime(0.15, now + 0.88);
            // Coupure nette et brutale
            gainNode.gain.linearRampToValueAtTime(0, now + 0.90);

            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            osc.start(now);
            osc.stop(now + 0.95);
        } catch (e) {
            console.warn("Audio bloqué", e);
        }
    };

    useEffect(() => {
        const currentHost = window.location.hostname;
        const socket = io(`http://${currentHost}:4000`);

        socket.on("soar_incident_incoming", (data: any) => {
            playSiren();

            const newAlert: GlobalAlert = {
                id: data._id || Math.random().toString(36).substring(7),
                ip: data.maliciousIp || "Inconnue",
                type: data.threatType || "Intrusion Détectée",
                sensor: data.sourceSensor || "Core-IDS",
                severity: data.diagnostic_json?.niveau_severite || data.severity || "CRITIQUE"
            };

            // Ajout de la nouvelle attaque dans la pile (en haut)
            setAlerts((prev) => [newAlert, ...prev]);

            // Auto-destruction de la notification après 8 secondes
            setTimeout(() => {
                setAlerts((prev) => prev.filter((a) => a.id !== newAlert.id));
            }, 8000);
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    const removeAlert = (id: string) => {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
    };

    if (alerts.length === 0) return null;

    return (
        // Conteneur flexible pour empiler les attaques
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-4 items-end pointer-events-none">
            {alerts.map((alert) => (
                <div
                    key={alert.id}
                    className="pointer-events-auto w-96 bg-black/60 backdrop-blur-xl border border-red-500/50 rounded-xl shadow-[0_0_40px_rgba(239,68,68,0.25)] overflow-hidden animate-in slide-in-from-right-10 fade-in duration-300 relative group"
                >
                    {/* Ligne lumineuse supérieure */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-700 via-red-400 to-red-700"></div>

                    <div className="p-5">
                        <button
                            onClick={() => removeAlert(alert.id)}
                            className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors z-10"
                        >
                            <X size={18} />
                        </button>

                        <div className="flex items-start gap-4">
                            <div className="relative">
                                <div className="absolute -inset-1 bg-red-500 rounded-full blur opacity-40 animate-pulse"></div>
                                <div className="relative p-2.5 bg-red-950/80 border border-red-500/50 rounded-lg">
                                    <Siren className="text-red-500 animate-pulse" size={24} />
                                </div>
                            </div>

                            <div className="flex-1 pr-4">
                                <h3 className="text-red-400 font-black text-[11px] uppercase tracking-[0.2em] mb-1 flex items-center gap-2">
                                    <Activity size={12} />
                                    Alerte Système ({alert.severity})
                                </h3>
                                <p className="text-white font-bold text-lg leading-tight mb-3 drop-shadow-md">
                                    {alert.type}
                                </p>

                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2 text-xs font-mono bg-slate-900/80 p-2 rounded border border-slate-800">
                                        <Crosshair size={14} className="text-slate-500" />
                                        <span className="text-slate-400">Cible/IP:</span>
                                        <span className="text-red-400 font-bold">{alert.ip}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs font-mono bg-slate-900/80 p-2 rounded border border-slate-800">
                                        <ShieldAlert size={14} className="text-slate-500" />
                                        <span className="text-slate-400">Capteur:</span>
                                        <span className="text-cyan-400">{alert.sensor}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-red-500/20">
                            <Link
                                href="/incidents"
                                onClick={() => removeAlert(alert.id)}
                                className="w-full py-2.5 bg-red-600/20 hover:bg-red-500 text-red-100 hover:text-white border border-red-500/50 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all duration-300 hover:shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                            >
                                Ouvrir le centre de commandement
                            </Link>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}