// Thin client for the Modal deployment (scripts/modal_app.py) - mirrors
// @/lib/runpod.ts's submit-then-poll shape as closely as possible so
// job-status/route.ts only needs a small backend-dispatch branch, not a
// rewrite. Server-only: never import this from a client component.
//
// Modal's web endpoints don't share one base URL the way RunPod's
// /v2/{endpointId}/{run,status} do - each @modal.fastapi_endpoint function
// gets its own subdomain, so submit and status are two separate URLs (see
// STATUS.md "Modal migration" for how to find them after `modal deploy`).
const MODAL_SUBMIT_URL = process.env.MODAL_SUBMIT_URL!;
const MODAL_STATUS_URL = process.env.MODAL_STATUS_URL!;

export type ModalStatusResponse = {
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  output?: Record<string, unknown>;
  error?: string;
};

export async function submitModalJob(input: Record<string, unknown>): Promise<{ jobId: string }> {
  const res = await fetch(MODAL_SUBMIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok || !data.call_id) {
    throw new Error(data.error ?? `Modal job submission failed (${res.status})`);
  }
  // Prefixed so job-status/route.ts can tell a Modal call_id apart from a
  // RunPod job id at poll time without a separate "which backend" lookup -
  // RunPod's own ids never contain a colon.
  return { jobId: `modal:${data.call_id as string}` };
}

export async function getModalJobStatus(callId: string): Promise<ModalStatusResponse> {
  const res = await fetch(`${MODAL_STATUS_URL}?call_id=${encodeURIComponent(callId)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `Modal status check failed (${res.status})`);
  }
  return data as ModalStatusResponse;
}

// Fire-and-forget: called the moment someone opens the generation page,
// well before they've finished typing and hit Generate for real, so the
// container is often already warm by the time a real request comes in -
// see scripts/modal_app.py's warmup() for why this doesn't burn GPU time
// synthesizing audio nobody asked for. Never throws - a failed warm-up
// ping should never be visible to the user, worst case they just hit the
// normal cold-start path.
export async function warmModal(): Promise<void> {
  try {
    await fetch(MODAL_SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "warmup" }),
    });
  } catch {
    // Best-effort only.
  }
}
