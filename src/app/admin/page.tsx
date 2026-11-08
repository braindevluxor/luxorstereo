"use client";

// Dashboard central: creación de sucursales, estado en vivo (disco de
// vinilo), acceso al enlace del reproductor y control de alertas.
// Diseñado para caber en pantalla sin scroll: altura de viewport con
// desplazamiento interno sólo en la lista de sucursales.

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Mic, Music2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import type { Branch, TrackType } from "@/lib/types";
import AlertPanel from "@/components/admin/AlertPanel";
import { Button, Card, EmptyState, ErrorNote, Spinner, inputClass } from "@/components/ui";

interface LogRow {
  id: string;
  branch_id: string;
  played_at: string;
  track: { title: string; artist: string | null; type: TrackType; duration: number } | null;
  branch: { name: string } | null;
}

// Se considera en línea con un latido de hasta 2 minutos (los temporizadores
// en segundo plano del navegador de la sucursal se ralentizan y no deben
// marcar falso offline).
const ONLINE_WINDOW_MS = 120_000;

// Zona horaria fija para todas las sucursales.
const DEFAULT_TIMEZONE = "America/Caracas";

// Disco de vinilo (GIF animado de public/). Gira sólo mientras la sucursal
// está reproduciendo (según el registro de reproducciones); el centro del
// disco es verde si el link está en línea (latido reciente) y rojo si no.
function VinylDisc({
  online,
  playing,
  size = 36,
}: {
  online: boolean;
  playing?: boolean;
  size?: number;
}) {
  const hole = Math.max(2, Math.round(size * 0.05)); // eje central
  const labelActive = Math.max(6, Math.round(size * 0.42));
  const labelIdle = Math.max(6, Math.round(size * 0.36));
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full ${
        online
          ? // En línea: aro neón verde que parpadea lentamente.
            "neon-disc shadow-[0_0_6px_2px_rgba(52,211,153,0.75),0_0_18px_6px_rgba(16,185,129,0.4)]"
          : ""
      }`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Disco fijo siempre debajo: respalda al GIF si éste no carga */}
      <span className="absolute inset-0 rounded-full bg-slate-800 ring-1 ring-inset ring-slate-600/60" />
      {playing && (
        // Reproduciendo: GIF animado (gira) encima del disco fijo.
        <img
          src="/disco-rojo.gif"
          alt=""
          className="absolute left-1/2 top-1/2 h-[150%] w-[150%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain motion-reduce:hidden"
          draggable={false}
          onError={(e) => {
            // Sin GIF: queda el disco fijo (nunca un hueco ni icono roto).
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      {/* Centro: verde = en línea, rojo = desconectada */}
      <span
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
          online ? "bg-emerald-500" : "bg-rose-500"
        }`}
        style={{
          width: online ? labelActive : labelIdle,
          height: online ? labelActive : labelIdle,
        }}
      />
      {/* Eje central (común a todos los estados) */}
      <span
        className="absolute rounded-full bg-slate-900"
        style={{ width: hole, height: hole }}
      />
    </span>
  );
}

function relativeTime(iso: string | null, now: number): string {
  if (!iso) return "nunca";
  const diff = now - Date.parse(iso);
  if (Number.isNaN(diff)) return "—";
  if (diff < 5_000) return "ahora mismo";
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
}

function playerUrl(branchKey: string, origin: string) {
  return `${origin}/branch?key=${branchKey}`;
}

export default function DashboardPage() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [tracksCount, setTracksCount] = useState(0);
  const [playlistsCount, setPlaylistsCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [alertTarget, setAlertTarget] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Alta de sucursales desde el panel
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCity, setNewCity] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [branchRes, logRes, trackRes, playlistRes] = await Promise.all([
      supabase.from("branches").select("*").order("name"),
      supabase
        .from("station_logs")
        .select(
          "id, branch_id, played_at, track:tracks(title,artist,type,duration), branch:branches(name)",
        )
        .order("played_at", { ascending: false })
        .limit(25),
      supabase.from("tracks").select("id", { count: "exact", head: true }),
      supabase.from("playlists").select("id", { count: "exact", head: true }),
    ]);

    if (branchRes.error) {
      setError(branchRes.error.message);
      return;
    }
    setBranches((branchRes.data as Branch[]) ?? []);
    setLogs((logRes.data as unknown as LogRow[]) ?? []);
    setTracksCount(trackRes.count ?? 0);
    setPlaylistsCount(playlistRes.count ?? 0);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Reloj para recalcular en línea/offline y "hace X".
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Refresco periódico: latidos, reproducciones y cambios de sucursal
  // (sin Realtime: todo llega por REST cada 15 s).
  useEffect(() => {
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const isOnline = (b: Branch) =>
    b.active &&
    !!b.last_ping &&
    now - Date.parse(b.last_ping) < ONLINE_WINDOW_MS;

  const nowPlaying = new Map<string, LogRow>();
  for (const log of logs) {
    if (!nowPlaying.has(log.branch_id)) nowPlaying.set(log.branch_id, log);
  }

  const onlineCount = branches?.filter(isOnline).length ?? 0;

  async function createBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    const { error: err } = await getSupabase()
      .from("branches")
      .insert({
        name: newName.trim(),
        city: newCity.trim() || null,
        timezone: DEFAULT_TIMEZONE,
      });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setNewName("");
    setNewCity("");
    await load();
  }

  async function removeBranch(branch: Branch) {
    const ok = window.confirm(
      `¿Eliminar "${branch.name}"? Se borrará su historial de reproducciones.`,
    );
    if (!ok) return;
    setError(null);
    const { error: err } = await getSupabase()
      .from("branches")
      .delete()
      .eq("id", branch.id);
    if (err) setError(err.message);
    await load();
  }

  async function renameBranch(branch: Branch) {
    const name = window.prompt("Nuevo nombre de la sucursal:", branch.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === branch.name) return;
    setError(null);
    const { error: err } = await getSupabase()
      .from("branches")
      .update({ name: trimmed })
      .eq("id", branch.id);
    if (err) setError(err.message);
    await load();
  }

  async function toggleBranch(branch: Branch) {
    setError(null);
    const { error: err } = await getSupabase()
      .from("branches")
      .update({ active: !branch.active })
      .eq("id", branch.id);
    if (err) setError(err.message);
    await load();
  }

  async function copyLink(branch: Branch) {
    const url = playerUrl(branch.branch_key, window.location.origin);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(branch.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt("URL del reproductor:", url);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[460px] flex-col gap-4">
      <ErrorNote message={error} />

      {/* Banda de indicadores */}
      <div className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-2xl bg-slate-200 sm:grid-cols-4">
        {[
          { label: "Sucursales", value: branches?.length ?? "…" },
          { label: "En línea", value: onlineCount, accent: true },
          { label: "Archivos", value: tracksCount },
          { label: "Playlists", value: playlistsCount },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-slate-800 px-5 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {kpi.label}
            </p>
            <p
              className={`mt-0.5 text-2xl font-black ${
                kpi.accent ? "text-emerald-400" : "text-slate-900"
              }`}
            >
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Sucursales: disco de vinilo + acciones */}
      <Card
        title="Sucursales"
        description="En línea = latido reciente del reproductor (ventana de 2 minutos)."
        className="flex min-h-0 flex-1 flex-col"
        action={
          <Button
            variant="ghost"
            className="flex items-center gap-1.5"
            onClick={() => setShowCreate((v) => !v)}
          >
            <Plus size={16} />
            Nueva sucursal
          </Button>
        }
      >
        {showCreate && (
          <form
            onSubmit={createBranch}
            className="mb-4 grid shrink-0 gap-3 sm:grid-cols-[1.2fr_1fr_auto]"
          >
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre (Luxor Centro)"
              className={inputClass}
              aria-label="Nombre de la sucursal"
            />
            <input
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              placeholder="Ciudad (opcional)"
              className={inputClass}
              aria-label="Ciudad"
            />
            <Button type="submit" disabled={saving}>
              {saving ? "Creando…" : "Crear"}
            </Button>
          </form>
        )}

        {branches === null ? (
          <Spinner />
        ) : branches.length === 0 ? (
          <EmptyState>
            Aún no hay sucursales: pulsa «Nueva sucursal» para crear la primera.
          </EmptyState>
        ) : (
          <ul className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
            {branches.map((b) => {
              const online = isOnline(b);
              const playing = nowPlaying.get(b.id);
              // El registro anota el inicio de cada pista/spot: mientras no
              // haya pasado su duración, la sucursal sigue sonando (así se
              // sustituye la presencia de Realtime). Duración desconocida →
              // ventana de 5 minutos.
              const dur = playing?.track?.duration ?? 0;
              const livePlaying =
                !!playing &&
                now - Date.parse(playing.played_at) < (dur > 0 ? dur : 300) * 1000;
              const statusLabel = !b.active
                ? "Inactiva"
                : online
                  ? livePlaying
                    ? "Reproduciendo"
                    : "En línea"
                  : "Desconectada";
              const nowTitle = playing?.track
                ? `${playing.track.title}${playing.track.artist ? ` — ${playing.track.artist}` : ""}`
                : null;
              const tooltip = [
                `${b.name} — ${statusLabel}`,
                `${b.city ?? "Sin ciudad"} · ${b.timezone}`,
                `Latido: ${relativeTime(b.last_ping, now)}`,
                nowTitle ? `Suena: ${nowTitle}` : "Sin reproducciones registradas",
                `Reproductor: ${playerUrl(b.branch_key, typeof window !== "undefined" ? window.location.origin : "")}`,
              ]
                .filter(Boolean)
                .join("\n");

              return (
                <li key={b.id}>
                  <div
                    title={tooltip}
                    className="flex h-full flex-col rounded-2xl border border-slate-200 bg-slate-50 p-3.5 transition hover:border-blue-500/60"
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {b.name}
                      </p>
                      <button
                        onClick={() => renameBranch(b)}
                        title="Renombrar sucursal"
                        aria-label={`Renombrar ${b.name}`}
                        className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center justify-center gap-2">
                      <VinylDisc online={online} playing={livePlaying} size={96} />

                      {/* Acciones de la sucursal (columna lateral) */}
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => toggleBranch(b)}
                          title={
                            b.active ? "Desactivar sucursal" : "Activar sucursal"
                          }
                          aria-label={`${b.active ? "Desactivar" : "Activar"} ${b.name}`}
                          className={`rounded-lg p-1.5 transition ${
                            b.active
                              ? "text-slate-500 hover:bg-amber-50 hover:text-amber-600"
                              : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                          }`}
                        >
                          <Power size={18} />
                        </button>
                        <button
                          onClick={() => removeBranch(b)}
                          title="Eliminar sucursal"
                          aria-label={`Eliminar ${b.name}`}
                          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 size={18} />
                        </button>
                        <button
                          onClick={() => setAlertTarget(b.id)}
                          disabled={!b.active}
                          title={
                            b.active
                              ? "Lanzar mensaje a esta sucursal"
                              : "Sucursal inactiva"
                          }
                          aria-label={`Lanzar mensaje a ${b.name}`}
                          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <Mic size={18} />
                        </button>
                        <button
                          onClick={() => copyLink(b)}
                          title={
                            copiedId === b.id
                              ? "¡Enlace copiado!"
                              : "Copiar enlace del reproductor"
                          }
                          aria-label={`Copiar enlace de ${b.name}`}
                          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-blue-50 hover:text-blue-400"
                        >
                          {copiedId === b.id ? (
                            <Check size={18} className="text-emerald-400" />
                          ) : (
                            <Copy size={18} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Pie: pista actual (registro de reproducciones) */}
                    <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-slate-500">
                      {nowTitle ? (
                        <>
                          <Music2 size={13} className="shrink-0 text-blue-400" />
                          <span className="truncate">{nowTitle}</span>
                        </>
                      ) : (
                        <>
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              !b.active
                                ? "bg-slate-400"
                                : online
                                  ? "bg-emerald-500"
                                  : "bg-rose-500"
                            }`}
                          />
                          <span className="truncate">
                            {statusLabel} · latido {relativeTime(b.last_ping, now)}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Botón flotante (todas) + modal de control en vivo */}
      {branches && branches.length > 0 && (
        <>
          <button
            onClick={() => setAlertTarget("all")}
            className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg shadow-rose-600/30 transition hover:bg-rose-500 active:scale-95"
            aria-label="Abrir control en vivo"
            title="Control en vivo (todas las sucursales)"
          >
            <Mic size={24} />
          </button>
          {alertTarget !== null && (
            <AlertPanel
              branches={branches}
              initialTarget={alertTarget}
              onClose={() => setAlertTarget(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
