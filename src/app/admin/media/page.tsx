"use client";

// Librería de medios: subida a Supabase Storage y gestión de metadatos.

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [filterType, setFilterType] = useState<"all" | TrackType>("all");
  const inputRef = useRef<HTMLInputElement>(null);

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

  const visible = (tracks ?? []).filter((t) => {
    const matchesType = filterType === "all" || t.type === filterType;
    const q = filter.trim().toLowerCase();
    const matchesQuery =
      !q ||
      t.title.toLowerCase().includes(q) ||
      (t.artist ?? "").toLowerCase().includes(q);
    return matchesType && matchesQuery;
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Librería de medios</h1>
        <p className="text-sm text-slate-500">
          MP3 / WAV alojados en el bucket <code>audio</code> de Supabase Storage.
        </p>
      </header>

      <ErrorNote message={error} />

      <Card title="Subir archivos" description="Puedes seleccionar varios a la vez.">
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
              className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-blue-400`}
            />
          </Field>

          <div className="flex items-end">
            <Button type="submit" disabled={!files || files.length === 0} className="w-full">
              {progress ? "Subiendo…" : "Subir"}
            </Button>
          </div>

          {progress && (
            <p className="text-xs font-semibold text-blue-600 sm:col-span-4">{progress}</p>
          )}
        </form>
      </Card>

      <Card
        title={`Archivos (${visible.length})`}
        action={
          <div className="flex gap-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar…"
              className="!w-40"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as "all" | TrackType)}
              className={`${inputClass} !w-32`}
            >
              <option value="all">Todo</option>
              <option value="music">Música</option>
              <option value="commercial">Spots</option>
            </select>
          </div>
        }
      >
        {tracks === null ? (
          <Spinner />
        ) : visible.length === 0 ? (
          <EmptyState>No hay archivos que coincidan.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((t) => (
              <li key={t.id} className="grid gap-2 py-3 sm:grid-cols-[1.6fr_1fr_auto] sm:items-center">
                <div className="min-w-0">
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

                <div className="flex items-center gap-2 text-xs text-slate-500">
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
                  <span className="font-mono">{formatDuration(t.duration)}</span>
                </div>

                <div className="flex justify-end">
                  <Button variant="danger" onClick={() => removeTrack(t)}>
                    Eliminar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
