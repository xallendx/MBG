import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { canReset } from '@/lib/schedule'
import { handleApiError } from '@/lib/api'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    // Use transaction to prevent race condition
    const result = await db.$transaction(async (tx) => {
      // Serialize with completion and undo before inspecting the schedule.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Task" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`
      if (!locked.length) return { error: 'Not found', status: 404 as const }
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
  } catch (e) {
    return handleApiError('api/tasks/[id]/reset', e)
  }
}
