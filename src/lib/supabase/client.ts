"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnvProblem } from "./env";

export { supabaseEnvProblem };

// Cliente de navegador (singleton). Se usa tanto en el panel de administración
// como en el reproductor de sucursal (que sólo llama a las RPC públicas).
//
// Importante: se usa createBrowserClient de @supabase/ssr (y no createClient
// de supabase-js) para que la sesión viva en COOKIES: así el middleware y los
// Server Components (guard de /admin) pueden leerla. Con storage en
// localStorage el login "funciona" pero el servidor no ve al usuario.
let client: SupabaseClient | null = null;

// ---------- diagnóstico del websocket de la app ----------
// Cuando el websocket de la app se cae, la librería sólo informa el estado
// "CLOSED" sin decir por qué. Este envoltorio registra el código y el motivo
// reales del último cierre de un socket de Supabase (sólo se observa, no se
// bloquea ni se modifica nada) para mostrarlos en la barra de estado del
// reproductor y poder diagnosticar sin herramientas de desarrollador.
let lastSocketClose: { code: number; reason: string } | null = null;
let ignoreNextClose = false;

/** Texto del último cierre de websocket de Supabase; null si no hubo ninguno. */
export function socketCloseInfo(): string | null {
  if (!lastSocketClose) return null;
  const { code, reason } = lastSocketClose;
  return `código ${code}${reason ? ` (${reason})` : ""}`;
}

/**
 * Excluye del registro al próximo socket de Supabase que se abra: lo usa la
 * sonda de diagnóstico del reproductor (abre y cierra un socket a propósito
 * y su cierre no debe confundirse con el de la app).
 */
export function ignoreNextSocketClose(): void {
  ignoreNextClose = true;
}

function installSocketTrace(): void {
  if (typeof window === "undefined") return;
  const Native = window.WebSocket;
  if ((Native as unknown as { __luxorTrace?: boolean }).__luxorTrace) return;

  function TrackedWebSocket(
    url: string | URL,
    protocols?: string | string[],
  ): WebSocket {
    const socket = new Native(url, protocols);
    // Sólo interesan los sockets de Supabase (no HMR, analytics, etc.).
    if (String(url).includes(".supabase.co")) {
      if (ignoreNextClose) {
        ignoreNextClose = false;
      } else {
        socket.addEventListener("close", (e: CloseEvent) => {
          // Se registra incluso el cierre limpio (1000): phoenix cierra con
          // ese código y el motivo real ("heartbeat timeout", etc.) en reason.
          lastSocketClose = { code: e.code, reason: e.reason };
        });
        socket.addEventListener("open", () => {
          // Socket vivo otra vez: el cierre anterior ya no explica nada.
          lastSocketClose = null;
        });
      }
    }
    return socket;
  }

  // Conservar prototype y estáticas: `x instanceof WebSocket` sigue válido.
  TrackedWebSocket.prototype = Native.prototype;
  Object.assign(TrackedWebSocket, Native);
  (TrackedWebSocket as unknown as { __luxorTrace?: boolean }).__luxorTrace =
    true;
  window.WebSocket = TrackedWebSocket as unknown as typeof WebSocket;
}

export function getSupabase(): SupabaseClient {
  if (client) return client;

  installSocketTrace();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(supabaseEnvProblem() ?? "Configuración de Supabase ausente");
  }

  client = createBrowserClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  return client;
}
