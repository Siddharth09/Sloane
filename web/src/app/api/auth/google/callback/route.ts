import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { completeGoogleLogin } from "@/lib/auth";

const STATE_COOKIE = "lucy_oauth_state";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/account?error=google_state_mismatch", origin));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/account?error=google_not_configured", origin));
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed (${tokenRes.status})`);
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userInfoRes.ok) throw new Error(`Userinfo fetch failed (${userInfoRes.status})`);
    const info = (await userInfoRes.json()) as { sub: string; email: string; email_verified?: boolean };
    if (!info.email) throw new Error("Google account has no email");

    await completeGoogleLogin(info.email.toLowerCase(), info.sub);
    return NextResponse.redirect(new URL("/account", origin));
  } catch (err) {
    console.error("[auth] Google OAuth callback failed", err);
    return NextResponse.redirect(new URL("/account?error=google_failed", origin));
  }
}
