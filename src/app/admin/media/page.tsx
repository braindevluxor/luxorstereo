"use client";

// Librería de medios: subida a Supabase Storage y gestión de metadatos.
// Vista con panel lateral de filtros (tipo de archivo + búsqueda) y lista
// principal con cabecera tipo "biblioteca de música", inspirada en el panel
// de referencia pero con la paleta clara del proyecto (slate / blue / navy).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Disc3,
  Library,
  ListMusic,
  Megaphone,
  Music2,
  Search,
  Trash2,
  Upload,
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
      const path = `${crypto.randomUUID()}.${ext.toLowerCase()}`;
      const title = file.name.replace(/\.[^.]+$/, "").replaceAll("_", " ");

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
      if (upErr) {
        failures.push(`${file.name}: ${upErr.message}`);
        continue;
      }

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const duration = await readDuration(file);

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
  const totalSeconds = all.reduce((sum, t) => sum + (t.duration ?? 0), 0);

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

  const sectionLabel =
    filterType === "music" ? "Música" : filterType === "commercial" ? "Spots" : "Biblioteca";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Librería de medios</h1>
        <p className="text-sm text-slate-500">
          MP3 / WAV alojados en el bucket <code>audio</code> de Supabase Storage.
        </p>
      </header>

      <ErrorNote message={error} />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Panel lateral: filtros y búsqueda */}
        <aside className="space-y-4">
          <Card>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
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
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <Icon size={16} className={active ? "text-white" : "text-slate-400"} />
                    <span className="flex-1 text-left">{item.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-4">
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
            </div>

            <Button
              variant="primary"
              className="mt-4 flex w-full items-center justify-center gap-2"
              onClick={() => {
                setShowUpload(true);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              <Upload size={16} />
              Subir archivos
            </Button>
          </Card>
        </aside>

        {/* Contenido principal */}
        <div className="space-y-4">
          {/* Cabecera tipo biblioteca */}
          <section className="flex flex-wrap items-center gap-5 rounded-2xl border border-slate-200 bg-gradient-to-r from-blue-50 via-white to-white p-5 shadow-sm sm:p-6">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
              <Disc3 size={36} className="text-blue-400" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-black text-slate-900 sm:text-3xl">
                {sectionLabel}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {tracks === null
                  ? "Cargando…"
                  : `${counts.all} archivo${counts.all === 1 ? "" : "s"} · ${
                      counts.music
                    } de música · ${counts.commercial} spots · ${formatDuration(
                      totalSeconds,
                    )} en total`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                className="flex items-center gap-2"
                onClick={() => searchRef.current?.focus()}
              >
                <Search size={16} />
                Buscar
              </Button>
              <Button
                className="flex items-center gap-2"
                onClick={() => setShowUpload((v) => !v)}
              >
                <Upload size={16} />
                Subir
              </Button>
            </div>
          </section>

          {/* Formulario de subida (colapsable) */}
          {showUpload && (
            <Card
              title="Subir archivos"
              description="Puedes seleccionar varios a la vez."
              action={
                <button
                  onClick={() => setShowUpload(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
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
                    accept="audio/*"
                    multiple
                    onChange={(e) => setFiles(e.target.files)}
                    className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-blue-700`}
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
                  <p className="text-xs font-semibold text-blue-600 sm:col-span-4">
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
                  : "Aún no hay archivos: pulsa «Subir archivos»."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visible.map((t, index) => (
                  <li
                    key={t.id}
                    className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="hidden w-6 shrink-0 text-right font-mono text-xs text-slate-400 sm:block">
                        {index + 1}
                      </span>
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                          t.type === "music"
                            ? "bg-blue-50 text-blue-600"
                            : "bg-amber-50 text-amber-600"
                        }`}
                      >
                        {t.type === "music" ? (
                          <Music2 size={18} />
                        ) : (
                          <Megaphone size={18} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <input
                          defaultValue={t.title}
                          onBlur={(e) =>
                            e.target.value.trim() &&
                            e.target.value !== t.title &&
                            patchTrack(t.id, { title: e.target.value.trim() })
                          }
                          className="w-full rounded-lg bg-transparent px-1 py-0.5 text-sm font-semibold text-slate-900 outline-none hover:bg-slate-100 focus:bg-white"
                          aria-label="Título"
                        />
                        <input
                          defaultValue={t.artist ?? ""}
                          placeholder="Sin artista"
                          onBlur={(e) =>
                            e.target.value !== (t.artist ?? "") &&
                            patchTrack(t.id, { artist: e.target.value.trim() || null })
                          }
                          className="w-full rounded-lg bg-transparent px-1 py-0.5 text-xs text-slate-500 outline-none hover:bg-slate-100 focus:bg-white"
                          aria-label="Artista"
                        />
                      </div>
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
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
