import { db } from '@/lib/db'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

// HMAC cookie signing — prevents tampering with mbg_user_id cookie
const COOKIE_SECRET = process.env.COOKIE_SECRET
if (!COOKIE_SECRET) {
  console.warn('[SECURITY] COOKIE_SECRET env var is not set. Using fallback for development only.')
}

const _SECRET = COOKIE_SECRET || 'dev-only-fallback-do-not-use-in-production'

function signCookie(userId: string): string {
  const sig = crypto.createHmac('sha256', _SECRET).update(userId).digest('hex').slice(0, 32)
  return `${userId}.${sig}`
}

function verifyCookie(value: string): string | null {
  const dotIdx = value.lastIndexOf('.')
  if (dotIdx === -1) return null
  const userId = value.slice(0, dotIdx)
  const sig = value.slice(dotIdx + 1)
  const expected = crypto.createHmac('sha256', _SECRET).update(userId).digest('hex').slice(0, 32)
  if (sig !== expected) return null
  return userId
}

// Helper: ambil userId dari cookie saja (cookie-only auth, no header fallback)
async function getUserId() {
  const c = await cookies()
  const raw = c.get('mbg_user_id')?.value
  if (!raw) return null

  // Verify HMAC signature — reject tampered cookies
  const userId = verifyCookie(raw)
  return userId
}

// Helper: set signed cookie on response
export function setAuthCookie(res: NextResponse, userId: string) {
  res.cookies.set('mbg_user_id', signCookie(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })
}

// Helper: clear auth cookie
export function clearAuthCookie(res: NextResponse) {
  res.cookies.set('mbg_user_id', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
}

// Helper: get current user from cookie only
export async function getCurrentUser() {
  const userId = await getUserId()
  if (!userId) return null

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, role: true, isBlocked: true }
  })
  return user
}

// Helper: cek apakah user adalah admin
export async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), user: null }
  }
  if (user.isBlocked) {
    return { error: NextResponse.json({ error: 'Akun diblokir' }, { status: 403 }), user: null }
  }
  if (user.role !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Hanya admin yang bisa mengakses' }, { status: 403 }), user: null }
  }
  return { error: null, user }
}

// Helper: cek user biasa (bukan blocked)
export async function requireUser() {
  const userId = await getUserId()
  if (!userId) return null

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isBlocked: true }
  })
  if (!user || user.isBlocked) return null
  return user.id
}

// Export verifyCookie for use in identify route (DRY)
export { verifyCookie }
