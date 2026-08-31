"use client";

import { useState, useEffect } from "react";
import { Server, Cpu, Activity, CheckCircle2, AlertCircle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { io } from "socket.io-client";

interface ServiceStatus {
    name: string;
    backendName: string;
    active: boolean;
}

interface VmData {
    id: number;
    hostname: string;
    ip: string;
    status: string;
    cpu: number;
    ram: number;
    services: ServiceStatus[];
    lastHeartbeat?: string; // Ajout du champ pour le chien de garde
}

interface HistoryData {
    time: string;
    cpu: number;
    ram: number;
}

export default function InfrastructurePage() {
    const [vms, setVms] = useState<VmData[]>([
        {
            id: 1,
            hostname: "VM-Capteur-Suricata",
            ip: "192.168.56.10",
            status: "Hors Ligne",
            cpu: 0,
            ram: 0,
            services: [
                { name: "Suricata (NIDS)", backendName: "suricata", active: false },
                { name: "Filebeat (Shipper)", backendName: "filebeat", active: false }
            ]
        },
        {
            id: 2,
            hostname: "ML",
            ip: "192.168.56.20", 
            status: "Hors Ligne",
            cpu: 0, 
            ram: 0,
            services: [
                { name: "Kafka (Ingestion)", backendName: "kafka", active: false },
                { name: "Elasticsearch", backendName: "elasticsearch", active: false },
                { name: "Modèle LSTM-VAE", backendName: "modele_lstm.py", active: false } 
            ]
        },
        {
            id: 3,
            hostname: "VM-Response",
            ip: "192.168.56.30",
            status: "Hors Ligne",
            cpu: 0, 
            ram: 0,
            services: [
                { name: "Ollama (Moteur LLM)", backendName: "ollama", active: false },
                { name: "Agent SOAR", backendName: "agent_soar.py", active: false }
            ]
        }
    ]);

    const [historyData, setHistoryData] = useState<HistoryData[]>([]);

    const syncServices = (currentServices: ServiceStatus[], backendServices: any[]) => {
        if (!backendServices || backendServices.length === 0) return currentServices;
        return currentServices.map(srv => {
            const bSrv = backendServices.find((bs: any) => bs.name === srv.backendName);
            return bSrv ? { ...srv, active: bSrv.active } : srv;
        });
    };

    useEffect(() => {
        const currentHost = window.location.hostname;
        const backendUrl = `http://${currentHost}:4000`;

        // 1. CHARGEMENT INITIAL
        const fetchInitialState = async () => {
            try {
                const response = await fetch(`${backendUrl}/api/vms`);
                const dbVms = await response.json();
                
                setVms(prevVms => prevVms.map(vm => {
                    const knownVm = dbVms.find((db: any) => db.hostname === vm.hostname);
                    if (knownVm) {
                        return {
                            ...vm,
                            status: knownVm.nodeStatus || "Online",
                            cpu: Math.round(knownVm.cpuUsage || 0),
                            ram: Math.round(knownVm.ramUsage || 0),
                            ip: knownVm.ipAddress || vm.ip,
                            services: syncServices(vm.services, knownVm.services),
                            lastHeartbeat: knownVm.lastHeartbeat // On récupère le timestamp
                        };
                    }
                    return vm;
                }));
            } catch (error) {
                console.error("[-] Impossible de charger l'historique des VMs :", error);
            }
        };

        fetchInitialState();

        // 2. ÉCOUTE TEMPS RÉEL
        const socket = io(backendUrl);

        socket.on("dashboard_update", (updatedNode) => {
            setVms((prevVms) => {
                const newVms = prevVms.map((vm) => {
                    if (vm.hostname === updatedNode.hostname) {
                        return {
                            ...vm,
                            status: updatedNode.nodeStatus || "Online",
                            cpu: Math.round(updatedNode.cpuUsage),
                            ram: Math.round(updatedNode.ramUsage),
                            ip: updatedNode.ipAddress || vm.ip,
                            services: syncServices(vm.services, updatedNode.services),
                            lastHeartbeat: updatedNode.lastHeartbeat // Mise à jour du timestamp
                        };
                    }
                    return vm;
                });

                const activeVms = newVms.filter(v => v.status === "Online");
                if (activeVms.length > 0) {
                    const totalCpu = activeVms.reduce((acc, curr) => acc + curr.cpu, 0);
                    const totalRam = activeVms.reduce((acc, curr) => acc + curr.ram, 0);
                    const avgCpu = Math.round(totalCpu / activeVms.length);
                    const avgRam = Math.round(totalRam / activeVms.length);
                    
                    const now = new Date();
                    const timeString = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

                    setHistoryData(prev => {
                        const newHistory = [...prev, { time: timeString, cpu: avgCpu, ram: avgRam }];
                        if (newHistory.length > 20) return newHistory.slice(newHistory.length - 20);
                        return newHistory;
                    });
                }

                return newVms;
            });
        });

    }, []);

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
                        <Server className="text-cyan-500" />
                        Supervision de l'Infrastructure
                    </h1>
                    <p className="text-slate-400 mt-2">État des nœuds de cyberdéfense en temps réel</p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {vms.map((vm) => (
                    <div key={vm.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg hover:border-slate-700 transition-colors">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-lg font-bold text-slate-200">{vm.hostname}</h3>
                                <p className="text-sm font-mono text-slate-500">{vm.ip}</p>
                            </div>
                            <div className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2 ${vm.status === "Online" ? "bg-green-500/10 text-green-400 border border-green-500/20" :
                                    "bg-red-500/10 text-red-400 border border-red-500/20"
                                }`}>
                                {vm.status === "Online" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} className="animate-pulse" />}
                                {vm.status}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                                <div className="flex items-center gap-2 text-slate-400 mb-2">
                                    <Cpu size={16} /> <span className="text-sm">CPU</span>
                                </div>
                                <div className="text-2xl font-bold text-slate-200">{vm.cpu}%</div>
                                <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                                    <div className={`h-1.5 rounded-full ${vm.cpu > 80 ? 'bg-red-500' : 'bg-cyan-500'} transition-all duration-500`} style={{ width: `${vm.cpu}%` }}></div>
                                </div>
                            </div>
                            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                                <div className="flex items-center gap-2 text-slate-400 mb-2">
                                    <Activity size={16} /> <span className="text-sm">RAM</span>
                                </div>
                                <div className="text-2xl font-bold text-slate-200">{vm.ram}%</div>
                                <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                                    <div className={`h-1.5 rounded-full ${vm.ram > 80 ? 'bg-red-500' : 'bg-cyan-500'} transition-all duration-500`} style={{ width: `${vm.ram}%` }}></div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <h4 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">Services Actifs</h4>
                            {vm.services.map((service, index) => (
                                <div key={index} className="flex items-center justify-between bg-slate-950/50 p-3 rounded border border-slate-800/50">
                                    <span className="text-sm text-slate-300">{service.name}</span>
                                    <div className={`h-2.5 w-2.5 rounded-full ${service.active ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}></div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-8 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg h-80">
                <h3 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
                    <Activity className="text-cyan-500" size={20} />
                    Charge Globale du Cluster (Temps Réel)
                </h3>
                {historyData.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
                        En attente des données de télémétrie...
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={historyData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="time" stroke="#475569" fontSize={12} />
                            <YAxis stroke="#475569" fontSize={12} domain={[0, 100]} />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                                itemStyle={{ color: '#e2e8f0' }}
                            />
                            <Line type="monotone" dataKey="cpu" stroke="#06b6d4" strokeWidth={2} dot={false} name="CPU moyen (%)" isAnimationActive={false} />
                            <Line type="monotone" dataKey="ram" stroke="#8b5cf6" strokeWidth={2} dot={false} name="RAM moyenne (%)" isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}