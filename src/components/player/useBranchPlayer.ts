"use client";

// Motor de reproducción de sucursal.
//
// Diseño: un único efecto imperativo mantiene el estado mutable (config,
// cola, caché de audio, temporizadores) para evitar closures obsoletas; React
// sólo recibe parches de estado para pintar la interfaz.
//
// Garantías:
//  · Reproducción continua en bucle de la playlist asignada.
//  · Descarga a blob + caché en memoria: si se corta internet, lo ya cargado
//    sigue sonando y se reintenta con backoff exponencial.
//  · Latido cada 15 s (branch_ping) + refresco periódico de la configuración.
//  · Suscripción Realtime a la sucursal: alertas urgentes y recarga remota.

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase, supabaseEnvProblem } from "@/lib/supabase/client";
import {
  branchLocalTime,
  buildQueue,
  pickAssignment,
  pickCommercial,
  spotRequired,
} from "@/lib/schedule";
import type {
  AlertPayload,
  BroadcastAssignment,
  BroadcastTrack,
  BranchBroadcast,
} from "@/lib/types";

export type PlayerStatus =
  | "idle"
  | "connecting"
  | "syncing"
  | "playing"
  | "paused"
  | "offline"
  | "blocked"
  | "error";

export interface NowPlaying {
  id: string;
  title: string;
  artist: string | null;
  kind: "music" | "commercial";
  duration: number;
}

export interface PlayerState {
  status: PlayerStatus;
  message: string;
  branchName: string | null;
  timezone: string | null;
  playlistName: string | null;
  now: NowPlaying | null;
  progress: number;
  volume: number;
  muted: boolean;
  alert: AlertPayload | null;
  realtime: string | null;
  /** Imagen de fondo elegida por el administrador (null = degradado por defecto). */
  backgroundUrl: string | null;
}

export interface PlayerControls {
  start: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  reload: () => void;
  dismissAlert: () => void;
}

/** Acceso de la interfaz al análisis de audio (ondas/visualizadores). */
export interface PlayerEngine {
  /** Analyser FFT conectado al audio; null mientras Web Audio no arranque. */
  analyser: AnalyserNode | null;
}

const HEARTBEAT_MS = 15_000;
const CACHE_LIMIT = 8;
const MAX_BACKOFF_MS = 30_000;
const VOLUME_KEY = "luxor.volume";

function loadVolume(): number {
  if (typeof window === "undefined") return 0.8;
  const raw = Number(window.localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.8;
}

export function useBranchPlayer(branchKey: string) {
  const [state, setState] = useState<PlayerState>(() => ({
    status: "idle",
    message: "Listo para iniciar",
    branchName: null,
    timezone: null,
    playlistName: null,
    now: null,
    progress: 0,
    volume: loadVolume(),
    muted: false,
    alert: null,
    realtime: null,
    backgroundUrl: null,
  }));

  const controlsRef = useRef<PlayerControls | null>(null);
  // Expuesto a la UI para dibujar ondas reales del audio (FFT).
  const engineRef = useRef<PlayerEngine>({ analyser: null });

  useEffect(() => {
    let disposed = false;

    // ---------- estado mutable del motor ----------
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        message: err instanceof Error ? err.message : "Configuración inválida",
      }));
      return;
    }

    // Variables de entorno vacías o de ejemplo: avisamos en pantalla en vez
    // de entrar en un bucle infinito de reintentos contra un dominio inexistente.
    const envProblem = supabaseEnvProblem();
    if (envProblem) {
      setState((s) => ({ ...s, status: "error", message: envProblem }));
      controlsRef.current = {
        start: () => undefined,
        toggle: () => undefined,
        seek: () => undefined,
        setVolume: () => undefined,
        toggleMute: () => undefined,
        reload: () => window.location.reload(),
        dismissAlert: () => undefined,
      };
      return;
    }

    const audio = new Audio();
    audio.preload = "auto";
    // CORS: Supabase Storage responde con Access-Control-Allow-Origin (el
    // fetch de blobs ya lo exige). Sin esto, enrutar el elemento por Web
    // Audio emitiría silencio con URLs remotas.
    audio.crossOrigin = "anonymous";

    let cfg: BranchBroadcast | null = null;
    let assignment: BroadcastAssignment | null = null;
    let queue: BroadcastTrack[] = [];
    let qi = -1;
    let musicSinceSpot = 0;
    let lastSpotAt = Date.now();
    let commercialCursor = 0;
    let currentFileUrl: string | null = null;
    let currentItem: BroadcastTrack | null = null;
    let currentIsSpot = false;
    let started = false;
    let pausedByUser = false;
    let alertActive = false;
    let resumeAfterAlert = false;
    // true si la duración en pantalla del último aviso depende del audio.
    let audioHoldSet = false;
    let attempt = 0;
    let beats = 0;
    let status: PlayerStatus = "idle";
    let netOk = typeof navigator === "undefined" ? true : navigator.onLine;

    const cache = new Map<string, string>();
    // Pistas que este navegador no puede decodificar (códec/contenedor no
    // soportado o archivo corrupto): se saltan y nunca se reintentan.
    const badItems = new Set<string>();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let alertTimer: ReturnType<typeof setTimeout> | null = null;
    let alertAudio: HTMLAudioElement | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    // Canal Realtime de la sucursal (presencia + alertas). Se expone aquí
    // para que trackPresence() funcione antes/después de su creación.
    let channelRef: RealtimeChannel | null = null;
    // Visualizador Web Audio (FFT para la onda del héroe).
    let audioCtx: AudioContext | null = null;
    let analyserNode: AnalyserNode | null = null;
    let sourceNode: MediaElementAudioSourceNode | null = null;

    // ---------- utilidades ----------
    const patch = (p: Partial<PlayerState>) => {
      if (disposed) return;
      const previous = status;
      if (p.status) status = p.status;
      setState((s) => ({ ...s, ...p }));
      // Avisar al panel (presencia) cuando cambia el estado o el tema que
      // suena: así dice en vivo qué se está reproduciendo de verdad.
      if ((p.status && p.status !== previous) || p.now !== undefined) {
        trackPresence();
      }
    };

    /**
     * Presencia Realtime: mientras la pantalla de la sucursal esté abierta
     * publica `{ started, playing, track }` en el canal `branch:<key>`. El
     * panel la lee para saber al instante si un link está en uso, si está
     * sonando y **qué pista suena ahora** — sin depender del log en BD (que
     * puede fallar o atrasarse) ni de que el websocket del admin esté sano.
     */
    function trackPresence() {
      if (!channelRef) return;
      void channelRef
        .track({
          started,
          playing: status === "playing",
          track: currentItem
            ? `${currentItem.title}${currentItem.artist ? ` — ${currentItem.artist}` : ""}`
            : null,
        })
        .catch(() => undefined);
    }

    /**
     * Latido inmediato: se dispara al abrir la pestaña o al volver de estar
     * dormida (los temporizadores de fondo se ralentizan y podían dejar el
     * last_ping fuera de la ventana de «En línea» aunque sí sonara).
     */
    async function pingNow(): Promise<void> {
      if (disposed) return;
      const { error } = await supabase.rpc("branch_ping", {
        p_branch_key: branchKey,
      });
      if (disposed) return;
      if (!error) {
        netOk = true;
        return;
      }
      netOk = false;
      if (started) scheduleRetry(recover);
    }

    const backoff = () =>
      Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5)) +
      Math.random() * 400;

    function scheduleRetry(fn: () => void | Promise<void>) {
      if (disposed) return;
      if (retryTimer) clearTimeout(retryTimer);
      const delay = backoff();
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void fn();
      }, delay);
    }

    async function loadConfig(): Promise<void> {
      const { data, error } = await supabase.rpc("get_branch_broadcast", {
        p_branch_key: branchKey,
      });
      if (error) throw error;
      if (disposed) return;
      cfg = data as unknown as BranchBroadcast;
      patch({
        branchName: cfg.branch.name,
        timezone: cfg.branch.timezone,
        backgroundUrl: cfg.settings?.player_background || null,
      });
    }

    async function logPlay(trackId: string) {
      // Fire & forget: la auditoría nunca debe bloquear el audio.
      const { error } = await supabase.rpc("log_play", {
        p_branch_key: branchKey,
        p_track_id: trackId,
      });
      if (error && !disposed) console.debug("[luxor] log_play:", error.message);
    }

    function resolveQueue(): boolean {
      if (!cfg) return false;
      const local = branchLocalTime(cfg.branch.timezone);
      const wanted = pickAssignment(cfg.assignments, local.minutes);

      if (!wanted) {
        queue = [];
        assignment = null;
        patch({
          status: "error",
          message: "Sin playlists asignadas a esta sucursal",
        });
        return false;
      }

      if (!assignment || assignment.id !== wanted.id) {
        assignment = wanted;
        queue = buildQueue(wanted);
        qi = -1;
        patch({ playlistName: wanted.playlist_name });
      }
      return queue.length > 0;
    }

    function evictCache() {
      while (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        if (oldest === currentFileUrl && cache.size === 1) break;
        const url = cache.get(oldest);
        cache.delete(oldest);
        if (url) URL.revokeObjectURL(url);
      }
    }

    /**
     * Descarga el MP3 a un blob y lo sirve desde un objectURL (caché local).
     * Si la descarga falla, devuelve la URL original para que el <audio> haga
     * streaming directo: nunca se queda sin intentar reproducir.
     */
    async function resolveUrl(fileUrl: string): Promise<string> {
      const cached = cache.get(fileUrl);
      if (cached) return cached;

      try {
        const res = await fetch(fileUrl, { cache: "force-cache" });
        if (!res.ok) throw new Error(`download_failed:${res.status}`);
        const blob = await res.blob();
        if (disposed) throw new Error("disposed");

        const objectUrl = URL.createObjectURL(blob);
        cache.set(fileUrl, objectUrl);
        evictCache();
        return objectUrl;
      } catch (err) {
        if (disposed) throw err;
        return fileUrl;
      }
    }

    function prefetchNext() {
      if (!assignment || queue.length === 0) return;
      const nextTrack = queue[(qi + 1) % queue.length];
      if (!nextTrack || cache.has(nextTrack.file_url)) return;
      resolveUrl(nextTrack.file_url).catch(() => {
        // fallo silencioso: se reintentará al tocarle el turno
      });
    }

    async function onPlayError(
      err: unknown,
      item: BroadcastTrack,
      isSpot: boolean,
    ): Promise<void> {
      if (disposed) return;
      const name = (err as { name?: string })?.name;

      if (name === "NotAllowedError") {
        patch({
          status: "blocked",
          message: "Pulsa «Iniciar reproducción» para autorizar el audio",
        });
        return;
      }
      if (name === "NotSupportedError") {
        // Formato que el navegador no soporta: saltar a la siguiente pista.
        skipBadItem(item);
        return;
      }
      if (name === "AbortError") return; // fuente sustituida a mitad de carga

      netOk = false;
      patch({
        status: "offline",
        message: navigator.onLine
          ? "Error de red reintentando…"
          : "Sin internet · reproduciendo desde caché",
      });
      retryItem(item, isSpot);
    }

    /** Reintenta el tema actual sólo si sigue siendo el que está en pantalla. */
    function retryItem(item: BroadcastTrack, isSpot: boolean) {
      scheduleRetry(() => {
        if (disposed || currentItem?.id !== item.id) return;
        void playItem(item, isSpot);
      });
    }

    /**
     * El navegador no puede decodificar esta pista (formato/códec no
     * soportado o datos corruptos): se marca como mala y se pasa a la
     * siguiente. Un archivo que nunca va a sonar no debe reintentarse, para
     * no atascar la emisión de la sucursal.
     */
    function skipBadItem(item: BroadcastTrack) {
      if (badItems.has(item.id)) return; // ya gestionada (evento + promesa)
      badItems.add(item.id);
      console.warn("[luxor] pista no reproducible, se omite:", item.title);
      if (currentItem?.id === item.id) currentItem = null;
      patch({ status: "syncing", message: "Formato no soportado; saltando…" });
      setTimeout(() => {
        if (!disposed && started) void next();
      }, 600);
    }

    async function playItem(item: BroadcastTrack, isSpot: boolean): Promise<void> {
      if (disposed) return;
      patch({
        status: "syncing",
        message: isSpot ? "Cargando spot…" : "Cargando tema…",
        progress: 0,
        now: {
          id: item.id,
          title: item.title,
          artist: item.artist,
          kind: item.type === "commercial" ? "commercial" : "music",
          duration: item.duration ?? 0,
        },
      });

      try {
        const objectUrl = await resolveUrl(item.file_url);
        if (disposed) return;

        currentFileUrl = item.file_url;
        currentItem = item;
        currentIsSpot = isSpot;
        audio.src = objectUrl;
        audio.load();
        await audio.play();
        if (disposed) return;

        attempt = 0;
        netOk = true;

        if (isSpot) {
          musicSinceSpot = 0;
          lastSpotAt = Date.now();
        } else {
          musicSinceSpot += 1;
        }

        patch({
          status: "playing",
          message: isSpot
            ? "Spot publicitario"
            : `Reproduciendo · ${assignment?.playlist_name ?? ""}`,
        });

        void logPlay(item.id);
        prefetchNext();
      } catch (err) {
        await onPlayError(err, item, isSpot);
      }
    }

    async function next(): Promise<void> {
      if (disposed || !started || !cfg) return;

      // Cambio de franja horaria: recoloca la cola al instante.
      const local = branchLocalTime(cfg.branch.timezone);
      const wanted = pickAssignment(cfg.assignments, local.minutes);
      if (wanted && (!assignment || wanted.id !== assignment.id)) {
        assignment = wanted;
        queue = buildQueue(wanted);
        qi = -1;
        patch({ playlistName: wanted.playlist_name });
      }

      if (queue.length === 0 && !resolveQueue()) return;

      const wantSpot = spotRequired(
        assignment?.schedule_rules,
        musicSinceSpot,
        Date.now() - lastSpotAt,
      );

      let item: BroadcastTrack | null = null;
      let isSpot = false;

      if (wantSpot) {
        item = pickCommercial(assignment, cfg.commercials, commercialCursor);
        if (item) {
          isSpot = true;
          commercialCursor += 1;
          // Spot que este navegador no puede decodificar: se omite y sigue
          // la música sin cortar la emisión.
          if (badItems.has(item.id)) item = null;
        }
      }

      if (!item) {
        // Avanzar por la cola saltando las pistas marcadas como no
        // reproducibles en este navegador (nunca en bucle: si toda la cola
        // es mala se detiene con un error claro).
        let guard = 0;
        do {
          qi = (qi + 1) % queue.length;
          item = queue[qi];
          guard += 1;
        } while (item && badItems.has(item.id) && guard <= queue.length);

        if (item && badItems.has(item.id)) {
          patch({
            status: "error",
            message: "Ninguna pista de la playlist es reproducible en este navegador",
          });
          return;
        }
      }

      if (!item) {
        patch({ status: "error", message: "Playlist vacía" });
        return;
      }

      await playItem(item, isSpot);
    }

    async function recover(): Promise<void> {
      if (disposed) return;
      try {
        await loadConfig();
        resolveQueue();
        attempt = 0;
        netOk = true;
        if (!pausedByUser && !alertActive && audio.paused && started) {
          await audio.play();
        }
        patch({
          status: audio.paused ? (pausedByUser ? "paused" : "syncing") : "playing",
          message: "Reconectado",
        });
      } catch {
        netOk = false;
        patch({ status: "offline", message: "Sin conexión con el centro…" });
        scheduleRetry(recover);
      }
    }

    async function boot(): Promise<void> {
      if (disposed) return;
      patch({ status: "connecting", message: "Conectando con el centro…" });
      try {
        await loadConfig();
        if (disposed) return;
        if (!resolveQueue()) {
          if (queue.length === 0 && assignment === null) return; // error ya pintado
          // playlist asignada pero sin música
          patch({ status: "error", message: "La playlist no contiene música" });
          started = false;
          return;
        }
        attempt = 0;
        netOk = true;
        qi = -1;
        await next();
      } catch (err) {
        if (disposed) return;
        netOk = false;
        patch({
          status: "offline",
          message:
            typeof navigator !== "undefined" && !navigator.onLine
              ? "Sin internet · reintentando"
              : `No se pudo conectar: ${(err as Error)?.message ?? "error"}`,
        });
        scheduleRetry(boot);
      }
    }

    function start() {
      if (started) return;
      started = true;
      pausedByUser = false;
      void boot();
    }

    async function reload() {
      if (disposed) return;
      try {
        await loadConfig();
        if (disposed) return;
        const previous = assignment?.id;
        resolveQueue();
        if (assignment && assignment.id !== previous) {
          qi = -1;
          void next();
        }
        patch({ message: "Configuración actualizada" });
      } catch {
        patch({ status: "offline", message: "Sin conexión con el centro…" });
        scheduleRetry(reload);
      }
    }

    // ---------- alertas en vivo ----------
    function finishAlert() {
      if (alertTimer) {
        clearTimeout(alertTimer);
        alertTimer = null;
      }
      if (alertAudio) {
        alertAudio.pause();
        alertAudio.removeAttribute("src");
        alertAudio = null;
      }
      alertActive = false;
      audioHoldSet = false;
      patch({ alert: null });
      if (resumeAfterAlert && !pausedByUser && started) {
        void audio.play().catch(() => undefined);
      }
      resumeAfterAlert = false;
    }

    /**
     * La música se reanuda al terminar el spot de alerta SIN cerrar el
     * mensaje si aún queda periodo estático por cumplir (el cierre lo
     * gobierna alertTimer / «Entendido»).
     */
    function resumeMusicAfterSpot() {
      if (resumeAfterAlert && !pausedByUser && started && !disposed) {
        void audio.play().catch(() => undefined);
      }
      resumeAfterAlert = false;
    }

    async function showAlert(payload: AlertPayload) {
      if (disposed || !payload) return;
      if (alertActive) finishAlert();

      const hasAudio = Boolean(payload.audio_url);
      const explicitHold =
        typeof payload.hold_seconds === "number" && payload.hold_seconds >= 0
          ? payload.hold_seconds
          : null;

      // La música sólo se silencia si el aviso trae audio (spot).
      resumeAfterAlert = hasAudio && !audio.paused;
      alertActive = true;
      audioHoldSet = false;
      patch({ alert: payload });
      if (hasAudio) {
        patch({ status: "syncing", message: "Aviso prioritario" });
        audio.pause();
      }

      // Reserva para mensajes sólo texto (también usada si el audio falla).
      const textHoldMs = Math.min(
        30_000,
        Math.max(8_000, (payload.message?.length ?? 0) * 90),
      );

      if (explicitHold !== null) {
        // Permanencia elegida por el operador: 0 = hasta «Entendido».
        if (explicitHold > 0) alertTimer = setTimeout(finishAlert, explicitHold * 1000);
      } else if (!hasAudio) {
        // Sólo texto: el mensaje se cierra solo… y la música NO se corta.
        alertTimer = setTimeout(finishAlert, textHoldMs);
      }
      // Con audio y sin periodo explícito: el mensaje dura exactamente lo
      // que el spot (se programa al conocer la duración real del archivo).

      if (hasAudio && payload.audio_url) {
        try {
          const el = new Audio(payload.audio_url);
          alertAudio = el;

          el.onloadedmetadata = () => {
            if (disposed || !alertActive || explicitHold !== null) return;
            if (Number.isFinite(el.duration) && el.duration > 0) {
              if (alertTimer) clearTimeout(alertTimer);
              alertTimer = setTimeout(finishAlert, Math.round(el.duration * 1000) + 700);
              audioHoldSet = true;
            } else if (!audioHoldSet) {
              audioHoldSet = true;
              alertTimer = setTimeout(finishAlert, textHoldMs);
            }
          };

          el.onended = resumeMusicAfterSpot;
          el.onerror = () => {
            resumeMusicAfterSpot();
            if (!audioHoldSet && explicitHold === null) {
              audioHoldSet = true;
              alertTimer = setTimeout(finishAlert, textHoldMs);
            }
          };

          await el.play();
          // Seguridad: si no llegaron los metadatos, no dejar el mensaje
          // pegado para siempre (salvo permanencia explícita).
          if (!audioHoldSet && explicitHold === null) {
            audioHoldSet = true;
            alertTimer = setTimeout(finishAlert, textHoldMs + 10_000);
          }
        } catch {
          resumeMusicAfterSpot();
          if (!audioHoldSet && explicitHold === null) {
            audioHoldSet = true;
            alertTimer = setTimeout(finishAlert, textHoldMs);
          }
        }
      }
    }

    // ---------- visualizador (Web Audio) ----------
    /**
     * Conecta el elemento de audio a un AnalyserNode para que la interfaz
     * dibuje la forma de onda real. **Sólo se rutea si el AudioContext está
     * "running"**: si se ruteara en estado suspendido, la música saldría en
     * silencio (pantallas con autoplay sin gesto), así que en ese caso la
     * reproducción sigue su ruta normal y el análisis se conecta después,
     * cuando haya un gesto del usuario.
     */
    function routeAudio() {
      if (sourceNode || !audioCtx || audioCtx.state !== "running") return;
      try {
        sourceNode = audioCtx.createMediaElementSource(audio);
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 2048;
        analyserNode.smoothingTimeConstant = 0.82;
        sourceNode.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);
        engineRef.current.analyser = analyserNode;
      } catch {
        sourceNode = null;
        analyserNode = null;
        engineRef.current.analyser = null;
      }
    }

    /** Crea (una sola vez) el AudioContext y rutear el FFT si se puede. */
    function ensureVisualizer() {
      try {
        if (!audioCtx) {
          const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (!Ctor) return;
          audioCtx = new Ctor();
        }
        if (audioCtx.state === "suspended") {
          void audioCtx
            .resume()
            .then(routeAudio)
            .catch(() => undefined);
          return;
        }
        routeAudio();
      } catch {
        /* sin Web Audio: la onda degrada a animación decorativa */
      }
    }

    // ---------- eventos de audio ----------
    audio.addEventListener("ended", () => {
      void next();
    });
    audio.addEventListener("timeupdate", () => {
      if (disposed) return;
      patch({ progress: audio.currentTime });
    });
    audio.addEventListener("loadedmetadata", () => {
      if (disposed || !currentItem) return;
      const duration = audio.duration || currentItem.duration;
      patch({
        now: {
          id: currentItem.id,
          title: currentItem.title,
          artist: currentItem.artist,
          kind: currentItem.type === "commercial" ? "commercial" : "music",
          duration,
        },
      });
    });
    audio.addEventListener("play", () => {
      if (disposed) return;
      // Con audio fluyendo (y tras el gesto de inicio) el FFT ya puede rutear.
      ensureVisualizer();
      if (!alertActive) patch({ status: "playing" });
    });
    audio.addEventListener("pause", () => {
      if (disposed || alertActive || !started) return;
      patch({
        status: pausedByUser ? "paused" : "syncing",
        message: pausedByUser ? "En pausa" : "Reanudando…",
      });
    });
    audio.addEventListener("error", () => {
      if (disposed || !started || !audio.src || alertActive) return;
      if (!currentItem) return;
      const code = audio.error?.code;
      // 2 = datos corruptos · 4 = formato no soportado: irrecuperable,
      // se salta la pista. El resto (1 = red) sí se reintenta.
      if (code === 2 || code === 4) {
        skipBadItem(currentItem);
        return;
      }
      netOk = false;
      patch({ status: "offline", message: "Error de reproducción; reintentando…" });
      retryItem(currentItem, currentIsSpot);
    });

    // ---------- red ----------
    // Al volver a la vista (pestaña dormida/oculta o reconexión) se fuerza
    // presencia + latido: los temporizadores en segundo plano se ralentizan y
    // el last_ping podía quedar fuera de la ventana de «En línea» aunque el
    // link siguiera sonando.
    const resync = () => {
      if (disposed) return;
      trackPresence();
      void pingNow();
    };
    const onVisible = () => {
      if (!document.hidden) resync();
    };
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", onVisible);

    // Gesto del usuario: si el AudioContext quedó suspendido (autoplay sin
    // permiso), se reanuda aquí para poder conectar el FFT sin cortar audio.
    const onGesture = () => {
      if (!audioCtx) return;
      void audioCtx
        .resume()
        .then(routeAudio)
        .catch(() => undefined);
    };
    window.addEventListener("pointerdown", onGesture);

    const onOnline = () => {
      netOk = true;
      resync();
      if (started) void recover();
    };
    const onOffline = () => {
      netOk = false;
      patch({
        status: "offline",
        message: "Sin internet · reproduciendo desde caché",
      });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // ---------- realtime ----------
    const channel = supabase.channel(`branch:${branchKey}`);
    channelRef = channel;
    channel.on("broadcast", { event: "alert" }, ({ payload }) => {
      void showAlert(payload as unknown as AlertPayload);
    });
    channel.on("broadcast", { event: "reload" }, () => {
      void reload();
    });
    channel.subscribe((s) => {
      patch({ realtime: s });
      if (s === "SUBSCRIBED") {
        // El canal acaba de (re)conectar: republicar presencia y latido.
        trackPresence();
        void pingNow();
      }
    });

    // ---------- latido + refresco periódico ----------
    heartbeat = setInterval(async () => {
      if (disposed) return;
      beats += 1;

      const { error } = await supabase.rpc("branch_ping", {
        p_branch_key: branchKey,
      });
      if (disposed) return;

      if (error) {
        netOk = false;
        if (status === "playing" || status === "syncing") {
          patch({ status: "offline", message: "Conexión inestable…" });
        }
        if (started) scheduleRetry(recover);
      } else if (!netOk) {
        netOk = true;
        if (started) void recover();
      } else if (started && beats % 4 === 0) {
        // Cada ~1 minuto refresca la configuración por si no llegó el broadcast.
        void reload();
      }
    }, HEARTBEAT_MS);

    // ---------- controles expuestos ----------
    controlsRef.current = {
      start,
      toggle: () => {
        if (!started || !audio.src) {
          started = false;
          start();
          return;
        }
        if (audio.paused) {
          pausedByUser = false;
          void audio.play().catch((err) => {
            const item = currentItem ?? queue[qi];
            if (item) void onPlayError(err, item, false);
          });
        } else {
          pausedByUser = true;
          audio.pause();
        }
      },
      seek: (seconds: number) => {
        if (Number.isFinite(seconds)) audio.currentTime = Math.max(0, seconds);
      },
      setVolume: (value: number) => {
        const v = Math.min(1, Math.max(0, value));
        audio.volume = v;
        if (v > 0 && audio.muted) audio.muted = false;
        try {
          window.localStorage.setItem(VOLUME_KEY, String(v));
        } catch {
          /* almacenamiento no disponible */
        }
        patch({ volume: v, muted: audio.muted });
      },
      toggleMute: () => {
        audio.muted = !audio.muted;
        patch({ muted: audio.muted });
      },
      reload: () => void reload(),
      dismissAlert: finishAlert,
    };

    audio.volume = loadVolume();

    // ---------- arranque ----------
    start();

    // ---------- limpieza ----------
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (alertTimer) clearTimeout(alertTimer);
      if (heartbeat) clearInterval(heartbeat);
      void channel.unsubscribe();
      audio.pause();
      audio.removeAttribute("src");
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", onGesture);
      engineRef.current.analyser = null;
      try {
        analyserNode?.disconnect();
        sourceNode?.disconnect();
      } catch {
        /* nodos ya desconectados */
      }
      void audioCtx?.close().catch(() => undefined);
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
      controlsRef.current = null;
    };
  }, [branchKey]);

  return { state, controls: controlsRef, engine: engineRef };
}
