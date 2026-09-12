// Real audio-duration detection and short-clip padding for pay-as-you-go's
// audio-driven video paths (2026-09-12) - added after real testing (the
// Harper product-ad round) found two genuine production-affecting bugs that
// this same pipeline is exposed to for any real customer:
// (1) rendering a fixed-length video regardless of how long the actual
//     audio is leaves a long tail of ungrounded, non-matching mouth
//     movement once the audio ends (proven bug, see videoPaygo.ts's
//     duration-matching comment on buildFalInput's callers);
// (2) Kling's lipsync endpoint hard-rejects any audio under 2 seconds
//     ("Audio duration is too short. Minimum is 2 seconds.") - hit for
//     real on a 1.05s TTS line, fixed there with ffmpeg silence-padding.
// Neither fix requires ffmpeg in production: `music-metadata` gives a real
// duration for any format a browser can produce or a user can upload
// (wav/mp3/webm/mp4/ogg - no native binaries, pure JS, safe on Vercel's
// serverless runtime), and every case THIS code controls the bytes for
// (Modal TTS output) is always WAV, so silence-padding is done directly
// with the `node-wav` decode/encode pair already a dependency for other
// reasons (see download-mp3/route.ts) rather than adding an ffmpeg
// dependency just for this.
import { parseBuffer } from "music-metadata";
import wav from "node-wav";

// Real floor confirmed against fal's own kling-video/lipsync/audio-to-video
// endpoint (2026-09-12): a 1.05s clip was rejected with "Audio duration is
// too short. Minimum is 2 seconds." - see fal.ts's LIPSYNC_ENDPOINT comment.
export const LIPSYNC_MIN_AUDIO_SECONDS = 2.0;

// Returns null (never throws) on anything unparseable - callers fall back to
// each engine's existing fixed default duration rather than blocking a
// generation over a duration probe that failed for an unrelated reason.
export async function probeAudioDurationSeconds(data: Buffer, mimeType: string): Promise<number | null> {
  try {
    const metadata = await parseBuffer(data, mimeType || undefined, { duration: true });
    const duration = metadata.format.duration;
    return typeof duration === "number" && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

// Pads a WAV buffer with trailing silence up to `minSeconds`, if it's
// shorter than that - a no-op (returns the original buffer) if it's already
// long enough or isn't valid WAV (callers only use this on our own Modal TTS
// output, which is always WAV, so the latter shouldn't happen in practice,
// but failing safe to "leave it alone" is better than throwing here and
// failing an otherwise-fine generation over a padding step).
export function padWavToMinDuration(data: Buffer, minSeconds: number): Buffer {
  try {
    const decoded = wav.decode(data);
    const currentSamples = decoded.channelData[0]?.length ?? 0;
    const minSamples = Math.ceil(minSeconds * decoded.sampleRate);
    if (currentSamples >= minSamples) return data;
    const channelData = decoded.channelData.map((channel) => {
      const padded = new Float32Array(minSamples);
      padded.set(channel);
      return padded;
    });
    return wav.encode(channelData, { sampleRate: decoded.sampleRate, float: false, bitDepth: 16 });
  } catch {
    return data;
  }
}
