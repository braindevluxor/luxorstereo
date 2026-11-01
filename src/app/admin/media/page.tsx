"use client";

// Librería de medios: subida a Supabase Storage y gestión de metadatos.
// Vista con panel lateral (búsqueda + importación arriba, filtros debajo),
// barra de reproductor arriba y lista de pistas reproducibles con clic.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Disc3,
  Library,
  ListMusic,
  Megaphone,
  Music2,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/schedule";
import type { Track, TrackType } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Spinner,
  inputClass,
} from "@/components/ui";

const BUCKET = "audio";

// Formatos que el navegador —y por tanto la emisión— puede reproducir.
// Incluye la familia MPEG (.mp3/.mp2/.mpg/.mpeg): si el contenido es audio
// MPEG el navegador lo decodifica aunque la extensión sea rara.
const AUDIO_EXT = [
  "mp3", "mpga", "mp2", "mpg", "mpeg", "m4a", "mp4", "aac",
  "ogg", "oga", "opus", "wav", "flac", "aif", "aiff", "webm",
];

// Tipo MIME a guardar por extensión: el navegador suele reportar
// «video/mpeg» para .mpg/.mpeg que en realidad son audio MPEG.
const EXT_MIME: Record<string, string> = {
  mp3: "audio/mpeg", mpga: "audio/mpeg", mp2: "audio/mpeg",
  mpg: "audio/mpeg", mpeg: "audio/mpeg",
  m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  wav: "audio/wav", flac: "audio/flac",
  aif: "audio/aiff", aiff: "audio/aiff", webm: "audio/webm",
};

type Filter = "all" | TrackType;

/** Lee la duración real del archivo local antes de subirlo. */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    let settled = false;
    const done = (seconds: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(seconds) ? Math.round(seconds) : 0);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    setTimeout(() => done(0), 10_000);
    el.src = url;
  });
}

export default function MediaPage() {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [type, setType] = useState<TrackType>("music");
  const [artist, setArtist] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [filterType, setFilterType] = useState<Filter>("all");
  const [showUpload, setShowUpload] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ---------- reproductor de previsualización ----------
  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const visibleRef = useRef<Track[]>([]);
  const currentRef = useRef<Track | null>(null);
  const stepRef = useRef<(dir: 1 | -1) => void>(() => undefined);

  const load = useCallback(async () => {
    const { data, error: err } = await getSupabase()
      .from("tracks")
      .select("*")
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      return;
    }
    setTracks((data as Track[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    visibleRef.current = visible;
    currentRef.current = current;
  });

  // Un único <audio> para previsualizar desde la lista y la barra superior.
  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    audioRef.current = a;

    const onTime = () => setPosition(a.currentTime);
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => stepRef.current(1);
    const onError = () => {
      setPlaying(false);
      const t = currentRef.current;
      if (t) setError(`No se pudo reproducir «${t.title}»: revisa la URL pública del archivo.`);
    };

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);

    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
      a.pause();
      a.removeAttribute("src");
      audioRef.current = null;
    };
  }, []);

  /** Reproduce la pista indicada; si ya es la actual, alterna play/pausa. */
  function toggleTrack(track: Track) {
    const a = audioRef.current;
    if (!a) return;

    if (current?.id === track.id) {
      if (a.paused) void a.play().catch(() => setPlaying(false));
      else a.pause();
      return;
    }

    setError(null);
    setCurrent(track);
    setPosition(0);
    setDuration(track.duration ?? 0);
    a.src = track.file_url;
    a.volume = volume;
    a.muted = muted;
    void a.play().catch(() => {
      setPlaying(false);
      setError(`No se pudo reproducir «${track.title}»: revisa la URL pública del archivo.`);
    });
  }

  /** Avanza/retrocede dentro de la lista visible (con bucle). */
  function step(dir: 1 | -1) {
    const list = visibleRef.current;
    if (list.length === 0) return;
    const idx = currentRef.current
      ? list.findIndex((t) => t.id === currentRef.current!.id)
      : -1;
    const next =
      idx === -1
        ? dir === 1
          ? 0
          : list.length - 1
        : (idx + dir + list.length) % list.length;
    toggleTrack(list[next]);
  }
  stepRef.current = step;

  function toggleMain() {
    const a = audioRef.current;
    if (!a) return;
    if (current && visibleRef.current.some((t) => t.id === current.id)) {
      if (a.paused) void a.play().catch(() => setPlaying(false));
      else a.pause();
      return;
    }
    step(1);
  }

  function seek(value: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = value;
    setPosition(value);
  }

  function applyVolume(value: number) {
    const a = audioRef.current;
    const v = Math.min(1, Math.max(0, value));
    setVolume(v);
    if (a) {
      a.volume = v;
      if (v > 0 && a.muted) a.muted = false;
    }
    setMuted(false);
  }

  function toggleMute() {
    const a = audioRef.current;
    const next = !muted;
    setMuted(next);
    if (a) a.muted = next;
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!files || files.length === 0) return;

    setError(null);
    const supabase = getSupabase();
    const failures: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`Subiendo ${i + 1}/${files.length}: ${file.name}`);

      const ext = file.name.includes(".") ? file.name.split(".").pop()! : "mp3";
      const extLc = ext.toLowerCase();
      const title = file.name.replace(/\.[^.]+$/, "").replaceAll("_", " ");

      // Validación de formato ANTES de tocar Storage: sólo sube lo que el
      // navegador puede reproducir (la emisión depende de eso).
      if (
        !AUDIO_EXT.includes(extLc) &&
        !file.type.startsWith("audio/") &&
        file.type !== "video/mpeg"
      ) {
        failures.push(
          `${file.name}: formato no soportado «${file.type || extLc}». ` +
            `Usa MP3, MPEG, WAV, M4A, AAC, OGG o FLAC (si es otro, conviértelo a MP3).`,
        );
        continue;
      }

      // Duración real ANTES de subir: si el navegador no puede leer el
      // archivo, no sirve para la emisión (evita huérfanos inutilizables).
      const duration = await readDuration(file);
      if (duration <= 0) {
        failures.push(
          `${file.name}: el navegador no puede reproducir este archivo ` +
            `(códec/contenedor no soportado). Conviértelo a MP3 y vuelve a subirlo.`,
        );
        continue;
      }

      const contentType =
        (!file.type || file.type === "video/mpeg") && EXT_MIME[extLc]
          ? EXT_MIME[extLc]
          : file.type || "audio/mpeg";
      const path = `${crypto.randomUUID()}.${extLc}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType, upsert: false });
      if (upErr) {
        failures.push(`${file.name}: ${upErr.message}`);
        continue;
      }

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

      const { error: insErr } = await supabase.from("tracks").insert({
        title,
        artist: artist.trim() || null,
        duration,
        file_url: pub.publicUrl,
        storage_path: path,
        type,
      });
      if (insErr) failures.push(`${file.name}: ${insErr.message}`);
    }

    setProgress(null);
    setFiles(null);
    if (inputRef.current) inputRef.current.value = "";
    if (failures.length > 0) setError(failures.join(" · "));
    await load();
  }

  async function patchTrack(id: string, patch: Partial<Track>) {
    const { error: err } = await getSupabase()
      .from("tracks")
      .update(patch)
      .eq("id", id);
    if (err) setError(err.message);
    await load();
  }

  async function removeTrack(track: Track) {
    const inUse = await getSupabase()
      .from("playlist_tracks")
      .select("id")
      .eq("track_id", track.id)
      .limit(1);
    if ((inUse.data ?? []).length > 0) {
      setError(`«${track.title}» está dentro de una playlist: quítala primero.`);
      return;
    }
    if (!window.confirm(`¿Eliminar «${track.title}» de la librería?`)) return;

    // Si era la que sonaba, detener el reproductor.
    if (current?.id === track.id) {
      audioRef.current?.pause();
      setCurrent(null);
      setPosition(0);
      setDuration(0);
    }

    if (track.storage_path) {
      await getSupabase().storage.from(BUCKET).remove([track.storage_path]);
    }
    const { error: err } = await getSupabase()
      .from("tracks")
      .delete()
      .eq("id", track.id);
    if (err) setError(err.message);
    await load();
  }

  const all = tracks ?? [];
  const counts = {
    all: all.length,
    music: all.filter((t) => t.type === "music").length,
    commercial: all.filter((t) => t.type === "commercial").length,
  };

  const visible = all.filter((t) => {
    const matchesType = filterType === "all" || t.type === filterType;
    const q = filter.trim().toLowerCase();
    const matchesQuery =
      !q ||
      t.title.toLowerCase().includes(q) ||
      (t.artist ?? "").toLowerCase().includes(q);
    return matchesType && matchesQuery;
  });

  const NAV: { key: Filter; label: string; count: number; icon: typeof Music2 }[] = [
    { key: "all", label: "Toda la biblioteca", count: counts.all, icon: ListMusic },
    { key: "music", label: "Música", count: counts.music, icon: Music2 },
    { key: "commercial", label: "Spots", count: counts.commercial, icon: Megaphone },
  ];

  const maxPosition = Math.max(duration, current?.duration ?? 0, 1);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Librería de medios</h1>
        <p className="text-sm text-slate-500">
          MP3 / WAV / MPEG alojados en el bucket <code>audio</code> de Supabase
          Storage.
        </p>
      </header>

      <ErrorNote message={error} />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Panel lateral: búsqueda e importación arriba, filtros debajo */}
        <aside>
          <Card>
            <Field label="Buscar">
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  ref={searchRef}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Título o artista…"
                  className={`${inputClass} pl-9`}
                />
              </div>
            </Field>

            <Button
              variant="primary"
              className="mt-3 flex w-full items-center justify-center gap-2"
              onClick={() => {
                setShowUpload(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              <Upload size={16} />
              Importar archivos
            </Button>

            <hr className="my-4 border-slate-200" />

            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <Library size={14} />
              Biblioteca
            </p>
            <nav className="mt-3 space-y-1">
              {NAV.map((item) => {
                const active = filterType === item.key;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => setFilterType(item.key)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                      active
                        ? "brand-gradient text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <Icon size={16} className={active ? "text-white" : "text-slate-400"} />
                    <span className="flex-1 text-left">{item.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        active ? "bg-white/25 text-white" : "bg-slate-50 text-slate-500"
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </nav>
          </Card>
        </aside>

        {/* Contenido principal */}
        <div className="space-y-4">
          {/* Barra de reproductor */}
          <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-surface p-4 shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
            <span
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${
                current
                  ? "brand-gradient text-white"
                  : "bg-slate-50 text-blue-400"
              }`}
            >
              {current ? (
                current.type === "music" ? <Music2 size={24} /> : <Megaphone size={24} />
              ) : (
                <Disc3 size={26} />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-bold text-slate-900">
                  {current
                    ? `${current.title}${current.artist ? ` — ${current.artist}` : ""}`
                    : "Reproductor de la biblioteca"}
                </p>
                <p className="shrink-0 font-mono text-xs text-slate-500">
                  {formatDuration(position)} / {current ? `-${formatDuration(Math.max(0, maxPosition - position))}` : formatDuration(0)}
                </p>
              </div>
              <input
                type="range"
                min={0}
                max={maxPosition}
                step={0.1}
                value={Math.min(position, maxPosition)}
                onChange={(e) => seek(Number(e.target.value))}
                disabled={!current}
                className="mt-2 w-full"
                aria-label="Progreso de reproducción"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => step(-1)}
                disabled={visible.length === 0}
                className="hidden rounded-lg p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 sm:block"
                aria-label="Pista anterior"
              >
                <SkipBack size={18} />
              </button>
              <button
                onClick={toggleMain}
                disabled={tracks === null || visible.length === 0}
                className="brand-gradient flex h-11 w-11 items-center justify-center rounded-full text-white shadow-lg transition hover:brightness-110 active:scale-95 disabled:opacity-50"
                aria-label={playing ? "Pausar" : "Reproducir"}
              >
                {playing ? (
                  <Pause size={20} fill="currentColor" />
                ) : (
                  <Play size={20} fill="currentColor" className="ml-0.5" />
                )}
              </button>
              <button
                onClick={() => step(1)}
                disabled={visible.length === 0}
                className="hidden rounded-lg p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-40 sm:block"
                aria-label="Pista siguiente"
              >
                <SkipForward size={18} />
              </button>

              <div className="ml-2 hidden items-center gap-2 md:flex">
                <button
                  onClick={toggleMute}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-900"
                  aria-label={muted ? "Activar sonido" : "Silenciar"}
                >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => applyVolume(Number(e.target.value))}
                  className="w-24"
                  aria-label="Volumen"
                />
              </div>
            </div>
          </section>

          {/* Formulario de subida (colapsable) */}
          {showUpload && (
            <Card
              title="Importar archivos"
              description="Puedes seleccionar varios a la vez."
              action={
                <button
                  onClick={() => setShowUpload(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-900"
                  aria-label="Cerrar"
                >
                  <X size={16} />
                </button>
              }
            >
              <form onSubmit={upload} className="grid gap-4 sm:grid-cols-4">
                <Field label="Tipo de esta tanda">
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as TrackType)}
                    className={inputClass}
                  >
                    <option value="music">Música (hilo musical)</option>
                    <option value="commercial">Spot / promoción</option>
                  </select>
                </Field>

                <Field label="Artista / nota (opcional)">
                  <Input
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder="Biblioteca interna"
                  />
                </Field>

                <Field label="Archivos">
                  <input
                    ref={inputRef}
                    type="file"
                    accept="audio/*,.mp2,.mpg,.mpeg,.mpga,.m4a,.flac,.oga,.opus,.aiff"
                    multiple
                    onChange={(e) => setFiles(e.target.files)}
                    className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-blue-100 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-blue-700`}
                  />
                </Field>

                <div className="flex items-end">
                  <Button
                    type="submit"
                    disabled={!files || files.length === 0}
                    className="w-full"
                  >
                    {progress ? "Subiendo…" : "Subir"}
                  </Button>
                </div>

                {progress && (
                  <p className="text-xs font-semibold text-blue-700 sm:col-span-4">
                    {progress}
                  </p>
                )}
              </form>
            </Card>
          )}

          {/* Lista de archivos */}
          <Card
            title={`Archivos (${visible.length})`}
            description={
              filter.trim() || filterType !== "all"
                ? "Filtro activo: usa el panel lateral para ver todo."
                : undefined
            }
          >
            {tracks === null ? (
              <Spinner />
            ) : visible.length === 0 ? (
              <EmptyState>
                {filter.trim()
                  ? "No hay archivos que coincidan con la búsqueda."
                  : "Aún no hay archivos: pulsa «Importar archivos»."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-slate-200">
                {visible.map((t) => {
                  const isCurrent = current?.id === t.id;
                  return (
                    <li key={t.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        <button
                          onClick={() => toggleTrack(t)}
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition ${
                            isCurrent
                              ? "brand-gradient text-white shadow-md"
                              : t.type === "music"
                                ? "bg-blue-50 text-blue-400 hover:text-slate-900"
                                : "bg-amber-50 text-amber-400 hover:text-slate-900"
                          }`}
                          aria-label={
                            isCurrent && playing
                              ? `Pausar ${t.title}`
                              : `Reproducir ${t.title}`
                          }
                        >
                          {isCurrent && playing ? (
                            <Pause size={17} fill="currentColor" />
                          ) : (
                            <Play size={17} fill="currentColor" className="ml-0.5" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <input
                            defaultValue={t.title}
                            onBlur={(e) =>
                              e.target.value.trim() &&
                              e.target.value !== t.title &&
                              patchTrack(t.id, { title: e.target.value.trim() })
                            }
                            className="w-full rounded-lg bg-transparent px-1 py-0.5 text-sm font-semibold text-slate-900 outline-none hover:bg-slate-50 focus:bg-slate-800"
                            aria-label="Título"
                          />
                          <input
                            defaultValue={t.artist ?? ""}
                            placeholder="Sin artista"
                            onBlur={(e) =>
                              e.target.value !== (t.artist ?? "") &&
                              patchTrack(t.id, { artist: e.target.value.trim() || null })
                            }
                            className="w-full rounded-lg bg-transparent px-1 py-0.5 text-xs text-slate-500 outline-none hover:bg-slate-50 focus:bg-slate-800"
                            aria-label="Artista"
                          />
                        </div>
                        {isCurrent && (
                          <span className="mr-1 hidden shrink-0 items-end gap-0.5 sm:flex" aria-hidden>
                            {[0, 1, 2].map((i) => (
                              <span
                                key={i}
                                className={`w-1 rounded-sm bg-blue-400 ${playing ? "animate-pulse" : "opacity-40"}`}
                                style={{ height: `${6 + i * 4}px`, animationDelay: `${i * 120}ms` }}
                              />
                            ))}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-3 pl-14 sm:pl-0">
                        <span className="font-mono text-xs text-slate-500">
                          {formatDuration(t.duration)}
                        </span>
                        <button
                          onClick={() =>
                            patchTrack(t.id, {
                              type: t.type === "music" ? "commercial" : "music",
                            })
                          }
                          title="Cambiar tipo"
                        >
                          <Badge tone={t.type === "music" ? "blue" : "amber"}>
                            {t.type === "music" ? "música" : "spot"}
                          </Badge>
                        </button>
                        <button
                          onClick={() => removeTrack(t)}
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Eliminar ${t.title}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
