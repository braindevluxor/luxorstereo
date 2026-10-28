// Validación de variables de entorno compartida por cliente y servidor.
// Separada de client.ts para poder usarla también en el middleware y en los
// Server Components (el cliente lleva la directiva "use client").

export function supabaseEnvProblem(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!url || !anonKey) {
    return (
      "Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: " +
      "en local van en .env.local y en Vercel en Settings → Environment Variables."
    );
  }
  if (/placeholder/i.test(url) || /placeholder/i.test(anonKey)) {
    return (
      "Las variables de Supabase siguen con el valor de ejemplo: sustitúyelas " +
      "por tu Project URL y tu anon key reales y vuelve a desplegar."
    );
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      return `NEXT_PUBLIC_SUPABASE_URL no es HTTPS válida: ${url}`;
    }
  } catch {
    return `NEXT_PUBLIC_SUPABASE_URL no es una URL válida: ${url}`;
  }
  return null;
}
