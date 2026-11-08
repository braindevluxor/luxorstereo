"use client";

// Vista de la sucursal (tablet, PC o Raspberry Pi con navegador): hero a
// pantalla completa con la imagen de fondo elegida por el administrador
// (o un degradado corporativo si no hay imagen) + barra inferior de control.
// Se deja abierta en pantalla completa: /branch?key=<branch_key>

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
import { useSlideIndex } from "@/components/useSlideIndex";
import WaveCanvas from "./WaveCanvas";
import {
  useBranchPlayer,
  type PlayerStatus,
} from "./useBranchPlayer";

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

// Palabra gigante del hero según el estado (estilo referencia "PLAY.").
const HERO_WORD: Record<PlayerStatus, string> = {
  idle: "ON AIR.",
  connecting: "ON AIR.",
  syncing: "ON AIR.",
  playing: "PLAY.",
  paused: "PAUSE.",
  offline: "LIVE.",
  blocked: "START.",
  error: "ON AIR.",
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
  const { state, controls, engine } = useBranchPlayer(branchKey);
  const clock = useClock(state.timezone);
  const meta = STATUS_META[state.status];
  const now = state.now;
  const progress = now && now.duration > 0 ? Math.min(1, state.progress / now.duration) : 0;
  const playing = state.status === "playing";

  // Fondo: carrusel de imágenes si el administrador las configuró; si no, la
  // imagen única anterior y, en último caso, el degradado corporativo.
  const bgLayers =
    state.backgroundUrls.length > 0
      ? state.backgroundUrls
      : state.backgroundUrl
        ? [state.backgroundUrl]
        : [];
  const slideIndex = useSlideIndex(bgLayers.length);
  const activeSlide =
    bgLayers.length > 0 ? Math.min(slideIndex, bgLayers.length - 1) : -1;

  // La palabra del héroe: picos, barras y orbe se dibujan a su lado
  // (nunca por detrás); ondas y curvas sí la cruzan, como en la referencia.
  const wordRef = useRef<HTMLHeadingElement>(null);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden text-white">
      {/* Fondo: carrusel / imagen elegida por el administrador (o degradado) */}
      <div className="absolute inset-0">
        {bgLayers.length === 0 ? (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(1000px 600px at 20% 0%, rgba(37,99,235,0.55), transparent 60%), radial-gradient(800px 500px at 100% 20%, rgba(56,189,248,0.35), transparent 55%), linear-gradient(160deg, #0a0e17 0%, #0d1526 100%)",
            }}
          />
        ) : (
          bgLayers.map((url, i) => (
            <div
              key={`${i}:${url}`}
              className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000"
              style={{
                backgroundImage: `url("${url}")`,
                opacity: i === activeSlide ? 1 : 0,
              }}
            />
          ))
        )}
      </div>
      {/* Legibilidad del texto sobre cualquier imagen */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-transparent to-black/55" />

      {/* Aviso prioritario en vivo */}
      {state.alert && (
        <div className="fixed inset-x-0 top-0 z-50 mx-auto max-w-3xl px-4 pt-4">
          <div className="flex items-start gap-3 rounded-2xl border border-rose-500/50 bg-rose-600/95 p-4 shadow-2xl backdrop-blur">
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

      {/* Cabecera */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-10 sm:py-6">
        <div className="flex items-center gap-3">
          <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-lg shadow-blue-900/50">
            <Radio size={20} />
          </span>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-white/60">
              LuxorStereo
            </p>
            <h1 className="text-lg font-bold text-white">
              {state.branchName ?? "Sucursal"}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg text-white/90">{clock}</span>
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${meta.chip}`}
            title={state.message}
          >
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        </div>
      </header>

      {/* Hero: palabra gigante + ahora suena */}
      <section className="relative z-10 flex flex-1 items-center px-5 py-6 sm:px-10">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em] text-sky-400">
            {now?.kind === "commercial" ? (
              <>
                <Megaphone size={14} /> Spot publicitario
              </>
            ) : (
              <>
                <Music2 size={14} /> {state.playlistName ?? "Radio corporativa"}
              </>
            )}
          </p>

          <div className="relative mt-1">
            {/* Onda sonora a la altura de la palabra (FFT real del audio).
                Lienzo ancho para los 5 tipos: los picos, barras y orbe se
                recortan junto a la palabra (avoid) y llegan al borde de la
                pantalla; ondas y curvas la cruzan enteras. */}
            {state.wave.visible && (
              <WaveCanvas
                cfg={state.wave}
                engine={engine}
                playing={playing}
                avoid={wordRef}
                className={`pointer-events-none absolute left-1/2 top-1/2 w-[200vw] -translate-x-1/2 -translate-y-1/2 ${
                  // El orbe es una esfera: necesita más altura para verse grande.
                  state.wave.type === "disco" ? "h-80" : "h-44"
                }`}
              />
            )}
            <h2
              ref={wordRef}
              className="relative text-[clamp(4rem,13vw,9.5rem)] font-black uppercase leading-[0.85] tracking-tight drop-shadow-[0_10px_40px_rgba(0,0,0,0.6)]"
            >
              {HERO_WORD[state.status]}
            </h2>
          </div>

          <p className="mt-5 max-w-lg truncate text-lg font-bold text-white sm:text-xl">
            {now?.title ?? "En espera…"}
            {now?.artist ? ` — ${now.artist}` : ""}
          </p>

          {/* Fallo de configuración: aviso + reintento */}
          {state.status === "error" && (
            <div className="mt-5 max-w-md rounded-2xl border border-rose-500/40 bg-black/60 p-4 backdrop-blur">
              <p className="flex items-center gap-2 text-sm font-semibold text-rose-400">
                <TriangleAlert size={16} className="shrink-0" />
                {state.message}
              </p>
              <button
                onClick={() => controls.current?.reload()}
                className="mt-3 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-500"
              >
                Reintentar
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Barra inferior de control (estilo referencia) */}
      <div className="relative z-20 px-4 pb-5 sm:px-10 sm:pb-8">
        <div className="mx-auto flex max-w-5xl items-center gap-4 rounded-3xl bg-black/60 p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl sm:gap-5 sm:p-5">
          {/* Disco: GIF animado sobre un vinilo estático de respaldo. Si el
              GIF tarda, no carga o el navegador lo bloquea, siempre se ve el
              disco (el GIF se oculta con onError, sin icono roto). */}
          <span
            className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl sm:h-20 sm:w-20"
            aria-hidden="true"
          >
            <span className="absolute inset-0 rounded-2xl bg-slate-900 ring-1 ring-inset ring-slate-500/50" />
            <img
              src="/disco-rojo.gif"
              alt=""
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </span>

          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-sky-400">
              Sonando ahora
            </p>
            <p className="truncate text-base font-bold text-white sm:text-lg">
              {now?.title ?? "En espera…"}
            </p>
            <p className="truncate text-sm text-white/60">{now?.artist ?? "—"}</p>
          </div>

          {/* Progreso + ecualizador (pantallas medianas en adelante) */}
          <div className="hidden flex-1 items-center gap-4 md:flex">
            <span className="font-mono text-xs text-white/60">
              {formatDuration(state.progress)}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-sky-400 transition-[width] duration-300 ease-linear"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <span className="font-mono text-xs text-white/60">
              {formatDuration(now?.duration ?? 0)}
            </span>
          </div>

          {/* Acciones */}
          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              onClick={() => controls.current?.toggleMute()}
              className="hidden rounded-xl p-3 text-white/80 transition hover:bg-white/10 hover:text-white sm:block"
              aria-label={state.muted ? "Activar sonido" : "Silenciar"}
            >
              {state.muted ? <VolumeX size={22} /> : <Volume2 size={22} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.muted ? 0 : state.volume}
              onChange={(e) => controls.current?.setVolume(Number(e.target.value))}
              // --vol gobierna el recorte del degradado: el color se
              // descubre sólo hasta el nivel actual del pulgar.
              style={{ "--vol": String(state.muted ? 0 : state.volume) } as CSSProperties}
              className="volume-gradient hidden w-28 sm:block"
              aria-label="Volumen"
            />
            <button
              onClick={() => controls.current?.reload()}
              className="hidden rounded-xl p-3 text-white/80 transition hover:bg-white/10 hover:text-white sm:block"
              aria-label="Sincronizar"
              title="Sincronizar con el centro"
            >
              <RefreshCw size={20} />
            </button>
            <button
              onClick={() => controls.current?.toggle()}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105 active:scale-95"
              aria-label={playing ? "Pausar" : "Reproducir"}
            >
              {playing ? (
                <Pause size={28} fill="currentColor" />
              ) : (
                <Play size={28} fill="currentColor" className="ml-0.5" />
              )}
            </button>
          </div>
        </div>

        <p
          className="mt-2 text-center text-[11px] text-white/40"
          title={state.message}
        >
          {state.message} · latido 15 s
        </p>
      </div>

      {/* Autorización de audio (política de autoplay del navegador) */}
      {state.status === "blocked" && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="mx-4 max-w-sm rounded-3xl border border-white/10 bg-[#101725] p-8 text-center shadow-2xl">
            <span className="brand-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white">
              <Volume2 size={28} />
            </span>
            <h3 className="mt-4 text-xl font-bold text-white">
              Iniciar reproducción
            </h3>
            <p className="mt-2 text-sm text-white/60">
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
    </main>
  );
}
