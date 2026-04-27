import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { computeStatus, getNextReadyAt } from '@/lib/schedule'

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
      const task = await tx.task.findFirst({
        where: { id, userId },
        include: {
          logs: { orderBy: { completedAt: 'desc' }, take: 1 },
          project: { select: { id: true, name: true, color: true } },
        }
      })
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

      // BUG FIX: Recompute status AFTER creating the log to get accurate post-completion state
      const updatedTask = await tx.task.findFirst({
        where: { id, userId },
        include: {
          logs: { orderBy: { completedAt: 'desc' }, take: 1 },
          project: { select: { id: true, name: true, color: true } },
        }
      })

      if (!updatedTask) return { success: true }

      // Compute enriched task data to avoid status flicker on frontend
      const now = Date.now()
      const newStatus = computeStatus(updatedTask, userTz)
      const nextReady = getNextReadyAt(updatedTask, userTz)
      const rawLastCompleted = updatedTask.logs.length > 0 ? updatedTask.logs[0].completedAt : null
      const lastCompleted = rawLastCompleted instanceof Date && !isNaN(rawLastCompleted.getTime()) ? rawLastCompleted : null

      let cooldownRemaining = ''
      let cooldownMs = 0
      if (newStatus === 'cooldown' && nextReady) {
        const diff = nextReady.getTime() - now
        if (!isNaN(diff) && isFinite(diff)) {
          cooldownMs = Math.max(0, diff)
          const hours = Math.floor(diff / 3600000)
          const mins = Math.floor((diff % 3600000) / 60000)
          const secs = Math.floor((diff % 60000) / 1000)
          if (hours > 0) cooldownRemaining = `${hours}j ${mins}m`
          else if (mins > 0) cooldownRemaining = `${mins}m ${secs}s`
          else cooldownRemaining = `${secs}s`
        }
      }

      return {
        success: true as const,
        task: {
          status: newStatus,
          nextReadyAt: nextReady instanceof Date && !isNaN(nextReady.getTime()) ? nextReady.toISOString() : null,
          lastCompletedAt: lastCompleted?.toISOString() || null,
          cooldownRemaining,
          cooldownMs,
          logCount: updatedTask.logs.length,
        }
      }
    })

    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true, task: result.task ?? null })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
