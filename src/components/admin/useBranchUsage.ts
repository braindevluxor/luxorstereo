"use client";

// Uso en vivo de los reproductores de sucursal.
//
// El reproductor hace `track()` en el canal Realtime `branch:<key>` al abrir
// la pantalla y al cambiar entre reproduciendo/pausa. Este hook se suscribe a
// esos canales desde el panel y devuelve, por sucursal, si el link está en
// uso y si está sonando — en tiempo real y sin depender del latido en BD
// (si el websocket falla, el panel sigue usando last_ping como respaldo).

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { Branch } from "@/lib/types";

export interface BranchUsage {
  /** La pantalla de la sucursal está abierta (link en uso). */
  open: boolean;
  /** El reproductor está reproduciendo en este momento. */
  playing: boolean;
  /** «Título — artista» que el reproductor reporta como suena ahora. */
  track: string | null;
  /** Pantallas/pestañas abiertas con este mismo link (presencias). */
  screens: number;
}

interface PresencePayload {
  started?: boolean;
  playing?: boolean;
  track?: string | null;
}

export function useBranchUsage(branches: Branch[] | null): Map<string, BranchUsage> {
  const [usage, setUsage] = useState<Map<string, BranchUsage>>(new Map());

  // Firma estable de las sucursales activas: re-suscribe sólo si cambia el
  // conjunto (alta/baja/activación), no en cada refresco de datos.
  const signature =
    branches
      ?.filter((b) => b.active)
      .map((b) => `${b.id}:${b.branch_key}`)
      .join("|") ?? "";

  useEffect(() => {
    if (!signature) return;

    const entries = signature.split("|").map((pair) => {
      const sep = pair.indexOf(":");
      return { id: pair.slice(0, sep), branchKey: pair.slice(sep + 1) };
    });

    const supabase = getSupabase();
    const channels = entries.map(({ id, branchKey }) => {
      const ch = supabase.channel(`branch:${branchKey}`);

      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState<PresencePayload>();
        const payloads = Object.values(state).flat();
        const playingOnes = payloads.filter((p) => p?.playing === true);
        const entry: BranchUsage = {
          open: payloads.length > 0,
          playing: playingOnes.length > 0,
          // La pista la aporta quien esté reproduciendo (si varias pantallas
          // suenan distinto, se muestra la primera: se avisa con `screens`).
          track: playingOnes.find((p) => p?.track)?.track ?? null,
          screens: payloads.length,
        };

        setUsage((prev) => {
          const current = prev.get(id);
          if (
            current &&
            current.open === entry.open &&
            current.playing === entry.playing &&
            current.track === entry.track &&
            current.screens === entry.screens
          ) {
            return prev;
          }
          const next = new Map(prev);
          if (entry.open) next.set(id, entry);
          else next.delete(id);
          return next;
        });
      });

      void ch.subscribe();
      return ch;
    });

    return () => {
      for (const ch of channels) void ch.unsubscribe();
      setUsage(new Map());
    };
  }, [signature]);

  return usage;
}
