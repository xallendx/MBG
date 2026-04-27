import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { canReset } from '@/lib/schedule'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    // Use transaction to prevent race condition
    const result = await db.$transaction(async (tx) => {
      const task = await tx.task.findFirst({ where: { id, userId } })
      if (!task) return { error: 'Not found', status: 404 as const }

      if (!canReset(task.scheduleType)) {
        return { error: `Task "${task.scheduleType === 'sekali' ? 'Sekali' : 'Tanggal Spesifik'}" tidak bisa di-reset`, status: 400 as const }
      }

      // Delete logs + reset notification tracking atomically
      await tx.task.update({
        where: { id },
        data: {
          notifiedWarnAt: null,
          notifiedReadyAt: null,
        }
      })

      await tx.taskLog.deleteMany({ where: { taskId: id } })

      return { success: true }
    })

    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
