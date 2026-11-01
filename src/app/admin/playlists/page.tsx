"use client";

// Gestión de playlists: crear, editar y ordenar las pistas de cada una.
// Distribución tipo YouTube en pantallas anchas: rail de playlists a la
// izquierda, cabecera + cola de reproducción al centro y catálogo
// disponible ("A continuación") a la derecha.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ListMusic,
  Megaphone,
  Music2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/schedule";
import type { Playlist, PlaylistTrack, Track } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
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
  const catalogSearchRef = useRef<HTMLInputElement>(null);

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

  const totalSeconds = (items ?? []).reduce(
    (sum, row) => sum + (row.track?.duration ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Playlists</h1>
        <p className="text-sm text-slate-500">
          El orden definido aquí es el que recorre el reproductor de cada sucursal.
        </p>
      </header>

      <ErrorNote message={error} />

      <div className="grid items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        {/* Rail izquierdo: alta + listado de playlists */}
        <div className="space-y-4 xl:sticky xl:top-20">
          <Card>
            <form onSubmit={createPlaylist} className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nueva playlist…"
                aria-label="Nombre de la playlist"
              />
              <Button
                type="submit"
                disabled={saving}
                className="flex shrink-0 items-center gap-1.5"
              >
                <Plus size={16} />
                Crear
              </Button>
            </form>
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                <ListMusic size={16} className="text-blue-400" />
                Mis playlists
              </span>
            }
          >
            {playlists === null ? (
              <Spinner />
            ) : playlists.length === 0 ? (
              <EmptyState>Crea tu primera playlist con el formulario superior.</EmptyState>
            ) : (
              <ul className="space-y-1">
                {playlists.map((p) => {
                  const active = p.id === selectedId;
                  return (
                    <li key={p.id}>
                      <div
                        className={`group flex items-center gap-3 rounded-xl p-2 transition ${
                          active ? "bg-blue-50" : "hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className={`flex h-10 w-14 shrink-0 items-center justify-center rounded-lg ${
                            active ? "brand-gradient text-white" : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          <ListMusic size={16} />
                        </span>
                        <button
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setSelectedId(p.id)}
                        >
                          <span
                            className={`block truncate text-sm font-semibold ${
                              active ? "text-blue-700" : "text-slate-900"
                            }`}
                          >
                            {p.name}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {p.description || "Sin descripción"}
                          </span>
                        </button>
                        <button
                          onClick={() => removePlaylist(p)}
                          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Eliminar ${p.name}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Centro: cabecera de la playlist + orden de reproducción */}
        <div className="min-w-0 space-y-4">
          {!selected || !selectedId ? (
            <Card>
              <EmptyState>
                Selecciona una playlist del panel izquierdo (o crea una nueva) para
                editar su orden de reproducción.
              </EmptyState>
            </Card>
          ) : (
            <>
              {/* Cabecera estilo "playlist" */}
              <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 bg-surface p-5 shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
                <span className="brand-gradient flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg">
                  <ListMusic size={34} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                    Playlist
                  </p>
                  <input
                    key={`name-${selected.id}`}
                    defaultValue={selected.name}
                    onBlur={(e) =>
                      e.target.value.trim() !== selected.name &&
                      patchPlaylist(selected.id, { name: e.target.value.trim() })
                    }
                    className="w-full rounded-lg bg-transparent px-1 text-2xl font-black text-slate-900 outline-none hover:bg-slate-50 focus:bg-slate-800"
                    aria-label="Nombre de la playlist"
                  />
                  <input
                    key={`desc-${selected.id}`}
                    defaultValue={selected.description ?? ""}
                    placeholder="Añade una descripción…"
                    onBlur={(e) =>
                      e.target.value !== (selected.description ?? "") &&
                      patchPlaylist(selected.id, {
                        description: e.target.value.trim() || null,
                      })
                    }
                    className="mt-0.5 w-full rounded-lg bg-transparent px-1 text-sm text-slate-500 outline-none hover:bg-slate-50 focus:bg-slate-800"
                    aria-label="Descripción"
                  />
                  <p className="mt-1 px-1 text-xs text-slate-500">
                    {items?.length ?? 0} pista{(items?.length ?? 0) === 1 ? "" : "s"} ·{" "}
                    {formatDuration(totalSeconds)} en total
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="flex items-center gap-2"
                  onClick={() => catalogSearchRef.current?.focus()}
                >
                  <Plus size={16} />
                  Añadir pistas
                </Button>
              </section>

              {/* Cola de reproducción */}
              <Card
                title="Orden de reproducción"
                description="Las pistas se reproducen de arriba hacia abajo en bucle."
              >
                {items === null ? (
                  <Spinner />
                ) : items.length === 0 ? (
                  <EmptyState>
                    Playlist vacía: añade pistas desde el catálogo de la derecha.
                  </EmptyState>
                ) : (
                  <ul className="space-y-1">
                    {items.map((row, index) => {
                      const isCommercial = row.track?.type === "commercial";
                      return (
                        <li
                          key={row.id}
                          className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-50"
                        >
                          <span className="w-6 shrink-0 text-center font-mono text-xs text-slate-500">
                            {index + 1}
                          </span>
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                              isCommercial
                                ? "bg-amber-50 text-amber-400"
                                : "bg-blue-50 text-blue-400"
                            }`}
                          >
                            {isCommercial ? (
                              <Megaphone size={16} />
                            ) : (
                              <Music2 size={16} />
                            )}
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
                          <Badge tone={isCommercial ? "amber" : "blue"}>
                            {isCommercial ? "spot" : "música"}
                          </Badge>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              onClick={() => moveItem(index, -1)}
                              disabled={index === 0}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
                              aria-label="Subir"
                            >
                              <ChevronUp size={16} />
                            </button>
                            <button
                              onClick={() => moveItem(index, 1)}
                              disabled={index === items.length - 1}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
                              aria-label="Bajar"
                            >
                              <ChevronDown size={16} />
                            </button>
                            <button
                              onClick={() => removeItem(row)}
                              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Quitar de la playlist"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </>
          )}
        </div>

        {/* Rail derecho: catálogo disponible (estilo "A continuación") */}
        <Card
          title="Catálogo disponible"
          description="Pulsa una pista para añadirla a la playlist."
          className="xl:sticky xl:top-20"
        >
          <div className="space-y-3">
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                ref={catalogSearchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por título o artista…"
                className={`${inputClass} pl-9`}
              />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              className={inputClass}
            >
              <option value="music">Música</option>
              <option value="commercial">Spots</option>
              <option value="all">Todo</option>
            </select>

            {library.length === 0 ? (
              <EmptyState>
                La librería está vacía: sube archivos en «Medios».
              </EmptyState>
            ) : candidates.length === 0 ? (
              <EmptyState>Sin resultados (o ya están todos en la playlist).</EmptyState>
            ) : (
              <ul className="max-h-[min(60vh,560px)] space-y-1 overflow-y-auto pr-1">
                {candidates.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => addTrack(t)}
                      disabled={!selectedId}
                      className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          t.type === "commercial"
                            ? "bg-amber-50 text-amber-400"
                            : "bg-blue-50 text-blue-400"
                        }`}
                      >
                        {t.type === "commercial" ? (
                          <Megaphone size={15} />
                        ) : (
                          <Music2 size={15} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {t.title}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {t.artist ?? "—"} · {formatDuration(t.duration)}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-lg p-1.5 text-blue-700">
                        <Plus size={16} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {!selectedId && library.length > 0 && (
              <p className="text-xs text-slate-500">
                Selecciona una playlist para poder añadir pistas.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
