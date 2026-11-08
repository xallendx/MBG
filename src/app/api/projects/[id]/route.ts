import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, parseBody, requireUserId } from '@/lib/api'
import { projectUpdateSchema } from '@/lib/schemas'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = 'PUT /api/projects/[id]'
  try {
    const userId = await requireUserId()
    const { id } = await params

    const existing = await db.project.findFirst({ where: { id, userId } })
    if (!existing) throw new ApiError(404, 'Project tidak ditemukan', 'NOT_FOUND')

    const input = await parseBody(req, projectUpdateSchema)

    const project = await db.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.color !== undefined && { color: input.color }),
        ...(input.position !== undefined && { position: input.position }),
      },
    })

    return NextResponse.json(project)
  } catch (e) {
    return handleApiError(ctx, e)
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = 'DELETE /api/projects/[id]'
  try {
    const userId = await requireUserId()
    const { id } = await params

    // Transaksi: verifikasi kepemilikan → hapus log → hapus task → hapus project.
    // Penghapusan log eksplisit demi keandalan dengan pgbouncer transaction pooling.
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.project.findFirst({ where: { id, userId } })
      if (!existing) return 'not_found'

      const projectTasks = await tx.task.findMany({ where: { projectId: id }, select: { id: true } })
      if (projectTasks.length > 0) {
        const taskIds = projectTasks.map(t => t.id)
        await tx.taskLog.deleteMany({ where: { taskId: { in: taskIds } } })
        await tx.task.deleteMany({ where: { projectId: id } })
      }
      await tx.project.delete({ where: { id } })
      return 'ok'
    })

    if (result === 'not_found') throw new ApiError(404, 'Project tidak ditemukan', 'NOT_FOUND')

    return NextResponse.json({ success: true })
  } catch (e) {
    return handleApiError(ctx, e)
  }
}
