import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { cookies } from 'next/headers'
import crypto from 'crypto'

// Cookie secret must match auth.ts
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'mbg-default-secret-change-in-production'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const raw = cookieStore.get('mbg_user_id')?.value

    if (!raw) {
      return NextResponse.json({ userId: null, authenticated: false }, { status: 401 })
    }

    // Verify HMAC signature
    const dotIdx = raw.lastIndexOf('.')
    if (dotIdx === -1) {
      // Legacy cookie without signature — clear it
      const res = NextResponse.json({ userId: null, authenticated: false }, { status: 401 })
      res.cookies.set('mbg_user_id', '', { maxAge: 0, path: '/' })
      return res
    }
    const userId = raw.slice(0, dotIdx)
    const sig = raw.slice(dotIdx + 1)
    const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(userId).digest('hex').slice(0, 16)

    if (sig !== expected) {
      // Tampered cookie — clear it
      const res = NextResponse.json({ userId: null, authenticated: false }, { status: 401 })
      res.cookies.set('mbg_user_id', '', { maxAge: 0, path: '/' })
      return res
    }

    // Verify user exists in database
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, role: true, isBlocked: true }
    })

    if (!user) {
      const res = NextResponse.json({ userId: null, authenticated: false }, { status: 401 })
      res.cookies.set('mbg_user_id', '', { maxAge: 0, path: '/' })
      return res
    }

    if (user.isBlocked) {
      const res = NextResponse.json({ userId: null, authenticated: false, blocked: true }, { status: 401 })
      res.cookies.set('mbg_user_id', '', { maxAge: 0, path: '/' })
      return res
    }

    return NextResponse.json({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      authenticated: true
    })
  } catch (e) {
    console.error('Identify error:', e)
    return NextResponse.json({ userId: null, authenticated: false }, { status: 500 })
  }
}
