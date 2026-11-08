"use client";

// Personalización global de todos los reproductores de sucursal.
// Dos ajustes en station_settings (los lee el reproductor por RPC):
//  · player_background_slides → carrusel de imágenes de fondo.
//  · player_wave → tipo, colores y velocidad de la onda de sonido.

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AudioWaveform,
  BarChart3,
  Check,
  CircleDot,
  Images,
  TriangleAlert,
  Trash2,
  Upload,
  Waves,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import WaveCanvas from "@/components/player/WaveCanvas";
import { useSlideIndex } from "@/components/useSlideIndex";
import {
  WAVE_DEFAULT,
  WAVE_PALETTES,
  WAVE_TYPES,
  parseWave,
  serializeWave,
  type WaveConfig,
  type WaveType,
} from "@/lib/waveform";
import {
  parseSlides,
  serializeSlides,
  type BackgroundSlide,
} from "@/lib/backgroundSlides";
import { Button, Card, ErrorNote, Spinner } from "@/components/ui";

const IMAGE_BUCKET = "images";
const SLIDES_KEY = "player_background_slides";
const WAVE_KEY = "player_wave";
// Imagen única anterior: sólo se lee para migrarla al carrusel la primera vez.
const LEGACY_KEY = "player_background";
const LEGACY_PATH_KEY = "player_background_path";
const MAX_BYTES = 5_000_000;
const SLIDES_LIMIT = 8;

const TYPE_ICON: Record<WaveType, typeof Waves> = {
  waves: AudioWaveform,
  curves: Waves,
  peaks: Activity,
  bars: BarChart3,
  disco: CircleDot,
};

function sameColors(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

function speedLabel(speed: number): string {
  if (speed <= 0.25) return "Lenta";
  if (speed >= 0.75) return "Rápida";
  return "Media";
}

// La pantalla a cubrir es 1920×1080 (y 2× en Retina/4K): por encima de este
// factor la imagen se amplía y se ve pixelada.
const COVER_W = 1920;
const COVER_H = 1080;
const MAX_SCALE = 1.15;

/** Veces que hay que ampliar la imagen para cubrir 1920×1080 con `bg-cover`. */
function coverScale(w: number, h: number): number {
  return Math.max(COVER_W / w, COVER_H / h);
}

function measureUrl(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export default function PersonalizacionPage() {
  const [slides, setSlides] = useState<BackgroundSlide[] | null>(null);
  // Dimensiones reales de cada lámina (se miden al cargar): si amplían más de
  // MAX_SCALE veces, la imagen se verá pixelada en pantalla completa.
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({});
  const [wave, setWave] = useState<WaveConfig>(WAVE_DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waveStatus, setWaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Cambio hecho por el usuario (no por la carga inicial): sin esto, la carga
  // sobrescribiría lo que se haya tocado antes de llegar los datos.
  const waveDirty = useRef(false);

  // ---------- carga ----------
  useEffect(() => {
    void (async () => {
      const { data, error: err } = await getSupabase()
        .from("station_settings")
        .select("key, value")
        .in("key", [SLIDES_KEY, WAVE_KEY, LEGACY_KEY, LEGACY_PATH_KEY]);
      if (err || !data) {
        if (err) {
          setError(
            `${err.message}. Ejecuta supabase/player-appearance.sql en el SQL Editor de Supabase.`,
          );
        }
        setSlides([]);
        return;
      }
      const map = new Map(data.map((r) => [r.key, r.value]));
      let list = parseSlides(map.get(SLIDES_KEY));
      const legacy = map.get(LEGACY_KEY);
      if (!list.length && legacy) {
        // Migración de la imagen única anterior al carrusel: se muestra igual
        // aunque falle el guardado (así el panel y el reproductor ven lo mismo).
        list = [{ url: legacy, path: map.get(LEGACY_PATH_KEY) ?? null }];
        const supabase = getSupabase();
        const { error: migErr } = await supabase
          .from("station_settings")
          .upsert([{ key: SLIDES_KEY, value: serializeSlides(list) }]);
        if (!migErr) {
          await supabase
            .from("station_settings")
            .delete()
            .in("key", [LEGACY_KEY, LEGACY_PATH_KEY]);
        }
      }
      setSlides(list);
      if (!waveDirty.current) setWave(parseWave(map.get(WAVE_KEY)) ?? WAVE_DEFAULT);
    })();
  }, []);

  // ---------- medición de las imágenes (nitidez) ----------
  useEffect(() => {
    if (!slides?.length) return;
    let vivo = true;
    void (async () => {
      for (const s of slides) {
        if (dims[s.url]) continue;
        const d = await measureUrl(s.url);
        if (!vivo || !d) continue;
        setDims((prev) => (prev[s.url] ? prev : { ...prev, [s.url]: d }));
      }
    })();
    return () => {
      vivo = false;
    };
    // dims no entra a propósito: se evita re-medir lo ya medido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides]);

  // ---------- guardado automático de la onda (700 ms de calma) ----------
  useEffect(() => {
    if (!waveDirty.current) return;
    setWaveStatus("saving");
    const id = setTimeout(async () => {
      const { error: err } = await getSupabase()
        .from("station_settings")
        .upsert([{ key: WAVE_KEY, value: serializeWave(wave) }]);
      if (err) {
        setWaveStatus("error");
        setError(
          `${err.message}. Ejecuta supabase/player-appearance.sql en el SQL Editor de Supabase.`,
        );
      } else {
        setWaveStatus("saved");
      }
    }, 700);
    return () => clearTimeout(id);
  }, [wave]);

  function updateWave(patch: Partial<WaveConfig>) {
    waveDirty.current = true;
    setWaveStatus("idle");
    setWave((w) => ({ ...w, ...patch }));
  }

  // ---------- fondo ----------
  async function saveSlides(list: BackgroundSlide[]): Promise<boolean> {
    const { error: err } = await getSupabase()
      .from("station_settings")
      .upsert([{ key: SLIDES_KEY, value: serializeSlides(list) }]);
    if (err) {
      setError(
        `${err.message}. Ejecuta supabase/player-appearance.sql en el SQL Editor de Supabase.`,
      );
      return false;
    }
    return true;
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    const current = slides ?? [];
    if (current.length + files.length > SLIDES_LIMIT) {
      setError(`El carrusel admite como máximo ${SLIDES_LIMIT} imágenes.`);
      return;
    }
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setError(`"${file.name}" no es una imagen: usa JPG, PNG o WebP.`);
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" supera los 5 MB.`);
        return;
      }
    }

    setBusy(true);
    setError(null);
    const supabase = getSupabase();
    const added: BackgroundSlide[] = [];

    for (const file of files) {
      const ext =
        (file.name.includes(".") ? file.name.split(".").pop() : "jpg")!
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `player-bg/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setError(
          upErr.message.includes(IMAGE_BUCKET)
            ? `${upErr.message}. Ejecuta supabase/player-appearance.sql en el SQL Editor de Supabase.`
            : upErr.message,
        );
        break;
      }
      const { data: pub } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      added.push({ url: pub.publicUrl, path });
    }

    if (added.length) {
      // Se guarda primero la lista: si falla, las imágenes recién subidas se
      // borran del bucket para no dejar huérfanos.
      const next = [...current, ...added];
      if (await saveSlides(next)) {
        setSlides(next);
      } else {
        await supabase.storage
          .from(IMAGE_BUCKET)
          .remove(added.map((a) => a.path).filter((p): p is string => !!p));
      }
    }
    setBusy(false);
  }

  async function removeSlide(index: number) {
    const current = slides ?? [];
    const target = current[index];
    const next = current.filter((_, i) => i !== index);
    setBusy(true);
    setError(null);
    // Primero la lista (el reproductor deja de usarla) y después el archivo:
    // nunca al revés, para no romper lo que aún se está mostrando.
    if (await saveSlides(next)) {
      setSlides(next);
      if (target.path) {
        await getSupabase().storage.from(IMAGE_BUCKET).remove([target.path]);
      }
    }
    setBusy(false);
  }

  async function clearSlides() {
    const current = slides ?? [];
    setBusy(true);
    setError(null);
    if (await saveSlides([])) {
      setSlides([]);
      const paths = current
        .map((s) => s.path)
        .filter((p): p is string => !!p);
      if (paths.length) await getSupabase().storage.from(IMAGE_BUCKET).remove(paths);
    }
    setBusy(false);
  }

  // ---------- vista previa del carrusel ----------
  const layers = slides?.map((s) => s.url) ?? [];
  const slideIndex = useSlideIndex(layers.length);
  const activeSlide = layers.length > 0 ? Math.min(slideIndex, layers.length - 1) : -1;

  // Láminas que habría que ampliar demasiado (se verían pixeladas).
  const bajos = (slides ?? []).filter((s) => {
    const d = dims[s.url];
    return d && coverScale(d.w, d.h) > MAX_SCALE;
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Personalización</h1>
        <p className="text-sm text-slate-500">
          Fondo y onda de sonido de todos los reproductores de sucursal.
        </p>
      </header>

      <ErrorNote message={error} />

      {/* ---------------- Fondo con carrusel ---------------- */}
      <Card
        title="Fondo del reproductor"
        description="Carrusel de imágenes: cada sucursal alterna una cada 3,5 segundos."
      >
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* Vista previa */}
          <div>
            <div
              className="relative aspect-video overflow-hidden rounded-xl border border-slate-700 bg-slate-950"
              role="img"
              aria-label="Vista previa del fondo del reproductor"
            >
              {layers.length === 0 ? (
                <p className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-400">
                  Sin imagen · degradado por defecto
                </p>
              ) : (
                layers.map((url, i) => (
                  <div
                    key={`${i}:${url}`}
                    className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000"
                    style={{
                      backgroundImage: `url("${url}")`,
                      opacity: i === activeSlide ? 1 : 0,
                    }}
                  />
                ))
              )}
              {layers.length > 1 && (
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
                  {layers.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-1.5 rounded-full transition ${
                        i === activeSlide ? "bg-white" : "bg-white/40"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {layers.length > 1
                ? "Vista previa del carrusel en marcha."
                : "Los reproductores la toman en ~1 minuto."}
            </p>
          </div>

          {/* Controles */}
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void upload(e)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-1.5"
              >
                <Upload size={14} />
                {busy ? "Guardando…" : "Añadir imágenes"}
              </Button>
              {(slides?.length ?? 0) > 0 && (
                <Button variant="ghost" onClick={() => void clearSlides()} disabled={busy}>
                  Quitar todas
                </Button>
              )}
              <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <Images size={14} />
                {slides?.length ?? 0}/{SLIDES_LIMIT}
              </span>
            </div>

            <p className="text-xs text-slate-500">
              Para que se vean nítidas, usa imágenes de{" "}
              <strong className="font-bold text-slate-700">1920×1080 px o más</strong>{" "}
              (proporción 16:9). Las pequeñas se amplían y se ven pixeladas.
            </p>

            {bajos.length > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                <TriangleAlert size={14} className="mt-px shrink-0" />
                <span>
                  {bajos.length === 1
                    ? "1 imagen se amplía"
                    : `${bajos.length} imágenes se amplían`}{" "}
                  para cubrir la pantalla y{" "}
                  {bajos.length === 1 ? "se verá pixelada" : "se verán pixeladas"}
                  . Sustitúyela{bajos.length === 1 ? "" : "s"} por otras de 1920×1080
                  o más.
                </span>
              </p>
            )}

            {slides === null ? (
              <Spinner />
            ) : slides.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                Sin imágenes: el reproductor muestra el degradado corporativo.
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {slides.map((s, i) => {
                  const d = dims[s.url];
                  const malo = d ? coverScale(d.w, d.h) > MAX_SCALE : false;
                  return (
                    <li
                      key={s.url}
                      className="group relative aspect-video overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                    >
                      <img
                        src={s.url}
                        alt={`Fondo ${i + 1}`}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-px text-[10px] font-black text-white">
                        {i + 1}
                      </span>
                      {d && (
                        <span
                          title={
                            malo
                              ? `Se amplía ${coverScale(d.w, d.h).toFixed(1)}×: se verá pixelada`
                              : "Tamaño real"
                          }
                          className={`absolute bottom-1 left-1 rounded px-1 py-px text-[10px] font-black ${
                            malo
                              ? "bg-amber-500 text-black"
                              : "bg-black/60 text-white"
                          }`}
                        >
                          {d.w}×{d.h}
                        </span>
                      )}
                      <button
                        onClick={() => void removeSlide(i)}
                        disabled={busy}
                        title="Quitar del carrusel"
                        aria-label={`Quitar la imagen ${i + 1} del carrusel`}
                        className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition hover:bg-rose-600 focus:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="text-xs text-slate-500">
              JPG, PNG o WebP · máx. 5 MB por imagen · {SLIDES_LIMIT} en total. El
              orden es el de la lista.
            </p>          </div>
        </div>
      </Card>

      {/* ---------------- Onda de sonido ---------------- */}
      <Card
        title="Onda de sonido"
        description="Se dibuja sobre la palabra del héroe de cada reproductor."
        action={
          <span className="flex items-center gap-1.5 text-xs font-semibold">
            {waveStatus === "saving" && <span className="text-slate-500">Guardando…</span>}
            {waveStatus === "saved" && (
              <span className="flex items-center gap-1 text-emerald-600">
                <Check size={14} /> Guardado
              </span>
            )}
            {waveStatus === "error" && (
              <span className="text-rose-600">No se pudo guardar</span>
            )}
          </span>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {/* Tipo */}
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
                Tipo de animación
              </p>
              <div className="flex flex-wrap gap-2">
                {WAVE_TYPES.map((t) => {
                  const Icon = TYPE_ICON[t.id];
                  const on = wave.type === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => updateWave({ type: t.id })}
                      aria-pressed={on}
                      className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                        on
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600"
                      }`}
                    >
                      <Icon size={15} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Colores */}
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
                Colores
              </p>
              <div className="flex flex-wrap gap-2">
                {WAVE_PALETTES.map((p) => {
                  const on = sameColors(wave.colors, p.colors);
                  return (
                    <button
                      key={p.id}
                      onClick={() => updateWave({ colors: [...p.colors] })}
                      aria-pressed={on}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${
                        on
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600"
                      }`}
                    >
                      <span
                        className="h-3 w-8 rounded-full ring-1 ring-black/10"
                        style={{ backgroundImage: `linear-gradient(90deg, ${p.colors.join(",")})` }}
                      />
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">A medida:</span>
                {wave.colors.map((c, i) => (
                  <input
                    key={i}
                    type="color"
                    value={c}
                    onChange={(e) =>
                      updateWave({
                        colors: wave.colors.map((x, j) => (j === i ? e.target.value : x)),
                      })
                    }
                    aria-label={`Color ${i + 1} de la onda`}
                    className="h-8 w-8 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5"
                  />
                ))}
                <span className="text-xs text-slate-400">{wave.colors.length} colores</span>
              </div>
            </div>

            {/* Velocidad */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Velocidad
                </p>
                <span className="text-xs font-bold text-blue-600">
                  {speedLabel(wave.speed)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={wave.speed}
                onChange={(e) => updateWave({ speed: Number(e.target.value) })}
                aria-label="Velocidad de la onda"
                className="w-full accent-blue-600"
              />
            </div>

            {/* Visible */}
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={wave.visible}
                onChange={(e) => updateWave({ visible: e.target.checked })}
                className="h-4 w-4 accent-blue-600"
              />
              Mostrar la onda en los reproductores
            </label>
          </div>

          {/* Vista previa */}
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
              Vista previa
            </p>
            <div className="h-40 overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
              {wave.visible ? (
                <WaveCanvas cfg={wave} playing className="h-full w-full" />
              ) : (
                <p className="flex h-full items-center justify-center text-sm text-slate-500">
                  Onda oculta
                </p>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Los reproductores la actualizan en ~1 minuto.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
