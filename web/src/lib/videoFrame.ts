// Grabs a single frame from an uploaded video file, entirely in the browser -
// used as the reference photo for Kling Avatar / Veo image-to-video when a
// user uploads a video instead of a still photo, the same trick this
// project's own research proved out for character consistency (extracting a
// frame from one generation to seed the next). No server-side video
// processing needed for this step.
export function extractVideoFrame(file: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    function cleanup() {
      URL.revokeObjectURL(url);
      video.remove();
    }

    video.onloadeddata = () => {
      // A fraction of a second in, not frame 0 - some encoders leave the
      // very first frame black/blank before real content starts.
      video.currentTime = Math.min(0.3, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        reject(new Error("Could not read a frame from that video"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (blob) resolve(blob);
          else reject(new Error("Could not read a frame from that video"));
        },
        "image/jpeg",
        0.92,
      );
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Could not read that video file"));
    };
  });
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/");
}
