"use client";

// Vista ligera para la sucursal (tablet, PC o Raspberry Pi con navegador).
// Se deja abierta en pantalla completa: /branch?key=<branch_key>

import { useEffect, useState } from "react";
import {
  Megaphone,
  Music2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatDuration } from "@/lib/schedule";
import { useBranchPlayer, type PlayerStatus } from "./useBranchPlayer";

const STATUS_META: Record<
  PlayerStatus,
  { label: string; dot: string; chip: string }
> = {
  idle: { label: "Listo", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
  connecting: { label: "Conectando", dot: "bg-amber-400", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  syncing: { label: "Sincronizando", dot: "bg-blue-500 animate-pulse", chip: "bg-blue-50 text-blue-700 ring-blue-200" },
  playing: { label: "Reproduciendo", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  paused: { label: "En pausa", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 ring-slate-200" },
  offline: { label: "Sin conexión", dot: "bg-rose-500 animate-pulse", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  blocked: { label: "Requiere inicio", dot: "bg-amber-400 animate-pulse", chip: "bg-amber-50 text-amber-700 ring-amber-200" },
  error: { label: "Error", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
};

function useClock(timeZone: string | null): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!timeZone) return "--:--:--";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(now);
  } catch {
    return now.toLocaleTimeString();
  }
}

export default function BranchPlayer({ branchKey }: { branchKey: string }) {
  const { state, controls } = useBranchPlayer(branchKey);
  const clock = useClock(state.timezone);
  const meta = STATUS_META[state.status];
  const now = state.now;
  const progress = now && now.duration > 0 ? Math.min(1, state.progress / now.duration) : 0;

  return (
    <main className="min-h-dvh px-4 py-6 sm:px-8">
      {/* Aviso prioritario en vivo */}
      {state.alert && (
        <div className="fixed inset-x-0 top-0 z-50 mx-auto max-w-3xl px-4 pt-4">
          <div className="flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-600 p-4 shadow-xl">
            <TriangleAlert size={22} className="mt-0.5 shrink-0 text-white" />
            <div className="flex-1">
              <p className="text-sm font-black uppercase tracking-wider text-white">
                {state.alert.title || "Aviso prioritario"}
              </p>
              <p className="text-base font-semibold text-white">{state.alert.message}</p>
            </div>
            <button
              onClick={() => controls.current?.dismissAlert()}
              className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-bold text-white hover:bg-white/30"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
        {/* Encabezado */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
              <Radio size={18} />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-blue-400">
                LuxorStereo
              </p>
              <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
                {state.branchName ?? "Sucursal"}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg text-slate-700">{clock}</span>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${meta.chip}`}
            >
              <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
          </div>
        </header>

        {/* Ahora suena */}
        <section className="mt-8 rounded-3xl border border-slate-200 bg-surface p-6 shadow-2xl sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-slate-500">
              {now?.kind === "commercial" ? (
                <>
                  <Megaphone size={14} className="text-amber-600" /> Spot publicitario
                </>
              ) : (
                <>
                  <Music2 size={14} className="text-blue-600" /> Ahora suena
                </>
              )}
            </p>
            <p className="max-w-[50%] truncate text-xs font-semibold text-blue-600">
              {state.playlistName ?? ""}
            </p>
          </div>

          <h2 className="mt-3 truncate text-3xl font-black text-slate-900 sm:text-4xl">
            {now?.title ?? "En espera…"}
          </h2>
          <p className="mt-1 truncate text-lg text-slate-500">
            {now?.artist ?? "—"}
          </p>

          {/* Progreso */}
          <div className="mt-6">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 to-sky-400 transition-[width] duration-300 ease-linear"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-xs text-slate-400">
              <span>{formatDuration(state.progress)}</span>
              <span>{formatDuration(now?.duration ?? 0)}</span>
            </div>
          </div>

          {/* Controles */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => controls.current?.toggle()}
              className="brand-gradient flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg shadow-blue-600/40 transition hover:brightness-110 active:scale-95"
              aria-label={state.status === "playing" ? "Pausar" : "Reproducir"}
            >
              {state.status === "playing" ? (
                <Pause size={26} fill="currentColor" />
              ) : (
                <Play size={26} fill="currentColor" />
              )}
            </button>

            <button
              onClick={() => controls.current?.toggleMute()}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              aria-label="Silenciar"
            >
              {state.muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.muted ? 0 : state.volume}
              onChange={(e) => controls.current?.setVolume(Number(e.target.value))}
              className="w-40"
              aria-label="Volumen"
            />

            <button
              onClick={() => controls.current?.reload()}
              className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <RefreshCw size={16} />
              Sincronizar
            </button>
          </div>
        </section>

        {/* Estado técnico */}
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{state.message}</span>
          <span className="flex items-center gap-3">
            <span
              className={
                state.realtime === "SUBSCRIBED"
                  ? "text-emerald-600"
                  : "text-amber-600"
              }
            >
              ● Tiempo real: {state.realtime ?? "…"}
            </span>
            <span>Latido 15 s</span>
          </span>
        </footer>

        {/* Autorización de audio (política de autoplay del navegador) */}
        {state.status === "blocked" && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="mx-4 max-w-sm rounded-3xl border border-slate-200 bg-surface p-8 text-center shadow-2xl">
              <span className="brand-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white">
                <Volume2 size={28} />
              </span>
              <h3 className="mt-4 text-xl font-bold text-slate-900">
                Iniciar reproducción
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                El navegador requiere un gesto del usuario para reproducir audio.
                Pulsa una vez al abrir la pantalla de esta sucursal.
              </p>
              <button
                onClick={() => controls.current?.toggle()}
                className="brand-gradient mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-base font-bold text-white transition hover:brightness-110"
              >
                <Play size={20} fill="currentColor" />
                Comenzar
              </button>
            </div>
          </div>
        )}

        {/* Fallo de configuración: pantalla de reintento */}
        {state.status === "error" && (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
            <p className="font-semibold text-rose-700">{state.message}</p>
            <button
              onClick={() => controls.current?.reload()}
              className="mt-3 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rose-500"
            >
              Reintentar
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
