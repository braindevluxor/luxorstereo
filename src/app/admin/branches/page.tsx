"use client";

// Gestión de sucursales: alta, edición, activación y enlace del reproductor.

import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import type { Branch } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Spinner,
} from "@/components/ui";

const ONLINE_WINDOW_MS = 60_000;

// Zona horaria fija para todas las sucursales.
const DEFAULT_TIMEZONE = "America/Caracas";

function playerUrl(branchKey: string, origin: string) {
  return `${origin}/branch?key=${branchKey}`;
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Formulario de alta
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const timezone = DEFAULT_TIMEZONE;
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await getSupabase()
      .from("branches")
      .select("*")
      .order("name");
    if (err) {
      setError(err.message);
      return;
    }
    setBranches((data as Branch[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  async function createBranch(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error: err } = await getSupabase()
      .from("branches")
      .insert({ name: name.trim(), city: city.trim() || null, timezone });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setName("");
    setCity("");
    await load();
  }

  async function patchBranch(id: string, patch: Partial<Branch>) {
    setError(null);
    const { error: err } = await getSupabase()
      .from("branches")
      .update(patch)
      .eq("id", id);
    if (err) setError(err.message);
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
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Sucursales</h1>
        <p className="text-sm text-slate-500">
          Cada sucursal tiene una clave propia que autentica a su reproductor.
        </p>
      </header>

      <ErrorNote message={error} />

      <Card title="Nueva sucursal">
        <form
          onSubmit={createBranch}
          className="grid gap-4 sm:grid-cols-[1.2fr_1fr_auto]"
        >
          <Field label="Nombre">
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Luxor Centro"
            />
          </Field>
          <Field label="Ciudad">
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Puebla"
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? "Creando…" : "Crear"}
            </Button>
          </div>
        </form>
      </Card>

      <Card title={`Listado (${branches?.length ?? 0})`}>
        {branches === null ? (
          <Spinner />
        ) : branches.length === 0 ? (
          <EmptyState>Crea la primera sucursal con el formulario superior.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {branches.map((b) => {
              const online =
                b.active &&
                !!b.last_ping &&
                now - Date.parse(b.last_ping) < ONLINE_WINDOW_MS;
              const link = playerUrl(b.branch_key, typeof window !== "undefined" ? window.location.origin : "");

              return (
                <li
                  key={b.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          defaultValue={b.name}
                          onBlur={(e) =>
                            e.target.value !== b.name &&
                            e.target.value.trim() &&
                            patchBranch(b.id, { name: e.target.value.trim() })
                          }
                          className="w-full max-w-xs rounded-lg bg-transparent px-1 py-0.5 font-semibold text-slate-900 outline-none hover:bg-slate-50 focus:bg-slate-800"
                          aria-label="Nombre de la sucursal"
                        />
                        <Badge tone={!b.active ? "slate" : online ? "emerald" : "rose"}>
                          {!b.active ? "Inactiva" : online ? "En línea" : "Desconectada"}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate px-1 text-xs text-slate-500">
                        {b.city ?? "Sin ciudad"} · {b.timezone}
                      </p>
                      <code className="mt-1 block truncate px-1 text-[11px] text-slate-400">
                        {link}
                      </code>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => copyLink(b)}
                        className="flex items-center gap-1.5"
                      >
                        {copiedId === b.id ? (
                          <>
                            <Check size={14} /> Copiado
                          </>
                        ) : (
                          <>
                            <Copy size={14} /> Copiar enlace
                          </>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => patchBranch(b.id, { active: !b.active })}
                      >
                        {b.active ? "Desactivar" : "Activar"}
                      </Button>
                      <Button variant="danger" onClick={() => removeBranch(b)}>
                        Eliminar
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
