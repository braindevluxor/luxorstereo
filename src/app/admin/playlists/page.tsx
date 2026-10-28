"use client";

// Gestión de playlists: crear, editar y ordenar las pistas de cada una.

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/schedule";
import type { Playlist, PlaylistTrack, Track, TrackType } from "@/lib/types";
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

interface PlaylistTrackRow extends PlaylistTrack {
  track: Track | null;
}

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [library, setLibrary] = useState<Track[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<PlaylistTrackRow[] | null>(null);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"music" | "commercial" | "all">("music");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPlaylists = useCallback(async () => {
    const { data, error: err } = await getSupabase()
      .from("playlists")
      .select("*")
      .order("name");
    if (err) setError(err.message);
    setPlaylists((data as Playlist[]) ?? []);
  }, []);

  const loadLibrary = useCallback(async () => {
    const { data } = await getSupabase()
      .from("tracks")
      .select("*")
      .order("title");
    setLibrary((data as Track[]) ?? []);
  }, []);

  const loadItems = useCallback(async (playlistId: string | null) => {
    setItems(null);
    if (!playlistId) return;
    const { data, error: err } = await getSupabase()
      .from("playlist_tracks")
      .select("*, track:tracks(*)")
      .eq("playlist_id", playlistId)
      .order("position");
    if (err) setError(err.message);
    setItems((data as unknown as PlaylistTrackRow[]) ?? []);
  }, []);

  useEffect(() => {
    void loadPlaylists();
    void loadLibrary();
  }, [loadPlaylists, loadLibrary]);

  useEffect(() => {
    void loadItems(selectedId);
  }, [selectedId, loadItems]);

  const selected = playlists?.find((p) => p.id === selectedId) ?? null;

  async function createPlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    const { data, error: err } = await getSupabase()
      .from("playlists")
      .insert({ name: newName.trim() })
      .select()
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNewName("");
    await loadPlaylists();
    setSelectedId((data as Playlist).id);
  }

  async function removePlaylist(playlist: Playlist) {
    if (!window.confirm(`¿Eliminar la playlist «${playlist.name}»?`)) return;
    const { error: err } = await getSupabase()
      .from("playlists")
      .delete()
      .eq("id", playlist.id);
    if (err) setError(err.message);
    if (selectedId === playlist.id) setSelectedId(null);
    await loadPlaylists();
  }

  async function patchPlaylist(id: string, patch: Partial<Playlist>) {
    const { error: err } = await getSupabase()
      .from("playlists")
      .update(patch)
      .eq("id", id);
    if (err) setError(err.message);
    await loadPlaylists();
  }

  async function addTrack(track: Track) {
    if (!selectedId) return;
    const position =
      (items ?? []).reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const { error: err } = await getSupabase().from("playlist_tracks").insert({
      playlist_id: selectedId,
      track_id: track.id,
      position,
    });
    if (err) {
      setError(err.message);
      return;
    }
    await loadItems(selectedId);
  }

  async function removeItem(row: PlaylistTrackRow) {
    if (!selectedId) return;
    const { error: err } = await getSupabase()
      .from("playlist_tracks")
      .delete()
      .eq("id", row.id);
    if (err) setError(err.message);
    await loadItems(selectedId);
  }

  async function moveItem(index: number, direction: -1 | 1) {
    if (!selectedId || !items) return;
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const a = items[index];
    const b = items[target];
    setError(null);
    const supabase = getSupabase();
    const [resA, resB] = await Promise.all([
      supabase.from("playlist_tracks").update({ position: b.position }).eq("id", a.id),
      supabase.from("playlist_tracks").update({ position: a.position }).eq("id", b.id),
    ]);
    if (resA.error || resB.error) {
      setError(resA.error?.message ?? resB.error?.message ?? "Error al reordenar");
    }
    await loadItems(selectedId);
  }

  const usedTrackIds = new Set((items ?? []).map((row) => row.track_id));
  const candidates = library.filter((t) => {
    if (usedTrackIds.has(t.id)) return false;
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    const q = search.trim().toLowerCase();
    return (
      !q || t.title.toLowerCase().includes(q) || (t.artist ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Playlists</h1>
        <p className="text-sm text-slate-500">
          El orden definido aquí es el que recorre el reproductor de cada sucursal.
        </p>
      </header>

      <ErrorNote message={error} />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Listado + alta */}
        <div className="space-y-4">
          <Card title="Nueva playlist">
            <form onSubmit={createPlaylist} className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Matutina suave"
                aria-label="Nombre de la playlist"
              />
              <Button type="submit" disabled={saving}>
                Crear
              </Button>
            </form>
          </Card>

          <Card title={`Listado (${playlists?.length ?? 0})`}>
            {playlists === null ? (
              <Spinner />
            ) : playlists.length === 0 ? (
              <EmptyState>Crea tu primera playlist.</EmptyState>
            ) : (
              <ul className="space-y-1.5">
                {playlists.map((p) => (
                  <li key={p.id}>
                    <div
                      className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition ${
                        p.id === selectedId
                          ? "bg-blue-50 text-blue-400"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setSelectedId(p.id)}
                      >
                        <span className="block truncate text-sm font-semibold">
                          {p.name}
                        </span>
                        {p.description && (
                          <span className="block truncate text-xs text-slate-500">
                            {p.description}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => removePlaylist(p)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label={`Eliminar ${p.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Editor */}
        {!selected ? (
          <Card>
            <EmptyState>Selecciona una playlist para editarla.</EmptyState>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card title={`Editar: ${selected.name}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre">
                  <Input
                    defaultValue={selected.name}
                    onBlur={(e) =>
                      e.target.value.trim() !== selected.name &&
                      patchPlaylist(selected.id, { name: e.target.value.trim() })
                    }
                  />
                </Field>
                <Field label="Descripción">
                  <Input
                    defaultValue={selected.description ?? ""}
                    placeholder="Ambiente para horario matutino"
                    onBlur={(e) =>
                      e.target.value !== (selected.description ?? "") &&
                      patchPlaylist(selected.id, {
                        description: e.target.value.trim() || null,
                      })
                    }
                  />
                </Field>
              </div>
            </Card>

            <Card title={`Orden de reproducción (${items?.length ?? 0})`}>
              {items === null ? (
                <Spinner />
              ) : items.length === 0 ? (
                <EmptyState>
                  Playlist vacía: añade pistas desde el catálogo de la derecha/abajo.
                </EmptyState>
              ) : (
                <ol className="divide-y divide-slate-100">
                  {items.map((row, index) => (
                    <li key={row.id} className="flex items-center gap-3 py-2.5">
                      <span className="w-6 shrink-0 text-center font-mono text-xs text-slate-400">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {row.track?.title ?? "Pista eliminada"}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {row.track?.artist ?? "—"} ·{" "}
                          {formatDuration(row.track?.duration ?? 0)}
                        </p>
                      </div>
                      <Badge tone={row.track?.type === "commercial" ? "amber" : "blue"}>
                        {row.track?.type === "commercial" ? "spot" : "música"}
                      </Badge>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveItem(index, -1)}
                          disabled={index === 0}
                          className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                          aria-label="Subir"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          onClick={() => moveItem(index, 1)}
                          disabled={index === items.length - 1}
                          className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                          aria-label="Bajar"
                        >
                          <ChevronDown size={16} />
                        </button>
                        <button
                          onClick={() => removeItem(row)}
                          className="rounded-lg px-2 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label="Quitar de la playlist"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title="Catálogo disponible" description="Pulsa una pista para añadirla.">
              <div className="mb-3 flex flex-wrap gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por título o artista…"
                  className="!w-64"
                />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
                  className={`${inputClass} !w-40`}
                >
                  <option value="music">Música</option>
                  <option value="commercial">Spots</option>
                  <option value="all">Todo</option>
                </select>
              </div>

              {candidates.length === 0 ? (
                <EmptyState>Sin resultados (o ya están todos en la playlist).</EmptyState>
              ) : (
                <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                  {candidates.map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() => addTrack(t)}
                        className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left hover:bg-slate-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-slate-900">
                            {t.title}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {t.artist ?? "—"}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Badge tone={t.type === "commercial" ? "amber" : "blue"}>
                            {t.type === "commercial" ? "spot" : "música"}
                          </Badge>
                          <span className="font-mono text-xs text-slate-500">
                            {formatDuration(t.duration)}
                          </span>
                          <Plus size={16} className="text-blue-600" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
