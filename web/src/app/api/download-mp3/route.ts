import { NextRequest, NextResponse } from "next/server";
import wav from "node-wav";
import lamejs from "@breezystack/lamejs";

// Takes the already-generated audio as base64 in the request body - the
// client has it in memory from the completed job (see job-status/route.ts),
// there's no longer a server-side file to fetch by filename now that audio
// isn't persisted anywhere on our infra (see STATUS.md "Serverless
// migration"). POST because the payload can be a few MB, too big for a
// clean query-string GET.
function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export async function POST(req: NextRequest) {
  // Wrapped in try/catch like generate-preset/clone-voice - a malformed or
  // truncated audioBase64 throwing out of wav.decode()/the mp3 encoder used
  // to fall through to Vercel's default non-JSON error page.
  try {
    const body = await req.json();
    const audioBase64 = body.audioBase64 as string | undefined;
    const name = (body.name as string | undefined) ?? "lucy-audio";
    if (!audioBase64) {
      return NextResponse.json({ error: "Missing audioBase64" }, { status: 400 });
    }

    const wavBuffer = Buffer.from(audioBase64, "base64");
    const decoded = wav.decode(wavBuffer);
    const channelCount = decoded.channelData.length;
    const sampleRate = decoded.sampleRate;

    const encoder = new lamejs.Mp3Encoder(channelCount, sampleRate, 128);
    const left = floatTo16BitPCM(decoded.channelData[0]);
    const right = channelCount > 1 ? floatTo16BitPCM(decoded.channelData[1]) : undefined;

    const mp3Chunks: Uint8Array[] = [];
    const blockSize = 1152;
    for (let i = 0; i < left.length; i += blockSize) {
      const leftChunk = left.subarray(i, i + blockSize);
      const rightChunk = right?.subarray(i, i + blockSize);
      const mp3buf = rightChunk
        ? encoder.encodeBuffer(leftChunk, rightChunk)
        : encoder.encodeBuffer(leftChunk);
      if (mp3buf.length > 0) mp3Chunks.push(mp3buf);
    }
    const finalBuf = encoder.flush();
    if (finalBuf.length > 0) mp3Chunks.push(finalBuf);

    const mp3Data = Buffer.concat(mp3Chunks.map((c) => Buffer.from(c)));

    return new NextResponse(mp3Data, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `attachment; filename="${name}.mp3"`,
        "Content-Length": String(mp3Data.length),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not convert that audio to MP3." },
      { status: 400 },
    );
  }
}
