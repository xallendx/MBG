import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUserWithSettings } from '@/lib/auth'
import { computeStatus, getNextReadyAt } from '@/lib/schedule'
import { handleApiError } from '@/lib/api'
import { getTimezone } from '@/lib/settings'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Satu query untuk auth sekaligus zona waktu (dulu dua query terpisah).
    const auth = await requireUserWithSettings()
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = auth.id
    const { id } = await params
    const userTz = getTimezone(auth.settings, 'POST /api/tasks/[id]/complete')

    // Use transaction to prevent double-completion race condition
    const result = await db.$transaction(async (tx) => {
      // Kunci baris sebelum membaca log/status. Transaksi saja pada tingkat
      // READ COMMITTED tidak mencegah dua permintaan membaca status siap.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Task" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`
      if (!locked.length) return { error: 'Not found', status: 404 as const }
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

      const createdLog = await tx.taskLog.create({
        data: { taskId: id }
      })

      // Reset penanda notifikasi SEKALIGUS membaca ulang tugas beserta log yang
      // baru dibuat. Dulu ini dua pernyataan (update lalu findFirst) sehingga
      // ada satu perjalanan database ekstra pada setiap penyelesaian tugas.
      // Urutannya penting: log dibuat lebih dulu supaya status yang dihitung
      // dari balasan update sudah memperhitungkan penyelesaian ini.
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          notifiedWarnAt: null,
          notifiedReadyAt: null,
        },
        include: {
          logs: { orderBy: { completedAt: 'desc' }, take: 1 },
          _count: { select: { logs: true } },
          project: { select: { id: true, name: true, color: true } },
        },
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
        logId: createdLog.id,
        task: {
          status: newStatus,
          nextReadyAt: nextReady instanceof Date && !isNaN(nextReady.getTime()) ? nextReady.toISOString() : null,
          lastCompletedAt: lastCompleted?.toISOString() || null,
          cooldownRemaining,
          cooldownMs,
          logCount: updatedTask._count.logs,
        }
      }
    })

    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true, logId: result.logId ?? null, task: result.task ?? null })
  } catch (e) {
    return handleApiError('api/tasks/[id]/complete', e)
  }
}
