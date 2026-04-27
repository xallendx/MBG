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

    // Batch fetch all users referenced by usedBy (fix N+1)
    const usedByIds = [...new Set(codes.map(c => c.usedBy).filter(Boolean))] as string[]
    const users = usedByIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: usedByIds } },
          select: { id: true, username: true, displayName: true, role: true }
        })
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    const enriched = codes.map(c => ({
      id: c.id,
      code: c.code,
      role: c.role,
      usedBy: c.usedBy,
      usedAt: c.usedAt,
      createdAt: c.createdAt,
      user: c.usedBy ? userMap[c.usedBy] || null : null
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

  try {
    const body = await req.json()
    const { role } = body // 'USER' atau 'ADMIN'
    const codeRole = role === 'ADMIN' ? 'ADMIN' : 'USER'

    // Generate random code: MBG-XXX-XXX with collision retry
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const rand = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

    for (let attempt = 0; attempt < 10; attempt++) {
      const code = `MBG-${rand(3)}-${rand(3)}`
      try {
        const inviteCode = await db.inviteCode.create({
          data: { code, role: codeRole }
        })
        return NextResponse.json(inviteCode, { status: 201 })
      } catch (e: any) {
        // P2002 = unique constraint violation, retry with new code
        if (e.code === 'P2002' && attempt < 9) continue
        throw e
      }
    }

    return NextResponse.json({ error: 'Gagal membuat kode — coba lagi' }, { status: 500 })
  } catch (e) {
    console.error('Create invite code error:', e)
    return NextResponse.json({ error: 'Gagal membuat kode' }, { status: 500 })
  }
}
