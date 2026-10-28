// Reglas de programación: funciones puras compartidas por el reproductor.
// Toda decisión de "qué suena ahora" se calcula aquí para que el motor de
// audio sólo tenga que reproducir la cola que se le entrega.

import type {
  BroadcastAssignment,
  BroadcastTrack,
  ScheduleRules,
} from "./types";

export const EMPTY_RULES: ScheduleRules = {
  window: null,
  commercialEveryNTracks: null,
  commercialEveryMinutes: null,
  shuffle: false,
};

/** Hora local de la sucursal en formato "HH:MM" (usa la zona horaria IANA). */
export function branchLocalTime(
  timeZone: string,
  now: Date = new Date(),
): { hhmm: string; minutes: number } {
  try {
    const hhmm = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
    return { hhmm, minutes: toMinutes(hhmm) };
  } catch {
    // Zona horaria inválida: cae a la hora del dispositivo.
    const hhmm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    return { hhmm, minutes: toMinutes(hhmm) };
  }
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

/** Ventana de programación; soporta rangos que cruzan la medianoche. */
export function isInsideWindow(
  nowMinutes: number,
  from: string,
  to: string,
): boolean {
  const start = toMinutes(from);
  const end = toMinutes(to);
  if (start < 0 || end < 0) return false;
  if (start === end) return true;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end; // cruza medianoche
}

/**
 * Asignación activa para este instante:
 *  1) la que su ventana contenga la hora local,
 *  2) en su defecto, la primera sin ventana (fallback),
 *  3) si no hay ninguna, null.
 */
export function pickAssignment(
  assignments: BroadcastAssignment[],
  nowMinutes: number,
): BroadcastAssignment | null {
  if (assignments.length === 0) return null;

  const withWindow = assignments.filter(
    (a) => !!a.schedule_rules?.window && a.tracks.length > 0,
  );
  const withoutWindow = assignments.filter(
    (a) => !a.schedule_rules?.window && a.tracks.length > 0,
  );

  const matching = withWindow.find((a) => {
    const w = a.schedule_rules.window!;
    return isInsideWindow(nowMinutes, w.from, w.to);
  });

  if (matching) return matching;

  return withoutWindow[0] ?? withWindow[0] ?? assignments[0];
}

/** Cola de música de una asignación (los spots se inyectan en tiempo real). */
export function buildQueue(assignment: BroadcastAssignment): BroadcastTrack[] {
  const music = assignment.tracks.filter((t) => t.type === "music");
  if (!assignment.schedule_rules?.shuffle) return music;

  const shuffled = [...music];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** ¿Toca insertar un spot publicitario ahora? */
export function spotRequired(
  rules: ScheduleRules | undefined,
  musicSinceSpot: number,
  msSinceSpot: number,
): boolean {
  if (!rules) return false;
  const everyN = rules.commercialEveryNTracks;
  const everyM = rules.commercialEveryMinutes;
  const byCount = Number.isFinite(everyN) && (everyN ?? 0) > 0 && musicSinceSpot >= (everyN as number);
  const byTime = Number.isFinite(everyM) && (everyM ?? 0) > 0 && msSinceSpot >= (everyM as number) * 60_000;
  return byCount || byTime;
}

/**
 * Siguiente spot en rotación: prefiere los comerciales incluidos en la propia
 * playlist y, si no tiene, recorre el pool global de la librería.
 */
export function pickCommercial(
  assignment: BroadcastAssignment | null,
  globalPool: BroadcastTrack[],
  cursor: number,
): BroadcastTrack | null {
  const local = assignment?.tracks.filter((t) => t.type === "commercial") ?? [];
  const pool = local.length > 0 ? local : globalPool;
  if (pool.length === 0) return null;
  return pool[cursor % pool.length];
}

/** Formato mm:ss para duraciones. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}
