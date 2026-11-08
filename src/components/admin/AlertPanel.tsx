"use client";

// Control en vivo: envío de alertas/avisos urgentes a una o todas las
// sucursales. Se guardan en BD (push_branch_alert) y el reproductor las
// recoge cada 3 s por REST: sin Realtime.

import { useEffect, useState } from "react";
import { Megaphone, Mic, X } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import type { Branch, Track } from "@/lib/types";
import { Button, ErrorNote, Field, Input, inputClass } from "@/components/ui";

export default function AlertPanel({
  branches,
  onClose,
  initialTarget = "all",
}: {
  branches: Branch[];
  onClose: () => void;
  /** Sucursal preseleccionada ("all" o el id de una sucursal). */
  initialTarget?: string;
}) {
  const [target, setTarget] = useState<string>(initialTarget);
  const [title, setTitle] = useState("Aviso importante");
  const [message, setMessage] = useState("");
  const [audioTrackId, setAudioTrackId] = useState("");
  // "" = automático; número = segundos estáticos; "0" = permanente.
  const [hold, setHold] = useState("");
  const [commercials, setCommercials] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .from("tracks")
      .select("*")
      .eq("type", "commercial")
      .order("title")
      .then(({ data }) => {
        if (!cancelled) setCommercials((data as Track[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeBranches = branches.filter((b) => b.active);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);

    if (!message.trim()) {
      setError("Escribe el texto del aviso.");
      return;
    }

    const targets =
      target === "all"
        ? activeBranches
        : activeBranches.filter((b) => b.id === target);

    if (targets.length === 0) {
      setError("No hay sucursales activas para enviar el aviso.");
      return;
    }

    const audio = commercials.find((t) => t.id === audioTrackId);

    const payload: Record<string, unknown> = {
      id: crypto.randomUUID(),
      title: title.trim() || "Aviso prioritario",
      message: message.trim(),
      audio_url: audio?.file_url ?? null,
      sent_at: new Date().toISOString(),
    };
    if (hold !== "") payload.hold_seconds = Number(hold);

    setSending(true);
    const results = await Promise.all(
      targets.map(async (b) => {
        try {
          const { error } = await getSupabase().rpc("push_branch_alert", {
            p_branch_key: b.branch_key,
            p_payload: payload,
          });
          return !error;
        } catch {
          return false;
        }
      }),
    );
    setSending(false);
    const sent = results.filter(Boolean).length;
    const failed = results.length - sent;

    if (sent === 0) {
      setError("Ninguna sucursal confirmó la recepción. Revisa su conexión.");
    } else {
      setFeedback(`Aviso enviado a ${sent} sucursal(es)${failed ? ` (${failed} sin confirmar)` : ""}.`);
      setMessage("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Fondo difuso: clic para cerrar */}
      <button
        aria-label="Cerrar control en vivo"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      {/* Panel modal */}
      <div className="relative z-10 m-4 w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-2xl sm:m-6">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Mic size={18} className="text-rose-500" />
              Control en vivo
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Las alertas interrumpen la música en la sucursal y llegan en unos
              segundos.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={send} className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <Field label="Destino">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={inputClass}
          >
            <option value="all">Todas las sucursales ({activeBranches.length})</option>
            {activeBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.city ? ` · ${b.city}` : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Título">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Mensaje" hint="Ajusta aquí abajo cuánto tiempo permanece en pantalla y si se corta la música.">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="Cierre de caja anticipado a las 21:00 por mantenimiento."
              className={`${inputClass} resize-y`}
            />
          </Field>
        </div>

        <Field
          label="Permanencia del mensaje"
          hint="Automático: dura lo mismo que el spot si hay audio; si es solo texto (~1 s por carácter) no se corta la música."
        >
          <select
            value={hold}
            onChange={(e) => setHold(e.target.value)}
            className={inputClass}
          >
            <option value="">Automático</option>
            <option value="15">Estático 15 segundos</option>
            <option value="30">Estático 30 segundos</option>
            <option value="60">Estático 1 minuto</option>
            <option value="120">Estático 2 minutos</option>
            <option value="300">Estático 5 minutos</option>
            <option value="0">Permanente (hasta «Entendido»)</option>
          </select>
        </Field>

        <Field label="Audio de alerta (opcional)">
          <select
            value={audioTrackId}
            onChange={(e) => setAudioTrackId(e.target.value)}
            className={inputClass}
          >
            <option value="">— sin audio, sólo mensaje visual —</option>
            {commercials.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Button type="submit" disabled={sending} className="flex w-full items-center justify-center gap-2">
            {sending ? "Enviando…" : (<><Megaphone size={16} /> Enviar alerta</>)}
          </Button>
        </div>

        <div className="sm:col-span-2 space-y-2">
          <ErrorNote message={error} />
          {feedback && (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {feedback}
            </p>
          )}
        </div>
      </form>
      </div>
    </div>
  );
}
