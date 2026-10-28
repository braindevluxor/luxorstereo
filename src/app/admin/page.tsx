"use client";

// Dashboard central: estado de sucursales, "ahora suena", historial en vivo
// y control de alertas.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase/client";
import type { Branch, TrackType } from "@/lib/types";
import AlertPanel from "@/components/admin/AlertPanel";
import { Mic } from "lucide-react";
import { Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";

interface LogRow {
  id: string;
  branch_id: string;
  played_at: string;
  track: { title: string; artist: string | null; type: TrackType } | null;
  branch: { name: string } | null;
}

const ONLINE_WINDOW_MS = 60_000;

// Disco de vinilo con el centro (etiqueta) en verde si la sucursal está en
// Disco de vinilo (GIF animado de public/). El centro del GIF es rojo; cuando
// la sucursal está activa/en línea se superpone un centro verde encima.
// `size` controla el diámetro en píxeles.
function VinylDisc({ online, size = 36 }: { online: boolean; size?: number }) {
  const hole = Math.max(2, Math.round(size * 0.05)); // eje central
  // El centro del GIF luce más grande que el disco CSS llena todo, así que cada
  // estado dimensiona su propio centro para que visualmente coincidan.
  const labelActive = Math.max(6, Math.round(size * 0.42));
  const labelIdle = Math.max(6, Math.round(size * 0.36));
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {online ? (
        // Activa: GIF animado (gira) con centro verde encima.
        <>
          <img
            src="/disco rojo.gif"
            alt=""
            className="absolute left-1/2 top-1/2 h-[150%] w-[150%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain motion-reduce:hidden"
            draggable={false}
          />
          <span
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500"
            style={{ width: labelActive, height: labelActive }}
          />
        </>
      ) : (
        // Inactiva / desconectada: disco fijo (no gira), centro rojo.
        <>
          <span className="absolute inset-0 rounded-full bg-slate-800 ring-1 ring-inset ring-slate-600/60" />
          <span
            className="absolute rounded-full bg-rose-500"
            style={{ width: labelIdle, height: labelIdle }}
          />
        </>
      )}
      {/* Eje central (común a ambos estados) */}
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

export default function DashboardPage() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [tracksCount, setTracksCount] = useState(0);
  const [playlistsCount, setPlaylistsCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [branchRes, logRes, trackRes, playlistRes] = await Promise.all([
      supabase.from("branches").select("*").order("name"),
      supabase
        .from("station_logs")
        .select(
          "id, branch_id, played_at, track:tracks(title,artist,type), branch:branches(name)",
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

  // Realtime: inserciones de reproducciones y cambios de latido.
  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel("admin-dashboard")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "station_logs" },
        () => {
          void load();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "branches" },
        () => {
          void load();
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const nowPlaying = new Map<string, LogRow>();
  for (const log of logs) {
    if (!nowPlaying.has(log.branch_id)) nowPlaying.set(log.branch_id, log);
  }

  const onlineCount =
    branches?.filter(
      (b) =>
        b.active &&
        b.last_ping &&
        now - Date.parse(b.last_ping) < ONLINE_WINDOW_MS,
    ).length ?? 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Panel central</h1>
          <p className="text-sm text-slate-500">
            Estado de la red de sucursales y actividad de la radio corporativa.
          </p>
        </div>
        <span
          className={`flex items-center gap-1.5 text-xs font-bold ${
            live ? "text-emerald-600" : "text-amber-600"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              live ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
          {live ? "Actualizaciones en vivo" : "Conectando…"}
        </span>
      </header>

      <ErrorNote message={error} />

      {/* Banda de indicadores (estilo panel de gestión) */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-slate-200 sm:grid-cols-4">
        {[
          { label: "Sucursales", value: branches?.length ?? "…" },
          { label: "En línea", value: onlineCount, accent: true },
          { label: "Archivos", value: tracksCount },
          { label: "Playlists", value: playlistsCount },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-slate-800 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {kpi.label}
            </p>
            <p
              className={`mt-1 text-3xl font-black ${
                kpi.accent ? "text-emerald-400" : "text-slate-900"
              }`}
            >
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Estado por sucursal */}
      <Card
        title="Sucursales"
        description="En línea = latido recibido en los últimos 60 segundos."
        action={
          <Link
            href="/admin/branches"
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            Gestionar →
          </Link>
        }
      >
        {branches === null ? (
          <Spinner />
        ) : branches.length === 0 ? (
          <EmptyState>
            Aún no hay sucursales.{" "}
            <Link href="/admin/branches" className="font-semibold text-blue-600">
              Crear la primera
            </Link>
          </EmptyState>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {branches.map((b) => {
              const online =
                b.active &&
                !!b.last_ping &&
                now - Date.parse(b.last_ping) < ONLINE_WINDOW_MS;
              const playing = nowPlaying.get(b.id);
              const statusLabel = !b.active
                ? "Inactiva"
                : online
                  ? "En línea"
                  : "Desconectada";
              // Texto del tooltip al pasar el mouse sobre la tarjeta.
              const tooltip = [
                `${b.name} — ${statusLabel}`,
                `${b.city ?? "Sin ciudad"} · ${b.timezone}`,
                `Latido: ${relativeTime(b.last_ping, now)}`,
                playing?.track
                  ? `Suena: ${playing.track.title}${playing.track.artist ? ` — ${playing.track.artist}` : ""}`
                  : "Sin reproducciones registradas",
              ].join("\n");

              return (
                <li key={b.id}>
                  <div
                    title={tooltip}
                    className="flex aspect-square w-full cursor-default flex-col items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-2.5 transition hover:border-blue-500/60 hover:bg-slate-100"
                  >
                    <div className="flex flex-1 items-center justify-center">
                      <VinylDisc online={online} size={96} />
                    </div>
                    <p
                      className="w-full truncate text-center text-xs font-semibold text-slate-900"
                      aria-label={b.name}
                    >
                      {b.name}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Botón flotante + modal de control en vivo */}
      {branches && branches.length > 0 && (
        <>
          <button
            onClick={() => setAlertOpen(true)}
            className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg shadow-rose-600/30 transition hover:bg-rose-500 active:scale-95"
            aria-label="Abrir control en vivo"
            title="Control en vivo"
          >
            <Mic size={24} />
          </button>
          {alertOpen && (
            <AlertPanel branches={branches} onClose={() => setAlertOpen(false)} />
          )}
        </>
      )}
    </div>
  );
}
