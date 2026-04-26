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

    // Tambahkan info invite code yang dipakai
    const enriched = await Promise.all(users.map(async (u) => {
      const invite = await db.inviteCode.findFirst({
        where: { usedBy: u.id },
        select: { code: true }
      })
      return {
        ...u,
        inviteCode: invite?.code || null
      }
    }))

    return NextResponse.json(enriched)
  } catch (e) {
    console.error('Admin users error:', e)
    return NextResponse.json({ error: 'Gagal mengambil data' }, { status: 500 })
  }
}
