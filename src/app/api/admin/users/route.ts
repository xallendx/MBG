import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// GET /api/admin/users — list semua user
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const users = await db.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isBlocked: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { projects: true, tasks: true, notes: true }
        }
      }
    })

    // Batch fetch invite codes (fix N+1)
    const userIds = users.map(u => u.id)
    const inviteCodes = userIds.length > 0
      ? await db.inviteCode.findMany({
          where: { usedBy: { in: userIds } },
          select: { code: true, usedBy: true }
        })
      : []
    const codeMap = Object.fromEntries(inviteCodes.map(c => [c.usedBy, c.code]))

    const enriched = users.map(u => ({
      ...u,
      inviteCode: codeMap[u.id] || null
    }))

    return NextResponse.json(enriched)
  } catch (e) {
    console.error('Admin users error:', e)
    return NextResponse.json({ error: 'Gagal mengambil data' }, { status: 500 })
  }
}
