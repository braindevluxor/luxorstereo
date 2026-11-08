"use client";

// Lienzo de la onda de sonido: bucle de animación + dibujo compartido
// (ver src/lib/waveform.ts). Lo usan:
//   · El reproductor, con el AnalyserNode real del audio.
//   · La vista previa de «Personalización», sin audio (espectro decorativo).

import { useEffect, useRef, type RefObject } from "react";
import { drawWave, type WaveConfig } from "@/lib/waveform";
import type { PlayerEngine } from "./useBranchPlayer";

export default function WaveCanvas({
  cfg,
  engine,
  playing,
  avoid,
  className,
}: {
  cfg: WaveConfig;
  /** Ref del motor: se lee su AnalyserNode en vivo en cada cuadro. */
  engine?: RefObject<PlayerEngine>;
  playing: boolean;
  /**
   * Elemento (la palabra del héroe) del que no deben cruzar picos, barras y
   * orbe: se dibujan sólo a su lado, hasta el borde de la pantalla.
   */
  avoid?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Valor «siempre actual» de la configuración sin reiniciar el bucle: el
  // bucle sólo se reinicia si cambian tipo, velocidad o colores (cfgKey).
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const cfgKey = `${cfg.type}|${cfg.speed}|${cfg.colors.join(",")}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;

    // Región libre para picos/barras/orbe: desde el lado de la palabra hasta
    // el borde derecho de la pantalla (se recalcula: la palabra cambia con el
    // estado: PLAY. → PAUSE. → START.).
    const freeRegion = () => {
      const target = avoid?.current;
      if (!target) return undefined;
      const type = cfgRef.current.type;
      if (type !== "peaks" && type !== "bars" && type !== "disco") return undefined;
      const cr = canvas.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      const x0 = tr.right - cr.left + 12;
      const w = window.innerWidth - tr.right - 12;
      return w >= 40 ? { x0, w } : undefined;
    };

    const frame = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      t += 0.035;
      drawWave({
        ctx,
        w,
        h,
        cfg: cfgRef.current,
        analyser: engine?.current.analyser ?? null,
        t,
        playing,
        region: freeRegion(),
      });
    };

    if (reduce) {
      // Sin animación continua: un solo trazo estático (respeta la preferencia).
      frame();
      window.addEventListener("resize", frame);
      return () => window.removeEventListener("resize", frame);
    }

    const loop = () => {
      frame();
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [engine, playing, cfgKey]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
