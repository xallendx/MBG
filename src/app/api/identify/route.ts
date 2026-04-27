import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCookie, clearAuthCookie } from '@/lib/auth'

export async function GET() {
  try {
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const raw = cookieStore.get('mbg_user_id')?.value

    if (!raw) {
      return NextResponse.json({ userId: null, authenticated: false }, { status: 401 })
    }

    // Verify HMAC signature (uses shared function from auth.ts)
    const userId = verifyCookie(raw)

    if (!userId) {
      // Tampered or legacy cookie — clear it
      const res = NextResponse.json({ userId: null, authenticated: false }, { status: 401 })
      clearAuthCookie(res)
      return res
    }

    // Verify user exists in database
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, role: true, isBlocked: true }
    })

    if (!user) {
      const res = NextResponse.json({ userId: null, authenticated: false }, { status: 401 })
      clearAuthCookie(res)
      return res
    }

    if (user.isBlocked) {
      const res = NextResponse.json({ userId: null, authenticated: false, blocked: true }, { status: 401 })
      clearAuthCookie(res)
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
