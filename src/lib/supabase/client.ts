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

export function getSupabase(): SupabaseClient {
  if (client) return client;

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
