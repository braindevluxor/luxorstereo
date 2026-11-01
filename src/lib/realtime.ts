"use client";

// Emisión de eventos a los reproductores de sucursal mediante canales
// públicos de Supabase Realtime (broadcast). El nombre del canal incluye el
// branch_key, de modo que sólo quien conoce la sucursal puede escucharla.
//
// El envío usa la API REST de Realtime (`httpSend`), SIN suscribirse al
// canal: así nunca choca con el canal de presencia que el panel ya tiene
// abierto con el mismo tópico (`channel()` reutiliza la instancia existente
// y re-suscribirse a un tópico ya unido nunca confirma el estado → el envío
// fallaba con «Ninguna sucursal confirmó la recepción»), y se entrega aunque
// el websocket de ESTE cliente esté caído: sólo hace falta que esté conectado
// el reproductor de la sucursal.

import { getSupabase } from "@/lib/supabase/client";

export async function broadcastToBranch(
  branchKey: string,
  event: "alert" | "reload",
  payload: unknown,
): Promise<boolean> {
  const supabase = getSupabase();
  const topic = `branch:${branchKey}`;

  // `channel()` devuelve la instancia ya existente si el tópico está creado
  // (p. ej. la del hook de presencia del panel): sólo se retira del cliente
  // la que se cree aquí para enviar, nunca una ajena.
  const preexisting = supabase
    .getChannels()
    .some((c) => c.topic === `realtime:${topic}`);
  const channel = supabase.channel(topic);

  try {
    const res = await channel.httpSend(event, payload);
    return res.success;
  } catch {
    return false;
  } finally {
    if (!preexisting) void supabase.removeChannel(channel);
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
