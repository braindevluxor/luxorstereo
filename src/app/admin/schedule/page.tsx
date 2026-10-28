"use client";

// Programación: asignar playlists a cada sucursal con sus reglas de
// reproducción (franjas horarias, rotación de spots, orden aleatorio).

import { useCallback, useEffect, useState } from "react";
import { Plus, Radio } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { broadcastToBranch } from "@/lib/realtime";
import { EMPTY_RULES } from "@/lib/schedule";
import type { Branch, BranchPlaylist, Playlist, ScheduleRules } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Spinner,
  inputClass,
} from "@/components/ui";

type Assignment = BranchPlaylist & { playlist: { name: string } | null };

function toNumber(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function isHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

function AssignmentRow({
  branch,
  playlists,
  assignment,
  onChanged,
}: {
  branch: Branch;
  playlists: Playlist[];
  assignment: Assignment;
  onChanged: () => void;
}) {
  const rules: ScheduleRules = { ...EMPTY_RULES, ...assignment.schedule_rules };
  const [from, setFrom] = useState(rules.window?.from ?? "");
  const [to, setTo] = useState(rules.window?.to ?? "");
  const [everyN, setEveryN] = useState(
    rules.commercialEveryNTracks ? String(rules.commercialEveryNTracks) : "",
  );
  const [everyM, setEveryM] = useState(
    rules.commercialEveryMinutes ? String(rules.commercialEveryMinutes) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Partial<BranchPlaylist>) {
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabase()
      .from("branch_playlists")
      .update(patch)
      .eq("id", assignment.id);
    setBusy(false);
    if (err) setError(err.message);
    else {
      onChanged();
      void broadcastToBranch(branch.branch_key, "reload", { at: Date.now() });
    }
  }

  function commitWindow() {
    const fromOk = from.trim() === "" || isHHMM(from);
    const toOk = to.trim() === "" || isHHMM(to);
    if (!fromOk || !toOk) {
      setError("Formato de hora inválido (usa HH:MM, 24 h).");
      return;
    }
    const same = (rules.window?.from ?? "") === from.trim() &&
      (rules.window?.to ?? "") === to.trim();
    if (same) return;

    const window =
      from.trim() && to.trim()
        ? { from: from.trim(), to: to.trim() }
        : null;
    void save({ schedule_rules: { ...rules, window } });
  }

  function commitRules(patch: Partial<ScheduleRules>) {
    void save({ schedule_rules: { ...rules, ...patch } });
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Playlist">
          <select
            value={assignment.playlist_id}
            onChange={(e) => void save({ playlist_id: e.target.value })}
            className={inputClass}
          >
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Franja horaria" hint="Vacío = todo el día (hora local).">
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              onBlur={commitWindow}
              className={`${inputClass} !w-[5.5rem]`}
              aria-label="Desde"
            />
            <span className="text-slate-400">→</span>
            <input
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onBlur={commitWindow}
              className={`${inputClass} !w-[5.5rem]`}
              aria-label="Hasta"
            />
          </div>
        </Field>

        <Field label="Spot cada N canciones" hint="Vacío o 0 = desactivado.">
          <input
            type="number"
            min={0}
            value={everyN}
            onChange={(e) => setEveryN(e.target.value)}
            onBlur={() => commitRules({ commercialEveryNTracks: toNumber(everyN) })}
            className={inputClass}
            placeholder="3"
          />
        </Field>

        <Field label="Spot cada M minutos" hint="Vacío o 0 = desactivado.">
          <input
            type="number"
            min={0}
            value={everyM}
            onChange={(e) => setEveryM(e.target.value)}
            onBlur={() => commitRules({ commercialEveryMinutes: toNumber(everyM) })}
            className={inputClass}
            placeholder="15"
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={!!rules.shuffle}
            onChange={(e) => commitRules({ shuffle: e.target.checked })}
            className="h-4 w-4 accent-blue-600"
          />
          Orden aleatorio
        </label>

        <Badge tone={assignment.active ? "emerald" : "slate"}>
          {assignment.active ? "Activa" : "Pausada"}
        </Badge>
        <button
          onClick={() => void save({ active: !assignment.active })}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700"
        >
          {assignment.active ? "Pausar" : "Activar"}
        </button>

        <span className={`text-xs ${busy ? "text-amber-600" : "text-emerald-600"}`}>
          {busy ? "Guardando…" : ""}
        </span>

        <button
          onClick={async () => {
            if (!window.confirm("¿Quitar esta playlist de la sucursal?")) return;
            setBusy(true);
            const { error: err } = await getSupabase()
              .from("branch_playlists")
              .delete()
              .eq("id", assignment.id);
            setBusy(false);
            if (err) setError(err.message);
            else onChanged();
          }}
          className="ml-auto text-xs font-semibold text-rose-600 hover:text-rose-700"
        >
          Quitar asignación
        </button>

        {error && <p className="w-full text-xs text-rose-600">{error}</p>}
      </div>
    </li>
  );
}

export default function SchedulePage() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadBase = useCallback(async () => {
    const supabase = getSupabase();
    const [branchRes, playlistRes] = await Promise.all([
      supabase.from("branches").select("*").order("name"),
      supabase.from("playlists").select("*").order("name"),
    ]);
    if (branchRes.error) setError(branchRes.error.message);
    const list = (branchRes.data as Branch[]) ?? [];
    setBranches(list);
    setPlaylists((playlistRes.data as Playlist[]) ?? []);
    if (!branchId && list.length > 0) setBranchId(list[0].id);
  }, [branchId]);

  const loadAssignments = useCallback(async () => {
    setAssignments(null);
    if (!branchId) return;
    const { data, error: err } = await getSupabase()
      .from("branch_playlists")
      .select("*, playlist:playlists(name)")
      .eq("branch_id", branchId)
      .order("created_at");
    if (err) setError(err.message);
    setAssignments((data as unknown as Assignment[]) ?? []);
  }, [branchId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const branch = branches?.find((b) => b.id === branchId) ?? null;

  async function addAssignment() {
    if (!branchId) return;
    if (playlists.length === 0) {
      setError("Primero crea una playlist en la pestaña «Playlists».");
      return;
    }
    const { error: err } = await getSupabase().from("branch_playlists").insert({
      branch_id: branchId,
      playlist_id: playlists[0].id,
      schedule_rules: EMPTY_RULES,
    });
    if (err) setError(err.message);
    await loadAssignments();
  }

  async function pushToBranch() {
    if (!branch) return;
    setFeedback(null);
    const ok = await broadcastToBranch(branch.branch_key, "reload", {
      at: Date.now(),
    });
    setFeedback(
      ok
        ? `Programación aplicada en «${branch.name}».`
        : `«${branch.name}» no confirmó (¿está el reproductor abierto y con internet?).`,
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Programación</h1>
          <p className="text-sm text-slate-500">
            Reglas por sucursal: franjas horarias, frecuencia de spots y orden.
          </p>
        </div>
        <Button onClick={pushToBranch} disabled={!branch} className="flex items-center gap-2">
          <Radio size={16} />
          Aplicar en la sucursal
        </Button>
      </header>

      <ErrorNote message={error} />
      {feedback && (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {feedback}
        </p>
      )}

      <Card title="Sucursal">
        {branches === null ? (
          <Spinner />
        ) : branches.length === 0 ? (
          <EmptyState>
            Crea una sucursal en «Sucursales» antes de programarla.
          </EmptyState>
        ) : (
          <div className="flex flex-wrap gap-2">
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => setBranchId(b.id)}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  b.id === branchId
                    ? "brand-gradient text-white"
                    : "border border-slate-300 bg-slate-800 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Asignaciones de la sucursal"
        description={
          branch
            ? `${assignments?.length ?? 0} playlist(s) · zona horaria ${branch.timezone}`
            : undefined
        }
        action={
          <Button variant="ghost" onClick={addAssignment} disabled={!branchId} className="flex items-center gap-1.5">
            <Plus size={16} />
            Añadir playlist
          </Button>
        }
      >
        {assignments === null ? (
          <Spinner />
        ) : assignments.length === 0 ? (
          <EmptyState>
            Esta sucursal aún no tiene playlists asignadas: no reproducirá nada.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {assignments.map((assignment) => (
              <AssignmentRow
                key={assignment.id}
                branch={branch!}
                playlists={playlists}
                assignment={assignment}
                onChanged={() => void loadAssignments()}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Cómo decide el reproductor">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
          <li>Busca la asignación cuya franja horaria contenga la hora local de la sucursal.</li>
          <li>Si ninguna aplica, usa la primera asignación sin franja (todo el día).</li>
          <li>
            Recorre la playlist y, al llegar al límite de canciones o minutos configurado,
            inserta un spot (los de la playlist o, en su defecto, de la librería).
          </li>
          <li>Al terminar la cola vuelve a empezar; si cambia la franja, cambia la playlist.</li>
        </ol>
      </Card>
    </div>
  );
}
