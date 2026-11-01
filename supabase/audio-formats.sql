-- =============================================================================
--  LuxorStereo · Formatos de audio admitidos en la librería
--  Ejecutar una sola vez en:  Supabase Dashboard -> SQL Editor -> New query
--
--  Amplía los MIME permitidos del bucket "audio" para incluir la familia
--  MPEG (.mp2/.mpg/.mpeg de audio, que el navegador suele reportar como
--  "video/mpeg") y alias habituales. El límite de 100 MB por archivo se
--  mantiene. La validación de que el navegador realmente puede reproducirlo
--  la hace el panel antes de subir (lee la duración con un <audio>).
-- =============================================================================

update storage.buckets
   set allowed_mime_types = array[
         'audio/mpeg',   -- .mp3 / .mpga / audio MPEG
         'audio/mp3',
         'audio/mp2',    -- MPEG-1 Audio Layer II (radio)
         'audio/mpeg2',
         'audio/x-mpeg',
         'video/mpeg',   -- .mpg/.mpeg (el contenido suele ser audio MPEG)
         'audio/wav',
         'audio/x-wav',
         'audio/wave',
         'audio/vnd.wave',
         'audio/mp4',    -- .m4a
         'audio/m4a',
         'audio/aac',
         'audio/ogg',
         'audio/opus',
         'audio/flac',
         'audio/x-flac',
         'audio/aiff',
         'audio/x-aiff',
         'audio/webm'
       ]
 where id = 'audio';
