"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Radio } from "lucide-react";
import { getSupabase, supabaseEnvProblem } from "@/lib/supabase/client";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Si el entorno no está configurado (p. ej. deploy sin variables de entorno)
  // lo decimos de entrada, sin esperar a que el usuario pulse Entrar.
  useEffect(() => {
    const problem = supabaseEnvProblem();
    if (problem) setError(problem);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const envProblem = supabaseEnvProblem();
    if (envProblem) {
      setError(envProblem);
      return;
    }

    setLoading(true);
    try {
      const { error: signInError } = await getSupabase().auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      router.replace(next);
      router.refresh();
      // Si por cualquier motivo la navegación regresa al login, el botón
      // vuelve a su estado normal en vez de quedarse en "Verificando…".
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo iniciar sesión";
      setError(
        /failed to fetch|networkerror|load failed/i.test(message)
          ? "No se pudo contactar con Supabase: revisa NEXT_PUBLIC_SUPABASE_URL en .env.local y reinicia el servidor."
          : message,
      );
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-surface p-7 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white">
            <Radio size={18} />
          </span>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-blue-400">
            LuxorStereo
          </p>
        </div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Panel de control</h1>
        <p className="mt-1 text-sm text-slate-500">
          Acceso restringido al equipo de marketing/operaciones.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <Field label="Correo">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operaciones@luxor.mx"
            />
          </Field>
          <Field label="Contraseña">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>

          <ErrorNote message={error} />

          <Button type="submit" disabled={loading} className="w-full !py-3">
            {loading ? "Verificando…" : "Entrar"}
          </Button>
        </form>

        <p className="mt-5 text-xs leading-relaxed text-slate-400">
          El alta de usuarios se hace en Supabase → Authentication → Users
          (no hay registro público para proteger el panel).
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
