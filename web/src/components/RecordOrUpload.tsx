"use client";

import { useEffect, useRef } from "react";
import { useMediaRecorder } from "@/lib/useMediaRecorder";
import { CloseIcon, MicIcon, StopIcon, UploadIcon, VideoIcon } from "./Icons";

type Props = {
  kind: "audio" | "video";
  onChange: (file: Blob | File | null) => void;
};

const ACCENT: Record<Props["kind"], string> = {
  audio: "bg-rose text-white",
  video: "bg-lavender text-white",
};

export function RecordOrUpload({ kind, onChange }: Props) {
  const { recording, blob, previewUrl, liveStream, error, start, stop, reset } =
    useMediaRecorder(kind);
  const liveVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (liveVideoRef.current) liveVideoRef.current.srcObject = liveStream;
  }, [liveStream]);

  useEffect(() => {
    onChange(blob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    reset();
    onChange(file);
  }

  function handleClear() {
    reset();
    onChange(null);
  }

  const RecordIcon = kind === "audio" ? MicIcon : VideoIcon;

  if (previewUrl) {
    return (
      <div className="rounded-2xl border border-border bg-white/60 p-3">
        {kind === "video" ? (
          <video className="w-full rounded-xl" src={previewUrl} controls />
        ) : (
          <audio className="w-full" src={previewUrl} controls />
        )}
        <button
          onClick={handleClear}
          className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-foreground"
        >
          <CloseIcon className="h-3.5 w-3.5" /> Clear and try again
        </button>
      </div>
    );
  }

  if (recording && kind === "video") {
    return (
      <div className="rounded-2xl border border-border bg-white/60 p-3">
        <video ref={liveVideoRef} autoPlay muted className="w-full rounded-xl" />
        <button
          onClick={stop}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-coral py-2.5 text-sm font-semibold text-white"
        >
          <StopIcon className="h-4 w-4" /> Stop recording
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        <button
          onClick={recording ? stop : start}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition ${
            recording ? "bg-coral text-white" : `${ACCENT[kind]} opacity-90 hover:opacity-100`
          }`}
        >
          {recording ? (
            <>
              <StopIcon className="h-4 w-4" /> Stop
            </>
          ) : (
            <>
              <RecordIcon className="h-4 w-4" />
              {kind === "audio" ? "Record audio" : "Open camera"}
            </>
          )}
        </button>

        <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border border-border bg-white py-3 text-sm font-semibold text-foreground hover:bg-white/70">
          <UploadIcon className="h-4 w-4" />
          Upload
          <input
            type="file"
            accept={kind === "audio" ? "audio/*" : "video/*"}
            className="hidden"
            onChange={handleUpload}
          />
        </label>
      </div>
      {error && <p className="text-xs text-coral-dark">{error}</p>}
    </div>
  );
}
