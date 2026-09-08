import { NextRequest, NextResponse } from "next/server";

const INFERENCE_SERVER_URL = process.env.INFERENCE_SERVER_URL!;

// Generated clips are named as a bare uuid + extension by the inference
// server - anything else isn't a file we generated, so refuse it rather
// than forwarding an arbitrary path onto our internal server.
const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.wav$/;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (!SAFE_FILENAME.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const upstream = await fetch(`${INFERENCE_SERVER_URL}/audio/${filename}`);
  if (!upstream.ok) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/wav",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
