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

    const invite = await db.inviteCode.findUnique({ where: { code } })
    if (!invite) {
      return NextResponse.json({ error: 'Kode undangan tidak valid' }, { status: 403 })
    }
    if (invite.usedBy) {
      return NextResponse.json({ error: 'Kode undangan sudah digunakan' }, { status: 403 })
    }

    // Validate username and password
    if (!username || !password) {
      return NextResponse.json({ error: 'Username dan password wajib diisi' }, { status: 400 })
    }
    if (username.length < 3) {
      return NextResponse.json({ error: 'Username minimal 3 karakter' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 })
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json({ error: 'Username hanya boleh huruf, angka, dan underscore' }, { status: 400 })
    }

    // Check existing user
    const existing = await db.user.findUnique({ where: { username } })
    if (existing) {
      return NextResponse.json({ error: 'Username sudah digunakan' }, { status: 409 })
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10)

    const userRole = invite.role || 'USER'

    const user = await db.user.create({
      data: {
        username,
        passwordHash,
        displayName: displayName || null,
        role: userRole
      }
    })

    await db.inviteCode.update({
      where: { id: invite.id },
      data: { usedBy: user.id, usedAt: new Date() }
    })

    const res = NextResponse.json({ success: true, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } })
    setAuthCookie(res, user.id)
    return res
  } catch (e) {
    console.error('Register error:', e)
    return NextResponse.json({ error: 'Gagal mendaftar. Silakan coba lagi.' }, { status: 500 })
  }
}
