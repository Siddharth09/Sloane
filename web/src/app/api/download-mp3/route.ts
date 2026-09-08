import { NextRequest, NextResponse } from "next/server";
import wav from "node-wav";
import lamejs from "@breezystack/lamejs";

const INFERENCE_SERVER_URL = process.env.INFERENCE_SERVER_URL!;

// The client only ever supplies the generated clip's filename, never a URL -
// taking an arbitrary URL from the client and fetching it server-side would
// be a textbook SSRF vector. We build the upstream URL ourselves from a
// validated filename instead.
const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.wav$/;

function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file");
  const name = req.nextUrl.searchParams.get("name") ?? "lucy-audio";
  if (!file || !SAFE_FILENAME.test(file)) {
    return NextResponse.json({ error: "Invalid audio file" }, { status: 400 });
  }

  const upstream = await fetch(`${INFERENCE_SERVER_URL}/audio/${file}`);
  if (!upstream.ok) {
    return NextResponse.json({ error: "Could not fetch source audio" }, { status: 502 });
  }
  const wavBuffer = Buffer.from(await upstream.arrayBuffer());

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
}
