import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, parseBody, requireUserId } from '@/lib/api'
import { taskUpdateSchema } from '@/lib/schemas'
import { scheduleInputError } from '@/lib/schedule-input'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = 'PUT /api/tasks/[id]'
  try {
    const userId = await requireUserId()
    const { id } = await params

    const existing = await db.task.findFirst({ where: { id, userId } })
    if (!existing) throw new ApiError(404, 'Task tidak ditemukan', 'NOT_FOUND')

    const input = await parseBody(req, taskUpdateSchema)
    if (input.scheduleType !== undefined || input.scheduleConfig !== undefined) {
      let previous: Record<string, unknown> = {}
      try { previous = JSON.parse(existing.scheduleConfig) } catch { /* invalid legacy config */ }
      const error = scheduleInputError(input.scheduleType ?? existing.scheduleType, input.scheduleConfig ?? previous)
      if (error) throw new ApiError(400, error, 'INVALID_SCHEDULE')
    }

    // Verifikasi kepemilikan project tujuan (cegah pindah task ke project orang lain)
    if (input.projectId) {
      const project = await db.project.findFirst({ where: { id: input.projectId, userId } })
      if (!project) throw new ApiError(404, 'Project tidak ditemukan', 'PROJECT_NOT_FOUND')
    }

    // Reset penanda notifikasi kalau jadwal berubah, supaya siklus cooldown
    // berikutnya tetap mengirim notifikasi.
    const scheduleChanged = input.scheduleType !== undefined || input.scheduleConfig !== undefined

    const task = await db.task.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.link !== undefined && { link: input.link }),
        ...(input.scheduleType !== undefined && { scheduleType: input.scheduleType }),
        ...(input.scheduleConfig !== undefined && { scheduleConfig: JSON.stringify(input.scheduleConfig) }),
        ...(input.projectId !== undefined && { projectId: input.projectId }),
        ...(input.pinned !== undefined && { pinned: input.pinned }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.position !== undefined && { position: input.position }),
        ...(scheduleChanged && { notifiedWarnAt: null, notifiedReadyAt: null }),
      },
      include: { project: true },
    })

    return NextResponse.json(task)
  } catch (e) {
    return handleApiError(ctx, e)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = 'DELETE /api/tasks/[id]'
  try {
    const userId = await requireUserId()
    const { id } = await params

    // Transaksi: verifikasi kepemilikan → hapus log → hapus task.
    // Log dihapus eksplisit meski schema sudah CASCADE, karena dengan pgbouncer
    // (transaction pooling) cascade kadang tidak seperti yang diharapkan.
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.task.findFirst({ where: { id, userId } })
      if (!existing) return 'not_found'

      await tx.taskLog.deleteMany({ where: { taskId: id } })
      await tx.task.update({
        where: { id },
        data: { notifiedWarnAt: null, notifiedReadyAt: null },
      })
      await tx.task.delete({ where: { id } })
      return 'ok'
    })

    if (result === 'not_found') throw new ApiError(404, 'Task tidak ditemukan', 'NOT_FOUND')

    return NextResponse.json({ success: true })
  } catch (e) {
    return handleApiError(ctx, e)
  }
}
