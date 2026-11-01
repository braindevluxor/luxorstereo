"use client";

// Gestión de sucursales: alta, edición, activación y enlace del reproductor.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Upload } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { useBranchUsage } from "@/components/admin/useBranchUsage";
import type { Branch } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Spinner,
} from "@/components/ui";

const ONLINE_WINDOW_MS = 120_000;

// Apariencia del reproductor: imagen de fondo en bucket "images" + ajuste
// global en station_settings (lo lee el reproductor vía RPC).
const IMAGE_BUCKET = "images";
const BG_KEY = "player_background";
const BG_PATH_KEY = "player_background_path";
const BG_MAX_BYTES = 5_000_000;

function playerUrl(branchKey: string, origin: string) {
  return `${origin}/branch?key=${branchKey}`;
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Fondo del reproductor (ajuste global)
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgSaving, setBgSaving] = useState(false);
  const bgPathRef = useRef<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

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

  // Carga la imagen de fondo vigente (si la tabla existe).
  useEffect(() => {
    void (async () => {
      const { data, error: err } = await getSupabase()
        .from("station_settings")
        .select("key, value")
        .in("key", [BG_KEY, BG_PATH_KEY]);
      if (err || !data) return;
      const map = new Map(data.map((r) => [r.key, r.value]));
      bgPathRef.current = map.get(BG_PATH_KEY) ?? null;
      setBgUrl(map.get(BG_KEY) ?? null);
    })();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Refresco periódico de latidos (esta vista no escucha Realtime de BD).
  useEffect(() => {
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  // Uso en vivo: qué links están abiertos/sonando (presencia Realtime).
  const usage = useBranchUsage(branches);
  const isOnline = (b: Branch) =>
    b.active &&
    (usage.has(b.id) ||
      (!!b.last_ping && now - Date.parse(b.last_ping) < ONLINE_WINDOW_MS));

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

  async function uploadBg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("El fondo debe ser una imagen: JPG, PNG o WebP.");
      return;
    }
    if (file.size > BG_MAX_BYTES) {
      setError("La imagen de fondo no puede superar 5 MB.");
      return;
    }

    setBgSaving(true);
    setError(null);
    const supabase = getSupabase();
    const ext = (file.name.includes(".") ? file.name.split(".").pop() : "jpg")!
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const path = `player-bg/${crypto.randomUUID()}.${ext || "jpg"}`;

    const { error: upErr } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setError(
        upErr.message.includes(IMAGE_BUCKET)
          ? `${upErr.message}. Ejecuta supabase/player-appearance.sql en el SQL Editor de Supabase.`
          : upErr.message,
      );
      setBgSaving(false);
      return;
    }

    const { data: pub } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    const { error: setErr } = await supabase
      .from("station_settings")
      .upsert([{ key: BG_KEY, value: pub.publicUrl }]);
    if (setErr) {
      setError(
        `${setErr.message}. Ejecuta supabase/player-appearance.sql en el SQL Editor de Supabase.`,
      );
      await supabase.storage.from(IMAGE_BUCKET).remove([path]);
      setBgSaving(false);
      return;
    }

    const oldPath = bgPathRef.current;
    bgPathRef.current = path;
    setBgUrl(pub.publicUrl);
    await supabase.from("station_settings").upsert([{ key: BG_PATH_KEY, value: path }]);
    if (oldPath && oldPath !== path) {
      await supabase.storage.from(IMAGE_BUCKET).remove([oldPath]);
    }
    setBgSaving(false);
  }

  async function clearBg() {
    setBgSaving(true);
    const supabase = getSupabase();
    const path = bgPathRef.current;
    await supabase.from("station_settings").delete().in("key", [BG_KEY, BG_PATH_KEY]);
    bgPathRef.current = null;
    setBgUrl(null);
    if (path) await supabase.storage.from(IMAGE_BUCKET).remove([path]);
    setBgSaving(false);
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

      <Card
        title="Apariencia del reproductor"
        description="Imagen de fondo de la pantalla que ven las sucursales."
      >
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="flex h-24 w-44 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-800 bg-cover bg-center text-center text-xs text-slate-500"
            style={bgUrl ? { backgroundImage: `url("${bgUrl}")` } : undefined}
            role="img"
            aria-label="Vista previa del fondo del reproductor"
          >
            {!bgUrl && <span className="px-2">Sin imagen · degradado por defecto</span>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={uploadBg}
            />
            <Button
              onClick={() => bgInputRef.current?.click()}
              disabled={bgSaving}
              className="flex items-center gap-1.5"
            >
              <Upload size={14} />
              {bgSaving ? "Guardando…" : bgUrl ? "Cambiar imagen" : "Subir imagen"}
            </Button>
            {bgUrl && (
              <Button variant="ghost" onClick={() => void clearBg()} disabled={bgSaving}>
                Quitar
              </Button>
            )}
            <p className="basis-full text-xs text-slate-500">
              JPG, PNG o WebP · máx. 5 MB. Los reproductores la toman en ~1 minuto.
            </p>
          </div>
        </div>
      </Card>

      <Card title={`Listado (${branches?.length ?? 0})`}>
        {branches === null ? (
          <Spinner />
        ) : branches.length === 0 ? (
          <EmptyState>
            Aún no hay sucursales: créala desde el «Panel» (botón «Nueva
            sucursal»).
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {branches.map((b) => {
              const online = isOnline(b);
              const livePlaying = usage.get(b.id)?.playing ?? false;
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
                          {!b.active
                            ? "Inactiva"
                            : online
                              ? livePlaying
                                ? "Reproduciendo"
                                : "En línea"
                              : "Desconectada"}
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
