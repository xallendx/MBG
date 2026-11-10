import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { handleApiError, parseBody } from '@/lib/api'
import { adminUserUpdateSchema } from '@/lib/schemas'

// PUT /api/admin/users/[id] — block/unblock user, ubah role
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, user: adminUser } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const { isBlocked, role } = await parseBody(req, adminUserUpdateSchema)

    // Admin tidak bisa blokir atau demote dirinya sendiri
    if (adminUser && id === adminUser.id && isBlocked === true) {
      return NextResponse.json({ error: 'Tidak bisa memblokir diri sendiri' }, { status: 400 })
    }
    if (adminUser && id === adminUser.id && role === 'USER') {
      return NextResponse.json({ error: 'Tidak bisa demote diri sendiri' }, { status: 400 })
    }

    const updateData: Record<string, unknown> = {}
    if (typeof isBlocked === 'boolean') updateData.isBlocked = isBlocked
    if (role === 'USER' || role === 'ADMIN') updateData.role = role

    // Demote/block admin terakhir adalah invariant lintas-request. Lock advisory
    // harus melindungi hitung + update di transaksi yang sama; pemeriksaan di
    // luar transaksi bisa meloloskan dua request serentak dan mengunci semua admin.
    const result = await db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } })
      if (!target) return { error: 'User tidak ditemukan', status: 404 as const }

      const removesActiveAdmin = target.role === 'ADMIN' && !target.isBlocked &&
        (role === 'USER' || isBlocked === true)
      if (removesActiveAdmin) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('mbg:last-active-admin'))`
        // Re-read setelah lock supaya request yang menunggu melihat perubahan
        // commit dari request sebelumnya, bukan snapshot sebelum lock.
        const current = await tx.user.findUnique({ where: { id } })
        if (!current) return { error: 'User tidak ditemukan', status: 404 as const }
        const stillRemovesActiveAdmin = current.role === 'ADMIN' && !current.isBlocked &&
          (role === 'USER' || isBlocked === true)
        if (stillRemovesActiveAdmin) {
          const adminCount = await tx.user.count({ where: { role: 'ADMIN', isBlocked: false } })
          if (adminCount <= 1) {
            return { error: 'Tidak bisa menonaktifkan admin aktif terakhir', status: 400 as const }
          }
        }
      }

      const updated = await tx.user.update({
        where: { id },
        data: updateData,
        select: { id: true, username: true, displayName: true, role: true, isBlocked: true }
      })
      return { updated }
    })

    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.updated)
  } catch (e) {
    return handleApiError('api/admin/users/[id]', e)
  }
}
