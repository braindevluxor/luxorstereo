"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AudioLines,
  Building2,
  CalendarRange,
  LayoutDashboard,
  ListMusic,
  LogOut,
  Music2,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";

const LINKS = [
  { href: "/admin", label: "Panel", icon: LayoutDashboard },
  { href: "/admin/branches", label: "Sucursales", icon: Building2 },
  { href: "/admin/media", label: "Medios", icon: Music2 },
  { href: "/admin/playlists", label: "Playlists", icon: ListMusic },
  { href: "/admin/schedule", label: "Programación", icon: CalendarRange },
];

export default function AdminNav({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  // Luz de estado: conectividad del navegador (la fuente de datos del panel).
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <nav className="sticky top-0 z-30 border-b border-slate-200 bg-app/95 backdrop-blur">
      <div className="mx-auto flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-lg text-white">
            <AudioLines size={18} />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-black tracking-wide text-slate-900">
              LUXORSTEREO
            </p>
            <p className="text-[11px] text-slate-500">Hilo musical corporativo</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-blue-50 text-blue-400"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon size={16} />
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
              online
                ? "bg-emerald-50 text-emerald-600 ring-emerald-200"
                : "bg-rose-50 text-rose-600 ring-rose-200"
            }`}
            title={online ? "Conectado" : "Sin conexión a internet"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                online ? "animate-pulse bg-emerald-500" : "bg-rose-500"
              }`}
            />
            {online ? "En línea" : "Sin conexión"}
          </span>
          <span className="hidden text-xs text-slate-500 sm:inline">{email}</span>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <LogOut size={14} />
            Salir
          </button>
        </div>
      </div>
    </nav>
  );
}
