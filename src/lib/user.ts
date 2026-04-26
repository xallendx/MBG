// DEPRECATED: This file contains the legacy auto-create-user auth system.
// The current auth system is in auth.ts (cookie-based with login/register).
// This file is kept only for /api/projects/[id]/tasks which still imports it.
// TODO: Remove after migrating that route to use auth.ts.

import { cookies } from 'next/headers';
import { db } from '@/lib/db';

const COOKIE_NAME = 'airtask-user';

export function generateRandomUsername(): string {
  const adj = ['swift', 'calm', 'bold', 'keen', 'fair', 'witty', 'pure', 'warm', 'neat', 'cool'];
  const noun = ['fox', 'owl', 'cat', 'bee', 'elk', 'ram', 'hen', 'jay', 'cod', 'yak'];
  const num = Math.floor(Math.random() * 1000);
  return `${adj[Math.floor(Math.random() * adj.length)]}${noun[Math.floor(Math.random() * noun.length)]}${num}`;
}

export async function getOrCreateUser(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(COOKIE_NAME);

  if (existing?.value) {
    const user = await db.user.findUnique({ where: { id: existing.value } });
    if (user) return user.id;
  }

  // Create new user
  const username = generateRandomUsername();
  const user = await db.user.create({
    data: {
      username,
      passwordHash: 'demo-no-password', // No auth required
    },
  });

  return user.id;
}

export async function getUserId(): Promise<string> {
  return getOrCreateUser();
}

export async function setUserCookie(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  });
}
