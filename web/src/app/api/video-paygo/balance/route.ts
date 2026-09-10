import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { initSchema, getVideoCreditBalance } from "@/lib/db";

export async function GET() {
  await initSchema();
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ signedIn: false, balance: 0 });
  }
  const balance = await getVideoCreditBalance(user.id);
  return NextResponse.json({ signedIn: true, balance });
}
