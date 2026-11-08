// =============================================================================
//  LuxorStereo · Onda de sonido del reproductor
//
//  Un único dibujo compartido por dos pantallas:
//   · El reproductor de sucursal, con los datos reales del AnalyserNode.
//   · La vista previa de «Personalización» en el panel (sin audio: dibuja un
//     espectro decorativo para que se vea el estilo elegido).
//
//  La configuración viaja a las sucursales en station_settings.player_wave
//  (JSON) y se guarda con serializeWave().
// =============================================================================

export type WaveType = "waves" | "curves" | "peaks" | "bars" | "disco";

export interface WaveConfig {
  /** Dibujar la onda sobre la palabra del héroe. */
  visible: boolean;
  type: WaveType;
  /** 0 (lenta) … 1 (rápida): ciclo de colores y rotación. */
  speed: number;
  /** Paleta recorrida por la onda (hex de 6 dígitos). */
  colors: string[];
}

export const WAVE_TYPES: { id: WaveType; label: string }[] = [
  { id: "waves", label: "Ondas" },
  { id: "curves", label: "Curvas" },
  { id: "peaks", label: "Picos" },
  { id: "bars", label: "Barras" },
  { id: "disco", label: "Orbe" },
];

export const WAVE_PALETTES: { id: string; label: string; colors: string[] }[] = [
  {
    id: "arcoiris",
    label: "Arcoíris",
    colors: ["#22d3ee", "#3b82f6", "#a855f7", "#f43f5e", "#f59e0b", "#4ade80"],
  },
  { id: "cian", label: "Cian", colors: ["#a5f3fc", "#22d3ee", "#0891b2", "#67e8f9"] },
  { id: "verde", label: "Verde", colors: ["#bbf7d0", "#22c55e", "#15803d", "#86efac"] },
  { id: "rosa", label: "Rosa", colors: ["#fecdd3", "#f43f5e", "#db2777", "#fda4af"] },
  { id: "ambar", label: "Ámbar", colors: ["#fef3c7", "#f59e0b", "#b45309", "#fde68a"] },
  { id: "blanco", label: "Blanco", colors: ["#f8fafc", "#cbd5e1", "#94a3b8", "#e2e8f0"] },
];

export const WAVE_DEFAULT: WaveConfig = {
  visible: true,
  type: "waves",
  speed: 0.5,
  colors: [...WAVE_PALETTES[0].colors],
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Lee la onda guardada; JSON ausente o corrupto → null (se usa el valor por defecto). */
export function parseWave(json: string | null | undefined): WaveConfig | null {
  if (!json) return null;
  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const rec = raw as Record<string, unknown>;
    const colors = Array.isArray(rec.colors)
      ? rec.colors.filter((c): c is string => typeof c === "string" && HEX.test(c))
      : [];
    return {
      visible: typeof rec.visible === "boolean" ? rec.visible : WAVE_DEFAULT.visible,
      type: WAVE_TYPES.some((t) => t.id === rec.type)
        ? (rec.type as WaveType)
        : WAVE_DEFAULT.type,
      speed:
        typeof rec.speed === "number" && Number.isFinite(rec.speed)
          ? Math.min(1, Math.max(0, rec.speed))
          : WAVE_DEFAULT.speed,
      colors: colors.length >= 2 ? colors : [...WAVE_DEFAULT.colors],
    };
  } catch {
    return null;
  }
}

export function serializeWave(cfg: WaveConfig): string {
  return JSON.stringify({
    visible: cfg.visible,
    type: cfg.type,
    speed: cfg.speed,
    colors: cfg.colors,
  });
}

// --------------------------------------------------------------- dibujo ----

/** Bandas de espectro (resolución de barras, picos, curvas y orbe). */
const BANDS = 64;
/** Fragmento útil del espectro: los agudos casi no aportan energía. */
const USABLE_BINS = 320;

// Puffers reutilizados en cada cuadro (el dibujo es síncrono: no se solapan).
const bands = new Uint8Array(BANDS);
const xs = new Float32Array(BANDS);
const ys = new Float32Array(BANDS);
let freqScratch = new Uint8Array(0);
let waveScratch = new Uint8Array(0);

export interface WaveFrame {
  ctx: CanvasRenderingContext2D;
  /** Tamaño lógico (CSS px) del lienzo. */
  w: number;
  h: number;
  cfg: WaveConfig;
  /** AnalyserNode en vivo; null = sin audio (vista previa o en pausa). */
  analyser: AnalyserNode | null;
  /** Fase de animación: crece con el tiempo. */
  t: number;
  /** true = amplitud completa; false = onda suave de espera. */
  playing: boolean;
  /**
   * Región libre en la que dibujan picos, barras y orbe (desde `x0`, con
   * `w` de ancho). Sirve para que no se dibujen detrás de la palabra del
   * héroe: llegan hasta el lado del texto. Sin región → todo el lienzo.
   */
  region?: { x0: number; w: number };
}

export function drawWave({
  ctx,
  w,
  h,
  cfg,
  analyser,
  t,
  playing,
  region,
}: WaveFrame): void {
  const colors = cfg.colors.length >= 2 ? cfg.colors : WAVE_DEFAULT.colors;
  const env = playing ? 1 : 0.25;
  const live = playing && analyser !== null;
  const speed = Math.min(1, Math.max(0, cfg.speed));
  // Posición de la paleta: con el tiempo los colores «fluyen» por la onda.
  const shift = (t * (0.03 + speed * 0.12)) % 1;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowBlur = 0;

  if (cfg.type === "waves" || cfg.type === "curves") {
    // La línea sí atraviesa la palabra (como en la referencia).
    if (cfg.type === "waves") {
      drawOscilloscope(ctx, w, h, colors, shift, t, env, live ? analyser : null);
    } else {
      const data = live && analyser ? readBands(analyser) : synthBands(t, env);
      drawCurves(ctx, w, h, colors, shift, data, env);
    }
  } else {
    const data = live && analyser ? readBands(analyser) : synthBands(t, env);
    const rx = region && region.w > 0 ? region : { x0: 0, w };
    switch (cfg.type) {
      case "peaks":
        drawPeaks(ctx, rx.x0, rx.w, h, colors, shift, data, env);
        break;
      case "bars":
        drawBars(ctx, rx.x0, rx.w, h, colors, shift, data, env);
        break;
      default:
        drawOrbe(ctx, rx.x0, rx.w, h, colors, shift, data, env, t, speed);
    }
  }

  ctx.restore();
}

/** Degradado de la paleta, girado con `shift` para que el color avance. */
function palette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: string[],
  shift: number,
  vertical: boolean,
): CanvasGradient {
  const g = vertical
    ? ctx.createLinearGradient(0, 0, 0, h)
    : ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i < colors.length; i++) {
    const pos = (((i / colors.length) + shift) % 1 + 1) % 1;
    g.addColorStop(pos, colors[i]);
  }
  return g;
}

/** Índice de color desplazado (hace avanzar la paleta por las barras). */
function colorAt(colors: string[], shift: number, i: number): string {
  const off = Math.floor(shift * colors.length);
  return colors[(i + off) % colors.length];
}

/** Espectro real del AnalyserNode remuestreado a BANDS bandas. */
function readBands(analyser: AnalyserNode): Uint8Array {
  if (freqScratch.length !== analyser.frequencyBinCount) {
    freqScratch = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(freqScratch);
  const usable = Math.max(1, Math.min(freqScratch.length, USABLE_BINS));
  for (let i = 0; i < BANDS; i++) {
    const p = i / (BANDS - 1);
    const bin = Math.min(usable - 1, Math.round(Math.pow(p, 1.7) * (usable - 1)));
    bands[i] = freqScratch[bin];
  }
  return bands;
}

/** Espectro decorativo (sin audio): caída 1/f con pulsos, para la vista previa. */
function synthBands(t: number, env: number): Uint8Array {
  for (let i = 0; i < BANDS; i++) {
    const p = i / (BANDS - 1);
    const base = Math.pow(1 - p, 1.5);
    const pulse =
      0.55 + 0.45 * Math.sin(t * 3.2 + p * 9) * Math.cos(t * 1.7 - p * 4);
    bands[i] = Math.max(0, Math.min(255, Math.round(255 * base * pulse * env)));
  }
  return bands;
}

/** Onda tipo osciloscopio: la señal real del audio (o una onda decorativa). */
function drawOscilloscope(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: string[],
  shift: number,
  t: number,
  env: number,
  analyser: AnalyserNode | null,
): void {
  let wave: Uint8Array | null = null;
  if (analyser) {
    if (waveScratch.length !== analyser.fftSize) {
      waveScratch = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteTimeDomainData(waveScratch);
    wave = waveScratch;
  }

  const mid = h / 2;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const p = x / w;
    let y: number;
    if (wave) {
      const idx = Math.min(wave.length - 1, Math.round(p * (wave.length - 1)));
      y = mid + ((wave[idx] - 128) / 128) * (h * 0.46);
    } else {
      y = mid + Math.sin(p * 14 + t) * Math.sin(p * 3 - t * 0.7) * (h * 0.3) * env;
    }
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.strokeStyle = palette(ctx, w, h, colors, shift, false);
  ctx.lineWidth = 2.5;
  ctx.shadowColor = colorAt(colors, shift, 0);
  ctx.shadowBlur = 12;
  ctx.stroke();
}

/** Curva suave del espectro, con su reflejo debajo del eje. */
function drawCurves(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: string[],
  shift: number,
  data: Uint8Array,
  env: number,
): void {
  const mid = h / 2;
  const amp = h * 0.44;
  const step = w / (BANDS - 1);
  for (let i = 0; i < BANDS; i++) {
    xs[i] = i * step;
    ys[i] = mid - (data[i] / 255) * env * amp;
  }

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < BANDS - 1; i++) {
      ctx.quadraticCurveTo(
        xs[i],
        ys[i],
        (xs[i] + xs[i + 1]) / 2,
        (ys[i] + ys[i + 1]) / 2,
      );
    }
    ctx.lineTo(xs[BANDS - 1], ys[BANDS - 1]);
  };

  const grad = palette(ctx, w, h, colors, shift, false);

  // Reflejo (más tenue)
  ctx.save();
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < BANDS; i++) ys[i] = mid + (data[i] / 255) * env * amp;
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  path();
  ctx.stroke();
  ctx.restore();

  // Curva principal
  for (let i = 0; i < BANDS; i++) ys[i] = mid - (data[i] / 255) * env * amp;
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3;
  ctx.shadowColor = colorAt(colors, shift, 0);
  ctx.shadowBlur = 14;
  path();
  ctx.stroke();
}

/** Picos verticales centrados en el eje (medidor de espectro). */
function drawPeaks(
  ctx: CanvasRenderingContext2D,
  x0: number,
  rw: number,
  h: number,
  colors: string[],
  shift: number,
  data: Uint8Array,
  env: number,
): void {
  const mid = h / 2;
  const step = rw / BANDS;
  const lw = Math.max(2, step * 0.55);
  ctx.lineWidth = lw;
  for (let i = 0; i < BANDS; i++) {
    const x = x0 + i * step + step / 2;
    const half = Math.max(lw / 2, (data[i] / 255) * env * h * 0.45);
    ctx.strokeStyle = colorAt(colors, shift, i);
    ctx.beginPath();
    ctx.moveTo(x, mid - half);
    ctx.lineTo(x, mid + half);
    ctx.stroke();
  }
}

/** Barras verticales desde el borde inferior (ecualizador clásico). */
function drawBars(
  ctx: CanvasRenderingContext2D,
  x0: number,
  rw: number,
  h: number,
  colors: string[],
  shift: number,
  data: Uint8Array,
  env: number,
): void {
  const step = rw / BANDS;
  const bw = Math.max(2, step * 0.62);
  for (let i = 0; i < BANDS; i++) {
    const bh = Math.max(2, (data[i] / 255) * env * h * 0.92);
    ctx.fillStyle = colorAt(colors, shift, i);
    ctx.fillRect(x0 + i * step + (step - bw) / 2, h - bh, bw, bh);
  }
}

// --------------------------------------------------------------- orbe ----
// Esfera 3D de puntos inspirada en «3D audio sphere» de jeromepl
// (github.com/jeromepl/3D-audio-sphere): la esfera se genera con una
// discretización en espiral y cada punto se desplaza según su latitud —
// el ecuador reacciona a los graves y los polos a los agudos — mientras
// gira despacio. El repositorio original no trae licencia, así que aquí
// se reimplementa el concepto en canvas 2D (sin three.js), usando el
// mismo AnalyserNode y la paleta de la configuración.

/** Puntos de la esfera (unidad: radio 1, precalculado una sola vez). */
const ORBE_POINTS = 1200;
/** Vueltas alrededor del eje Y en la espiral (densidad del malla). */
const ORBE_TURNS = 55;
const orbeX = new Float32Array(ORBE_POINTS);
const orbeY = new Float32Array(ORBE_POINTS);
const orbeZ = new Float32Array(ORBE_POINTS);
/** |cos(phi)| de cada punto: 0 en el ecuador, 1 en los polos. */
const orbeLat = new Float32Array(ORBE_POINTS);
let orbeBuilt = false;

function buildOrbe(): void {
  if (orbeBuilt) return;
  for (let k = 0; k < ORBE_POINTS; k++) {
    const i = -1 + (2 * k) / (ORBE_POINTS - 1);
    const phi = Math.acos(i);
    const theta = (ORBE_TURNS * 2 * phi) % (Math.PI * 2);
    const sp = Math.sin(phi);
    orbeX[k] = Math.cos(theta) * sp;
    orbeY[k] = Math.cos(phi);
    orbeZ[k] = Math.sin(theta) * sp;
    orbeLat[k] = Math.abs(i);
  }
  orbeBuilt = true;
}

/** Punto redondo pre-renderizado por color (más rápido y más suave que un
 *  rectángulo o un `arc()` por partícula): gradiente radial con núcleo
 *  sólido y borde difuso. Sólo puede haber los colores de la paleta. */
const orbeSprites = new Map<string, HTMLCanvasElement>();

function orbeSprite(color: string): HTMLCanvasElement {
  let sprite = orbeSprites.get(color);
  if (sprite) return sprite;
  sprite = document.createElement("canvas");
  sprite.width = 16;
  sprite.height = 16;
  const sc = sprite.getContext("2d");
  if (sc) {
    const g = sc.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, color);
    g.addColorStop(0.5, color);
    g.addColorStop(1, `${color}00`); // mismo tono con alfa 0 (evita borde oscuro)
    sc.fillStyle = g;
    sc.fillRect(0, 0, 16, 16);
  }
  orbeSprites.set(color, sprite);
  return sprite;
}

/** Esfera de espectro: graves en el ecuador, agudos en los polos. */
function drawOrbe(
  ctx: CanvasRenderingContext2D,
  x0: number,
  rw: number,
  h: number,
  colors: string[],
  shift: number,
  data: Uint8Array,
  env: number,
  t: number,
  speed: number,
): void {
  buildOrbe();
  const cx = x0 + rw / 2;
  const cy = h / 2;
  // Radio base: con el desplazamiento máximo (×1,8) y la perspectiva la
  // esfera cabe en la altura del lienzo (tope real: 1,89 radios).
  const R = Math.min(rw, h) / 4;
  const rotY = t * (0.03 + speed * 0.12);
  const tiltX = -0.42; // vista ligeramente cenital, como la referencia
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(tiltX);
  const sinX = Math.sin(tiltX);
  const focal = 3.2; // distancia de la cámara, en radios
  const dot = Math.max(2, R * 0.1);

  ctx.save();
  // Brillo aditivo: los puntos superpuestos se iluminan entre sí.
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < ORBE_POINTS; k++) {
    // Latitud → banda del espectro (ecuador = banda 0, más grave).
    const bi = Math.round(orbeLat[k] * (BANDS - 1));
    // Desplazamiento radial: 1 … 1,8 radios según la energía de la banda:
    // con el sonido las partículas se abren bastante más que en reposo.
    const f = 1 + (data[bi] / 255) * env * 0.8;
    // Rotación sobre Y y luego inclinación sobre X.
    const x1 = orbeX[k] * cosY + orbeZ[k] * sinY;
    const z1 = -orbeX[k] * sinY + orbeZ[k] * cosY;
    const y2 = orbeY[k] * cosX - z1 * sinX;
    const z2 = orbeY[k] * sinX + z1 * cosX;
    // Perspectiva y profundidad: los puntos de atrás salen más tenues.
    const p = focal / (focal - z2);
    const s = dot * p;
    ctx.globalAlpha = 0.3 + 0.7 * ((z2 + 1) / 2);
    ctx.drawImage(
      orbeSprite(colorAt(colors, shift, bi)),
      cx + x1 * R * f * p - s / 2,
      cy + y2 * R * f * p - s / 2,
      s,
      s,
    );
  }
  ctx.restore();
}
