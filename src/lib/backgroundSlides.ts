// =============================================================================
//  LuxorStereo · Carrusel de fondo del reproductor
//
//  station_settings.player_background_slides guarda la lista de imágenes como
//  JSON: [{ "url": "…", "path": "…" }, …]
//
//   · El reproductor sólo necesita `url` (la pinta en orden y las alterna).
//   · El panel necesita `path` para borrar la imagen del bucket "images" cuando
//     se quita del carrusel.
//
//  station_settings.player_background / player_background_path (imagen única
//  anterior) siguen leyéndose como respaldo en el reproductor.
// =============================================================================

export interface BackgroundSlide {
  /** URL pública de la imagen. */
  url: string;
  /** Ruta en el bucket "images" (null si no se conoce: no se podrá borrar). */
  path: string | null;
}

/** JSON de láminas → lista válida; cualquier sorpresa → [] (nunca lanza). */
export function parseSlides(json: string | null | undefined): BackgroundSlide[] {
  if (!json) return [];
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    const out: BackgroundSlide[] = [];
    for (const item of raw) {
      if (typeof item === "string") {
        if (item) out.push({ url: item, path: null });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const rec = item as { url?: unknown; path?: unknown };
      if (typeof rec.url !== "string" || !rec.url) continue;
      out.push({
        url: rec.url,
        path: typeof rec.path === "string" && rec.path ? rec.path : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeSlides(list: BackgroundSlide[]): string {
  return JSON.stringify(list.map((s) => ({ url: s.url, path: s.path })));
}
