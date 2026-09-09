import { cookies } from "next/headers";
import {
  createLoginToken,
  consumeLoginToken,
  upsertUserByEmail,
  upsertUserByGoogle,
  createSessionRow,
  getSessionUserRow,
  deleteSessionRow,
  linkSubscriberToUser,
  type User,
} from "./db";

const SESSION_COOKIE = "lucy_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days, matches sessions.expires_at

export async function sendLoginLink(email: string): Promise<string> {
  return createLoginToken(email);
}

// Verifies + consumes a login token, creates (or reuses) the user, links any
// pre-existing subscriber row by email, opens a session, and sets the
// cookie. Returns the signed-in user, or null if the token was invalid/expired.
export async function completeLogin(token: string): Promise<User | null> {
  const email = await consumeLoginToken(token);
  if (!email) return null;
  const user = await upsertUserByEmail(email);
  await linkSubscriberToUser(email, user.id);
  await startSession(user.id);
  return user;
}

export async function completeGoogleLogin(email: string, googleId: string): Promise<User> {
  const user = await upsertUserByGoogle(email, googleId);
  await linkSubscriberToUser(email, user.id);
  await startSession(user.id);
  return user;
}

async function startSession(userId: string) {
  const sessionId = await createSessionRow(userId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function getSessionUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  return getSessionUserRow(sessionId);
}

export async function destroySession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId) await deleteSessionRow(sessionId);
  cookieStore.delete(SESSION_COOKIE);
}
