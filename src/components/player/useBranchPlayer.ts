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
  }));

  const controlsRef = useRef<PlayerControls | null>(null);

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
    let attempt = 0;
    let beats = 0;
    let status: PlayerStatus = "idle";
    let netOk = typeof navigator === "undefined" ? true : navigator.onLine;

    const cache = new Map<string, string>();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let alertTimer: ReturnType<typeof setTimeout> | null = null;
    let alertAudio: HTMLAudioElement | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    // ---------- utilidades ----------
    const patch = (p: Partial<PlayerState>) => {
      if (disposed) return;
      if (p.status) status = p.status;
      setState((s) => ({ ...s, ...p }));
    };

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
      patch({ branchName: cfg.branch.name, timezone: cfg.branch.timezone });
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
        }
      }

      if (!item) {
        qi = (qi + 1) % queue.length;
        item = queue[qi];
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
      patch({ alert: null });
      if (resumeAfterAlert && !pausedByUser && started) {
        void audio.play().catch(() => undefined);
      }
      resumeAfterAlert = false;
    }

    async function showAlert(payload: AlertPayload) {
      if (disposed || !payload) return;
      if (alertActive) finishAlert();

      resumeAfterAlert = !audio.paused;
      alertActive = true;
      patch({ alert: payload, status: "syncing", message: "Aviso prioritario" });
      audio.pause();

      const holdMs = Math.min(
        30_000,
        Math.max(8_000, (payload.message?.length ?? 0) * 90),
      );
      alertTimer = setTimeout(finishAlert, holdMs);

      if (payload.audio_url) {
        try {
          const el = new Audio(payload.audio_url);
          alertAudio = el;
          el.onended = finishAlert;
          el.onerror = finishAlert;
          await el.play();
        } catch {
          // sin audio: el aviso visual ya está en pantalla
        }
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
      if (!alertActive && !disposed) patch({ status: "playing" });
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
      netOk = false;
      patch({ status: "offline", message: "Error de reproducción; reintentando…" });
      retryItem(currentItem, currentIsSpot);
    });

    // ---------- red ----------
    const onOnline = () => {
      netOk = true;
      void recover();
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
    channel.on("broadcast", { event: "alert" }, ({ payload }) => {
      void showAlert(payload as unknown as AlertPayload);
    });
    channel.on("broadcast", { event: "reload" }, () => {
      void reload();
    });
    channel.subscribe((s) => patch({ realtime: s }));

    // ---------- latido + refresco periódico ----------
    heartbeat = setInterval(async () => {
      if (disposed || !started) return;
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
        scheduleRetry(recover);
      } else if (!netOk) {
        void recover();
      } else if (beats % 4 === 0) {
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
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
      controlsRef.current = null;
    };
  }, [branchKey]);

  return { state, controls: controlsRef };
}
