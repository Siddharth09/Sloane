// Thin wrapper around fal.ai's REST queue API - submit a job, poll its
// status, fetch its result once done. Server-side only (uses FAL_KEY,
// never exposed to the client) - the video-generation scripts elsewhere in
// this repo use the Python fal_client SDK instead since they run outside
// Next.js; this is the equivalent for API routes.

const FAL_BASE = "https://queue.fal.run";

function falHeaders() {
  return {
    Authorization: `Key ${process.env.FAL_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function submitFalJob(endpoint: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${FAL_BASE}/${endpoint}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal submit failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.request_id as string;
}

export type FalJobStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export async function getFalJobStatus(endpoint: string, requestId: string): Promise<FalJobStatus> {
  const res = await fetch(`${FAL_BASE}/${endpoint}/requests/${requestId}/status`, {
    headers: falHeaders(),
  });
  if (!res.ok) return "FAILED";
  const data = await res.json();
  return (data.status as FalJobStatus) ?? "IN_PROGRESS";
}

// Result shape differs slightly per engine (all three so far return
// {video: {url}}), so this stays loosely typed and callers pull `.video.url`.
export async function getFalJobResult(endpoint: string, requestId: string): Promise<{ video?: { url: string } }> {
  const res = await fetch(`${FAL_BASE}/${endpoint}/requests/${requestId}`, {
    headers: falHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal result fetch failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Two-step upload to fal's own storage (verified working 2026-09-11 against
// the real REST API - the "storage_type=gcs" query param some docs mention
// returns "Invalid storage type" on this account; omit it entirely).
// Needed for the character-video Lucy-voice path: Kling Avatar's audio_url
// input needs a real hosted URL, and generated TTS audio only exists as
// in-memory bytes until uploaded somewhere fal can fetch it from.
export async function uploadBufferToFal(data: Buffer, contentType: string, fileName: string): Promise<string> {
  const initRes = await fetch("https://rest.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ file_name: fileName, content_type: contentType }),
  });
  if (!initRes.ok) {
    throw new Error(`fal storage initiate failed (${initRes.status}): ${(await initRes.text()).slice(0, 300)}`);
  }
  const { upload_url, file_url } = await initRes.json();
  const putRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(data),
  });
  if (!putRes.ok) {
    throw new Error(`fal storage upload failed (${putRes.status}): ${(await putRes.text()).slice(0, 300)}`);
  }
  return file_url as string;
}
