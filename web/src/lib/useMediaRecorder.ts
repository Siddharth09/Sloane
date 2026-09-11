"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Records audio (mic) or video (webcam + mic) in-browser via MediaRecorder.
 * Produces a Blob + object URL for preview/playback once stopped.
 */
export function useMediaRecorder(kind: "audio" | "video") {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const constraints: MediaStreamConstraints =
        kind === "video" ? { audio: true, video: { facingMode: "user" } } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      chunksRef.current = [];
      setLiveStream(stream);

      // Safari (iOS/macOS) only supports "audio/mp4"/"video/mp4" for
      // MediaRecorder, not webm - picking a type it doesn't support throws,
      // and letting it default silently produces mp4 bytes. Ask for the
      // first type the browser actually supports so recorder.mimeType
      // (read below) reliably reflects the real encoding.
      const candidates =
        kind === "video"
          ? ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"]
          : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const supportedType = candidates.find(
        (t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t)
      );
      const recorder = supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // Label the Blob with whatever MediaRecorder actually used
        // (recorder.mimeType), not a hardcoded guess - a mismatched label
        // is exactly why Safari recordings show "Error" instead of
        // playing back: the bytes are mp4 but were being tagged webm.
        const mimeType = recorder.mimeType || (kind === "video" ? "video/webm" : "audio/webm");
        const outBlob = new Blob(chunksRef.current, { type: mimeType });
        setBlob(outBlob);
        setPreviewUrl(URL.createObjectURL(outBlob));
        stream.getTracks().forEach((t) => t.stop());
        setLiveStream(null);
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Couldn't access your microphone/camera — check permissions.");
    }
  }, [kind]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  const reset = useCallback(() => {
    setBlob(null);
    setPreviewUrl(null);
    setError(null);
  }, []);

  return { recording, blob, previewUrl, liveStream, error, start, stop, reset };
}
