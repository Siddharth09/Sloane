import { NextResponse } from "next/server";
import { getExpiredGenerations, deleteGenerationsByIds, initSchema } from "@/lib/db";
import { deleteGenerationBlob } from "@/lib/generationHistory";

// Runs daily via vercel.json's cron config. This is what actually bounds
// storage cost regardless of traffic - generations past their retention
// window get their Blob object and DB row removed here rather than living
// forever.
export async function GET() {
  await initSchema();
  const expired = await getExpiredGenerations();
  for (const generation of expired) {
    await deleteGenerationBlob(generation);
  }
  await deleteGenerationsByIds(expired.map((g) => g.id));
  return NextResponse.json({ deleted: expired.length });
}
