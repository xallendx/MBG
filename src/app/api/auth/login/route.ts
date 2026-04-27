import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { setAuthCookie } from '@/lib/auth'

// In-memory rate limiter for login attempts
const loginAttempts = new Map<string, { count: number; windowStart: number }>()
const MAX_LOGIN_ATTEMPTS = 10
const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

function isLoginRateLimited(key: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(key)
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now })
    return false
  }
  if (entry.count >= MAX_LOGIN_ATTEMPTS) return true
  entry.count++
  return false
}

async function verifyPassword(password: string, hash: string): Promise<{ match: boolean; newHash?: string }> {
  if (hash.startsWith('$2')) {
    const match = await bcrypt.compare(password, hash)
    return { match }
  }
  // Legacy SHA-256 — verify and re-hash
  const sha256 = crypto.createHash('sha256').update(password).digest('hex')
  if (sha256 === hash) {
    const newHash = await bcrypt.hash(password, 10)
    return { match: true, newHash }
  }
  return { match: false }
}

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json()
    if (!username || !password) {
      return NextResponse.json({ error: 'Username dan password wajib diisi' }, { status: 400 })
    }

    // Rate limiting by username (prevent brute force)
    if (isLoginRateLimited(username)) {
      return NextResponse.json({ error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }, { status: 429 })
    }

    const user = await db.user.findUnique({ where: { username } })
    if (!user || user.isBlocked) {
      return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
    }

    const result = await verifyPassword(password, user.passwordHash)

    if (!result.match) {
      return NextResponse.json({ error: 'Username atau password salah' }, { status: 401 })
    }

    // Re-hash legacy SHA-256 passwords with bcrypt
    if (result.newHash) {
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: result.newHash }
      })
    }

    // Clear rate limit on successful login
    loginAttempts.delete(username)

    const res = NextResponse.json({ success: true, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } })
    setAuthCookie(res, user.id)
    return res
  } catch (e) {
    console.error('Login error:', e)
    return NextResponse.json({ error: 'Gagal login' }, { status: 500 })
  }
}
