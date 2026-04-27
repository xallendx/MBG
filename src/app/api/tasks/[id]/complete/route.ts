import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { computeStatus } from '@/lib/schedule'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    const task = await db.task.findFirst({ where: { id, userId }, include: { logs: { orderBy: { completedAt: 'desc' } } } })
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // BUG-FIX: hanya bisa complete jika status 'siap' — cegah double-completion
    const status = computeStatus(task)
    if (status !== 'siap') {
      return NextResponse.json({ error: `Task tidak bisa diselesaikan — status saat ini: ${status}` }, { status: 400 })
    }

    // Buat log complete + reset notif tracking (karena mulai cooldown baru)
    await db.task.update({
      where: { id },
      data: {
        notifiedWarnAt: null,
        notifiedReadyAt: null,
      }
    })

    await db.taskLog.create({
      data: { taskId: id }
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
