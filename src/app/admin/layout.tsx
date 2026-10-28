import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseEnvProblem } from "@/lib/supabase/env";
import AdminNav from "@/components/admin/AdminNav";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Entorno sin configurar (p. ej. deploy sin variables): en vez de lanzar
  // una excepción de servidor, mandamos al usuario a la pantalla de acceso.
  if (supabaseEnvProblem()) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="min-h-dvh">
      <AdminNav email={user.email ?? ""} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
