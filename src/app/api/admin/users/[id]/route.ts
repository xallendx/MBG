import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// PUT /api/admin/users/[id] — block/unblock user, ubah role
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, user: adminUser } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await req.json()
    const { isBlocked, role } = body

    // Cek user target ada
    const target = await db.user.findUnique({ where: { id } })
    if (!target) {
      return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 })
    }

    // Admin tidak bisa blokir dirinya sendiri
    if (adminUser && id === adminUser.id && isBlocked === true) {
      return NextResponse.json({ error: 'Tidak bisa memblokir diri sendiri' }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}
    if (typeof isBlocked === 'boolean') updateData.isBlocked = isBlocked
    if (role === 'USER' || role === 'ADMIN') updateData.role = role

    const updated = await db.user.update({
      where: { id },
      data: updateData,
      select: { id: true, username: true, displayName: true, role: true, isBlocked: true }
    })

    return NextResponse.json(updated)
  } catch (e) {
    console.error('Admin update user error:', e)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
