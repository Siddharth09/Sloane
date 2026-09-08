import { NextRequest, NextResponse } from "next/server";
import { getFreeTierUsage, initSchema } from "@/lib/db";

// Public, read-only - just this browser's own anonymous counter, nothing
// sensitive. Powers the "X characters left" display on the free tier (see
// web/src/app/page.tsx).
export async function GET(req: NextRequest) {
  try {
    await initSchema();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const usage = await getFreeTierUsage(id);
    return NextResponse.json(usage);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load usage" },
      { status: 502 },
    );
  }
}
