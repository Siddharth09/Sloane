// Thin client for RunPod's Serverless job API - submit a job, poll its
// status. Replaces the old direct fetch-to-Pod pattern now that audio
// generation runs on a scale-to-zero Serverless endpoint instead of an
// always-on Pod (see STATUS.md "Serverless migration"). Server-only: never
// import this from a client component, RUNPOD_API_KEY must never reach the
// browser.
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY!;
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID!;
const BASE_URL = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;

export type RunpodJobStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export type RunpodStatusResponse = {
  id: string;
  status: RunpodJobStatus;
  output?: Record<string, unknown>;
  error?: string;
};

export async function submitJob(input: Record<string, unknown>): Promise<{ jobId: string }> {
  const res = await fetch(`${BASE_URL}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RUNPOD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(data.error ?? `RunPod job submission failed (${res.status})`);
  }
  return { jobId: data.id as string };
}

export async function getJobStatus(jobId: string): Promise<RunpodStatusResponse> {
  const res = await fetch(`${BASE_URL}/status/${jobId}`, {
    headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `RunPod status check failed (${res.status})`);
  }
  return data as RunpodStatusResponse;
}
