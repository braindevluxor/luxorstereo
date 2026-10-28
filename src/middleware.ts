import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnvProblem } from "@/lib/supabase/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

const ADMIN_PREFIX = "/admin";

// Refresca la sesión de Supabase en cada petición y protege el panel /admin.
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/login";

  // Sin variables de entorno válidas no podemos validar la sesión: degradamos
  // a la pantalla de acceso (que explica el problema) en vez de un 500 opaco.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || supabaseEnvProblem()) {
    if (pathname.startsWith(ADMIN_PREFIX)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Importante: getUser() valida la sesión con el servidor de Auth.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && pathname.startsWith(ADMIN_PREFIX)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLoginPage) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/admin";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/login"],
};
