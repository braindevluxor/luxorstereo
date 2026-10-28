// Tipos de dominio compartidos por el panel de administración y el reproductor.
// El cliente de Supabase se crea sin genéricos (sin código generado a mano):
// estas interfaces son la fuente de verdad de cada fila/respuesta.

export type TrackType = "music" | "commercial";

export interface Branch {
  id: string;
  name: string;
  city: string | null;
  timezone: string;
  active: boolean;
  last_ping: string | null;
  branch_key: string;
  created_at: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string | null;
  duration: number;
  file_url: string;
  storage_path: string | null;
  type: TrackType;
  created_at: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface PlaylistTrack {
  id: string;
  playlist_id: string;
  track_id: string;
  position: number;
}

export interface ScheduleWindow {
  from: string; // "HH:MM" hora local de la sucursal
  to: string; //   "HH:MM"
}

export interface ScheduleRules {
  window?: ScheduleWindow | null;
  commercialEveryNTracks?: number | null;
  commercialEveryMinutes?: number | null;
  shuffle?: boolean;
}

export interface BranchPlaylist {
  id: string;
  branch_id: string;
  playlist_id: string;
  schedule_rules: ScheduleRules;
  active: boolean;
  created_at: string;
}

export interface StationLog {
  id: string;
  branch_id: string;
  track_id: string | null;
  played_at: string;
}

/** Payload de pista tal como lo devuelve get_branch_broadcast(). */
export interface BroadcastTrack {
  id: string;
  title: string;
  artist: string | null;
  duration: number;
  file_url: string;
  type: TrackType;
  position?: number;
}

export interface BroadcastAssignment {
  id: string;
  playlist_id: string;
  playlist_name: string;
  schedule_rules: ScheduleRules;
  tracks: BroadcastTrack[];
}

export interface BranchBroadcast {
  branch: {
    id: string;
    name: string;
    city: string | null;
    timezone: string;
    active: boolean;
  };
  assignments: BroadcastAssignment[];
  commercials: BroadcastTrack[];
  server_time: string;
}

export interface AlertPayload {
  id: string;
  title: string;
  message: string;
  audio_url?: string | null;
  sent_at: string;
}
