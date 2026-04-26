import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// GET /api/admin/invite-codes — list semua invite codes
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const codes = await db.inviteCode.findMany({
      orderBy: { createdAt: 'desc' }
    })

    // Ambil info user yang pakai kode
    const enriched = await Promise.all(codes.map(async (c) => {
      let userInfo: { id: string; username: string; displayName: string | null; role: string } | null = null
      if (c.usedBy) {
        const u = await db.user.findUnique({
          where: { id: c.usedBy },
          select: { id: true, username: true, displayName: true, role: true }
        })
        if (u) userInfo = u
      }
      return {
        id: c.id,
        code: c.code,
        role: c.role,
        usedBy: c.usedBy,
        usedAt: c.usedAt,
        createdAt: c.createdAt,
        user: userInfo
      }
    }))

    return NextResponse.json(enriched)
  } catch (e) {
    console.error('Admin invite codes error:', e)
    return NextResponse.json({ error: 'Gagal mengambil data' }, { status: 500 })
  }
}

// POST /api/admin/invite-codes — buat invite code baru
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json()
  const { role } = body // 'USER' atau 'ADMIN'
  const codeRole = role === 'ADMIN' ? 'ADMIN' : 'USER'

  // Generate random code: MBG-XXX-XXX
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const rand = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const code = `MBG-${rand(3)}-${rand(3)}`

  try {
    const inviteCode = await db.inviteCode.create({
      data: {
        code,
        role: codeRole
      }
    })

    return NextResponse.json(inviteCode, { status: 201 })
  } catch (e) {
    console.error('Create invite code error:', e)
    return NextResponse.json({ error: 'Gagal membuat kode' }, { status: 500 })
  }
}
