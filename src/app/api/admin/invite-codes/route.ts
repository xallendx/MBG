import { NextResponse } from 'next/server'
import { randomInt } from 'node:crypto'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handleApiError, parseBody } from '@/lib/api'
import { inviteCodeCreateSchema } from '@/lib/schemas'

// GET /api/admin/invite-codes — daftar seluruh kode undangan
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const codes = await db.inviteCode.findMany({ orderBy: { createdAt: 'desc' } })

    // Ambil semua user pemakai sekaligus (hindari N+1)
    const usedByIds = [...new Set(codes.map(c => c.usedBy).filter(Boolean))] as string[]
    const users =
      usedByIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: usedByIds } },
            select: { id: true, username: true, displayName: true, role: true },
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
      user: c.usedBy ? userMap[c.usedBy] || null : null,
    }))

    return NextResponse.json(enriched)
  } catch (e) {
    return handleApiError('GET /api/admin/invite-codes', e)
  }
}

// POST /api/admin/invite-codes — buat kode undangan baru
export async function POST(req: Request) {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const { role } = await parseBody(req, inviteCodeCreateSchema)

    // Format MBG-XXX-XXX, ulangi bila bentrok (unique constraint)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const rand = (n: number) =>
      Array.from({ length: n }, () => chars[randomInt(chars.length)]).join('')

    for (let attempt = 0; attempt < 10; attempt++) {
      const code = `MBG-${rand(3)}-${rand(3)}`
      try {
        const inviteCode = await db.inviteCode.create({ data: { code, role } })
        return NextResponse.json(inviteCode, { status: 201 })
      } catch (e) {
        // P2002 = kode sudah dipakai → coba kode lain
        if ((e as { code?: string }).code === 'P2002' && attempt < 9) continue
        throw e
      }
    }

    return NextResponse.json({ error: 'Gagal membuat kode unik — coba lagi' }, { status: 503 })
  } catch (e) {
    return handleApiError('POST /api/admin/invite-codes', e)
  }
}
