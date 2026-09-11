import { NextRequest, NextResponse } from "next/server";
import { getVideoPaygoJob, getCharacterVideoJob, getSubscriptionVideoJob } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// Streams a finished video back through our own domain with a real
// "download" disposition, instead of sending the user off to fal's raw CDN
// URL. Looks the video URL up from OUR OWN database by job id (never
// accepts an arbitrary URL from the client) specifically so this can't be
// used as an open proxy/SSRF vector - only URLs this server itself already
// wrote after a completed fal job ever get fetched here.
//
// Ownership check (real bug fixed here - this route previously had none at
// all, letting anyone who obtained a job's UUID download its video with no
// authentication): "paygo" jobs are owned by a signed-in cookie session
// (job.user_id); "character"/"custom"/"cinematic" jobs are owned by
// whoever holds the access_token that created them (job.access_token) -
// same two auth systems used by the rest of the app for these features.
type JobType = "paygo" | "character" | "custom" | "cinematic";

async function resolveVideoUrl(jobType: JobType, jobId: string, accessToken: string | null): Promise<string | null> {
  switch (jobType) {
    case "paygo": {
      const user = await getSessionUser();
      if (!user) return null;
      const job = await getVideoPaygoJob(jobId);
      if (!job || job.user_id !== user.id) return null;
      return job.status === "completed" ? job.video_url : null;
    }
    case "character": {
      const job = await getCharacterVideoJob(jobId);
      if (!job || job.access_token !== accessToken) return null;
      return job.status === "completed" ? job.video_url : null;
    }
    case "custom":
    case "cinematic": {
      const job = await getSubscriptionVideoJob(jobId);
      if (!job || job.mode !== jobType || job.access_token !== accessToken) return null;
      return job.status === "completed" ? job.video_url : null;
    }
  }
}

export async function GET(req: NextRequest) {
  const jobType = req.nextUrl.searchParams.get("jobType") as JobType | null;
  const jobId = req.nextUrl.searchParams.get("jobId");
  const accessToken = req.nextUrl.searchParams.get("access_token");
  if (!jobType || !jobId || !["paygo", "character", "custom", "cinematic"].includes(jobType)) {
    return NextResponse.json({ error: "jobType and jobId are required" }, { status: 400 });
  }

  let videoUrl: string | null;
  try {
    videoUrl = await resolveVideoUrl(jobType, jobId, accessToken);
  } catch (err) {
    console.error("download-video lookup failed", err);
    return NextResponse.json({ error: "Could not find that video" }, { status: 500 });
  }
  if (!videoUrl) {
    return NextResponse.json({ error: "Video not found, not finished yet, or not yours" }, { status: 404 });
  }

  const upstream = await fetch(videoUrl);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Could not fetch the video from the vendor" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
      "Content-Disposition": `attachment; filename="lucy-labs-${jobType}-${jobId}.mp4"`,
      ...(upstream.headers.get("content-length") ? { "Content-Length": upstream.headers.get("content-length")! } : {}),
    },
  });
}
