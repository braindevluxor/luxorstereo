"use client";

// Botón de instrucciones reutilizable: cada vista del panel pasa su propia
// guía (título + pasos con captura real de esa pantalla) y el componente
// abre un modal con el paso a paso ilustrado. Así cualquier vista nueva
// sólo necesita definir sus pasos y montar <HelpButton guide={…} />.

import { useEffect, useState } from "react";
import { CircleQuestionMark, X } from "lucide-react";
import { Button } from "@/components/ui";

export interface GuideStep {
  /** Captura real de la vista (archivo en /public). */
  image: string;
  /** Texto alternativo de la imagen (accesibilidad y respaldo). */
  alt: string;
  title: string;
  body: string;
}

export interface Guide {
  title: string;
  intro?: string;
  steps: GuideStep[];
}

export default function HelpButton({ guide }: { guide: Guide }) {
  const [open, setOpen] = useState(false);

  // Esc para cerrar (mismo comportamiento que el resto de modales).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5"
      >
        <CircleQuestionMark size={16} />
        Instrucciones
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Fondo difuso: clic para cerrar */}
          <button
            aria-label="Cerrar instrucciones"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          {/* Panel modal */}
          <div className="relative z-10 m-4 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <CircleQuestionMark size={18} className="text-blue-500" />
                  {guide.title}
                </h2>
                {guide.intro && (
                  <p className="mt-0.5 text-sm text-slate-500">{guide.intro}</p>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <X size={18} />
              </button>
            </div>

            <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {guide.steps.map((step, i) => (
                <li
                  key={step.image}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">
                      {i + 1}
                    </span>
                    <h3 className="text-sm font-bold text-slate-900">
                      {step.title}
                    </h3>
                  </div>
                  <img
                    src={step.image}
                    alt={step.alt}
                    loading="lazy"
                    className="mt-3 w-full rounded-lg border border-slate-200"
                  />
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-600">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
