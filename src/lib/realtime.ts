"use client";

// Emisión de eventos a los reproductores de sucursal mediante canales
// públicos de Supabase Realtime (broadcast). El nombre del canal incluye el
// branch_key, de modo que sólo quien conoce la sucursal puede escucharla.

import { getSupabase } from "@/lib/supabase/client";

const JOIN_TIMEOUT_MS = 5_000;

export async function broadcastToBranch(
  branchKey: string,
  event: "alert" | "reload",
  payload: unknown,
): Promise<boolean> {
  const supabase = getSupabase();
  const channel = supabase.channel(`branch:${branchKey}`);

  try {
    const joined = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), JOIN_TIMEOUT_MS);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve(true);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          resolve(false);
        }
      });
    });

    if (!joined) return false;

    const result = await channel.send({
      type: "broadcast",
      event,
      payload,
    });
    return result === "ok";
  } catch {
    return false;
  } finally {
    void supabase.removeChannel(channel);
  }
}

export async function broadcastToBranches(
  branchKeys: string[],
  event: "alert" | "reload",
  payload: unknown,
): Promise<{ sent: number; failed: number }> {
  const results = await Promise.all(
    branchKeys.map((key) => broadcastToBranch(key, event, payload)),
  );
  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent };
}
