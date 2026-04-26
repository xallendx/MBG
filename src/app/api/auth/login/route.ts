import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { setAuthCookie } from '@/lib/auth'

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

    const res = NextResponse.json({ success: true, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } })
    setAuthCookie(res, user.id)
    return res
  } catch (e) {
    console.error('Login error:', e)
    return NextResponse.json({ error: 'Gagal login' }, { status: 500 })
  }
}
