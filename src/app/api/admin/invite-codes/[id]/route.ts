import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { ApiError, handleApiError } from '@/lib/api'

// DELETE /api/admin/invite-codes/[id] — hapus kode undangan yang belum dipakai
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin()
  if (error) return error

  try {
    const { id } = await params

    const code = await db.inviteCode.findUnique({ where: { id } })
    if (!code) throw new ApiError(404, 'Kode tidak ditemukan', 'NOT_FOUND')
    if (code.usedBy) {
      throw new ApiError(400, 'Kode yang sudah digunakan tidak bisa dihapus', 'CODE_USED')
    }

    await db.inviteCode.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    return handleApiError('DELETE /api/admin/invite-codes/[id]', e)
  }
}
