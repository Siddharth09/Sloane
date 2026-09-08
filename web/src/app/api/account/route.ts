import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSubscriberByUserId, listGenerationsForUser, initSchema } from "@/lib/db";

export async function GET() {
  try {
    await initSchema();
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const subscriber = await getSubscriberByUserId(user.id);
    const generations = await listGenerationsForUser(user.id);
    return NextResponse.json({
      email: user.email,
      accessToken: subscriber?.access_token ?? null,
      subscriber: subscriber
        ? {
            plan: subscriber.plan,
            status: subscriber.status,
            charactersUsed: subscriber.characters_used,
            periodEnd: subscriber.period_end,
          }
        : null,
      generations: generations.map((g) => ({
        id: g.id,
        kind: g.kind,
        voiceLabel: g.voice_label,
        textPreview: g.text_preview,
        audioUrl: g.audio_url,
        createdAt: g.created_at,
        expiresAt: g.expires_at,
      })),
    });
  } catch (err) {
    console.error("[account] failed to load account", err);
    return NextResponse.json({ error: "Could not load your account right now" }, { status: 500 });
  }
}
