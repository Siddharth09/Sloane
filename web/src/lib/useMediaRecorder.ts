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

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const mimeType = kind === "video" ? "video/webm" : "audio/webm";
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
