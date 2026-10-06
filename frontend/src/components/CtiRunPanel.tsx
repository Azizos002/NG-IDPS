"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Terminal, X, Copy, Check } from "lucide-react";
import { io } from "socket.io-client";
import { toast } from "sonner";

type RunStatus = "IDLE" | "RUNNING" | "SUCCESS" | "FAILED";

interface RunInfo {
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
}

const getCookie = (name: string) => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift() || "";
  return "";
};

const lineClass = (line: string) => {
  if (line.includes("[ERROR]") || line.includes("[-]")) return "text-rose-400";
  if (line.includes("[WARNING]") || line.includes("🛑") || line.includes("[!]")) return "text-amber-400";
  if (line.includes("✅") || line.includes("[+]")) return "text-emerald-400";
  if (line.includes("[DEBUG]")) return "text-slate-500";
  if (line.includes("[ANALYSTE]") || line.includes("===")) return "text-cyan-300";
  return "text-slate-300";
};

const formatDuration = (start: string | null, end: string | null) => {
  if (!start || !end) return "";
  const s = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};

const BADGES: Record<RunStatus, { label: string; cls: string; dot: string }> = {
  IDLE: { label: "Jamais exécuté", cls: "text-slate-400 bg-slate-800 border-slate-700", dot: "bg-slate-500" },
  RUNNING: { label: "En cours", cls: "text-amber-300 bg-amber-500/10 border-amber-500/30", dot: "bg-amber-400" },
  SUCCESS: { label: "Terminé", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30", dot: "bg-emerald-400" },
  FAILED: { label: "Échec", cls: "text-rose-300 bg-rose-500/10 border-rose-500/30", dot: "bg-rose-400" },
};

export default function CtiRunPanel({ onFinished }: { onFinished?: () => void }) {
  const [run, setRun] = useState<RunInfo>({ status: "IDLE", startedAt: null, finishedAt: null, exitCode: null });
  const [lines, setLines] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hideDebug, setHideDebug] = useState(true);
  const [copied, setCopied] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevStatus = useRef<RunStatus>("IDLE");
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const backendUrl = `http://${window.location.hostname}:4000`;

    fetch(`${backendUrl}/api/cti/last-run`, { headers: { Authorization: `Bearer ${getCookie("soc_token")}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setRun({ status: d.status, startedAt: d.startedAt, finishedAt: d.finishedAt, exitCode: d.exitCode });
        setLines(d.lines || []);
        prevStatus.current = d.status;
      })
      .catch(() => {});

    const socket = io(backendUrl);

    socket.on("cti_log_line", ({ line }: { line: string }) => {
      setLines((prev) => (prev.length >= 3000 ? prev : [...prev, line]));
    });

    socket.on("cti_run_status", (info: RunInfo) => {
      if (info.status === "RUNNING") setLines([]);
      if (prevStatus.current === "RUNNING" && info.status === "SUCCESS") {
        toast.success("Veille CTI terminée", { description: "Les nouveaux bulletins sont disponibles." });
        onFinishedRef.current?.();
      }
      if (prevStatus.current === "RUNNING" && info.status === "FAILED") {
        toast.error("Échec de la veille CTI", { description: "Consultez le journal d'exécution." });
      }
      prevStatus.current = info.status;
      setRun(info);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Défilement automatique vers le bas, sauf si l'utilisateur a remonté dans le journal
  useEffect(() => {
    if (open && stickToBottom.current && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines, open, hideDebug]);

  // Fermeture avec Échap
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const launch = async () => {
    const backendUrl = `http://${window.location.hostname}:4000`;
    try {
      const res = await fetch(`${backendUrl}/api/cti/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getCookie("soc_token")}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error("Lancement impossible", { description: data.error });
        return;
      }
      toast.info("Veille CTI lancée", { description: "Collecte et triage des sources OSINT en cours…" });
    } catch {
      toast.error("Erreur de connexion", { description: "Impossible de contacter le serveur." });
    }
  };

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible", { description: "Le presse-papiers n'est pas disponible sur cette page." });
    }
  };

  const badge = BADGES[run.status];
  const visible = (hideDebug ? lines.filter((l) => !l.includes("[DEBUG]")) : lines).slice(-1500);
  const running = run.status === "RUNNING";

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={launch}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw size={16} className={running ? "animate-spin" : ""} />
          {running ? "Analyse en cours…" : "Actualiser"}
        </button>

        <button
          onClick={() => setOpen(true)}
          title="Journal de la dernière exécution"
          className="relative p-2.5 text-slate-300 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800 hover:text-cyan-400 transition-colors"
        >
          <Terminal size={18} />
          {run.status !== "IDLE" && (
            <span className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ${badge.dot} ${running ? "animate-pulse" : ""}`} />
          )}
        </button>
      </div>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <div
              className="w-full max-w-5xl h-[80vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <Terminal className="text-cyan-400" size={22} />
                  <div>
                    <h3 className="text-lg font-bold text-slate-100">Journal d'exécution de l'agent CTI</h3>
                    <p className="text-sm text-slate-500">
                    {run.startedAt ? `Lancé le ${new Date(run.startedAt).toLocaleString("fr-FR", { timeZone: "UTC" })} UTC` : "Aucune exécution enregistrée"}                      {run.finishedAt ? ` · durée ${formatDuration(run.startedAt, run.finishedAt)}` : ""}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold border ${badge.cls}`}>{badge.label}</span>
                </div>
                <button onClick={() => setOpen(false)} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div
                ref={logRef}
                onScroll={onScroll}
                className="flex-1 overflow-y-auto custom-scrollbar bg-[#050810] p-5 font-mono text-[13px] leading-relaxed"
              >
                {visible.length === 0 ? (
                  <p className="text-slate-500">Aucune sortie à afficher. Cliquez sur « Actualiser » pour lancer la veille.</p>
                ) : (
                  visible.map((l, i) => (
                    <div key={i} className={`whitespace-pre-wrap break-words ${lineClass(l)}`}>
                      {l}
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800">
                <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hideDebug}
                    onChange={(e) => setHideDebug(e.target.checked)}
                    className="accent-purple-500"
                  />
                  Masquer les lignes [DEBUG]
                </label>
                <button
                  onClick={copyLogs}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-300 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors"
                >
                  {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                  {copied ? "Copié" : "Copier le journal"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}