import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

// DELETE /api/admin/invite-codes/[id] — hapus invite code
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await params

  const code = await db.inviteCode.findUnique({ where: { id } })
  if (!code) {
    return NextResponse.json({ error: 'Kode tidak ditemukan' }, { status: 404 })
  }

  if (code.usedBy) {
    return NextResponse.json({ error: 'Kode yang sudah digunakan tidak bisa dihapus' }, { status: 400 })
  }

  await db.inviteCode.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
