import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { computeStatus } from '@/lib/schedule'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    // Fetch user settings for timezone
    const user = await db.user.findUnique({ where: { id: userId }, select: { settings: true } }).catch(() => null)
    let userTz = 'WIB'
    try { userTz = user?.settings ? (JSON.parse(user.settings).timezone as string) || 'WIB' : 'WIB' } catch { /* use default */ }

    // Use transaction to prevent double-completion race condition
    const result = await db.$transaction(async (tx) => {
      const task = await tx.task.findFirst({ where: { id, userId }, include: { logs: { orderBy: { completedAt: 'desc' } } } })
      if (!task) return { error: 'Not found', status: 404 as const }

      const status = computeStatus(task, userTz)
      if (status !== 'siap') {
        return { error: `Task tidak bisa diselesaikan — status saat ini: ${status}`, status: 400 as const }
      }

      // Reset notification tracking + create log atomically
      await tx.task.update({
        where: { id },
        data: {
          notifiedWarnAt: null,
          notifiedReadyAt: null,
        }
      })

      await tx.taskLog.create({
        data: { taskId: id }
      })

      return { success: true }
    })

    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
