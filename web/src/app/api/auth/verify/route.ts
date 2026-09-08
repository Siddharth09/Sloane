import { NextRequest, NextResponse } from "next/server";
import { completeLogin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/account?error=missing_token", req.nextUrl.origin));
  }
  const user = await completeLogin(token);
  if (!user) {
    return NextResponse.redirect(new URL("/account?error=expired_link", req.nextUrl.origin));
  }
  return NextResponse.redirect(new URL("/account", req.nextUrl.origin));
}
