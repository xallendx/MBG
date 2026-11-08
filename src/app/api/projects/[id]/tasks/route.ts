import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, parseBody, requireUserId } from '@/lib/api'
import { taskCreateSchema } from '@/lib/schemas'
import { scheduleInputError } from '@/lib/schedule-input'

// POST /api/projects/[id]/tasks — buat task langsung di dalam project
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId()
    const { id } = await params
    const input = await parseBody(req, taskCreateSchema)
    const scheduleError = scheduleInputError(input.scheduleType, input.scheduleConfig)
    if (scheduleError) throw new ApiError(400, scheduleError, 'INVALID_SCHEDULE')

    const project = await db.project.findFirst({ where: { id, userId } })
    if (!project) throw new ApiError(404, 'Project tidak ditemukan', 'NOT_FOUND')

    const maxPos = await db.task.findFirst({
      where: { projectId: id },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    const task = await db.task.create({
      data: {
        projectId: id,
        userId,
        name: input.name,
        description: input.description ?? null,
        link: input.link ?? null,
        notes: input.notes,
        pinned: input.pinned,
        scheduleType: input.scheduleType,
        scheduleConfig: JSON.stringify(input.scheduleConfig ?? {}),
        priority: input.priority,
        position: (maxPos?.position ?? -1) + 1,
      },
    })

    return NextResponse.json(task, { status: 201 })
  } catch (e) {
    return handleApiError('POST /api/projects/[id]/tasks', e)
  }
}
