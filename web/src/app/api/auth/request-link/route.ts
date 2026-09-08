import { NextRequest, NextResponse } from "next/server";
import { sendLoginLink } from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string };
    const trimmed = email?.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    const token = await sendLoginLink(trimmed);
    const link = `${req.nextUrl.origin}/api/auth/verify?token=${token}`;
    await sendMagicLinkEmail(trimmed, link);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth] request-link failed", err);
    return NextResponse.json({ error: "Something went wrong sending your link" }, { status: 500 });
  }
}
