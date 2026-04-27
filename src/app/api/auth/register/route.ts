import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { setAuthCookie } from '@/lib/auth'

export async function POST(req: Request) {
  try {
    const { username, password, displayName, inviteCode } = await req.json()

    // Validate invite code FIRST
    if (!inviteCode || typeof inviteCode !== 'string') {
      return NextResponse.json({ error: 'Kode undangan wajib diisi' }, { status: 400 })
    }
    const code = inviteCode.trim().toUpperCase()
    if (code.length < 6) {
      return NextResponse.json({ error: 'Kode undangan tidak valid' }, { status: 400 })
    }

    // Validate username and password
    if (!username || !password) {
      return NextResponse.json({ error: 'Username dan password wajib diisi' }, { status: 400 })
    }
    if (username.length < 3) {
      return NextResponse.json({ error: 'Username minimal 3 karakter' }, { status: 400 })
    }
    if (username.length > 50) {
      return NextResponse.json({ error: 'Username maksimal 50 karakter' }, { status: 400 })
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json({ error: 'Username hanya boleh huruf, angka, dan underscore' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 })
    }
    if (displayName !== undefined && displayName !== null && displayName.length > 100) {
      return NextResponse.json({ error: 'Display name maksimal 100 karakter' }, { status: 400 })
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10)

    // Wrap invite code check + user creation + invite code update in a transaction
    const result = await db.$transaction(async (tx) => {
      const invite = await tx.inviteCode.findUnique({ where: { code } })
      if (!invite) {
        throw new Error('INVALID_CODE')
      }
      if (invite.usedBy) {
        throw new Error('CODE_USED')
      }

      // Check existing user
      const existing = await tx.user.findUnique({ where: { username } })
      if (existing) {
        throw new Error('USERNAME_TAKEN')
      }

      const userRole = invite.role || 'USER'

      const user = await tx.user.create({
        data: {
          username,
          passwordHash,
          displayName: displayName || null,
          role: userRole
        }
      })

      await tx.inviteCode.update({
        where: { id: invite.id },
        data: { usedBy: user.id, usedAt: new Date() }
      })

      return user
    })

    const res = NextResponse.json({ success: true, user: { id: result.id, username: result.username, displayName: result.displayName, role: result.role } })
    setAuthCookie(res, result.id)
    return res
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === 'INVALID_CODE') return NextResponse.json({ error: 'Kode undangan tidak valid' }, { status: 403 })
      if (e.message === 'CODE_USED') return NextResponse.json({ error: 'Kode undangan sudah digunakan' }, { status: 403 })
      if (e.message === 'USERNAME_TAKEN') return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
