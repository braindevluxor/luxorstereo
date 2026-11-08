"use client";

// Carrusel compartido: índice de la lámina visible, avanzando cada `ms`.
// Lo usan el reproductor (fondo) y la vista previa de «Personalización».

import { useEffect, useState } from "react";

/** Cadencia de cambio de imagen en el reproductor. */
export const SLIDE_MS = 3500;

export function useSlideIndex(count: number, ms: number = SLIDE_MS): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    // Sin carrusel (0 o 1 lámina) o con «reducir movimiento»: queda fija.
    if (count < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), ms);
    return () => clearInterval(id);
  }, [count, ms]);

  return index;
}
