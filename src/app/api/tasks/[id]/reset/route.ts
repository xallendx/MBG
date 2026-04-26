import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { canReset } from '@/lib/schedule'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const task = await db.task.findFirst({ where: { id, userId } })
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Block reset for sekali and tanggal_spesifik — these are final
  if (!canReset(task.scheduleType)) {
    return NextResponse.json({ error: `Task "${task.scheduleType === 'sekali' ? 'Sekali' : 'Tanggal Spesifik'}" tidak bisa di-reset` }, { status: 400 })
  }

  // Hapus semua log + reset notif tracking
  await db.task.update({
    where: { id },
    data: {
      notifiedWarnAt: null,
      notifiedReadyAt: null,
    }
  })

  await db.taskLog.deleteMany({ where: { taskId: id } })

  return NextResponse.json({ success: true })
}
