import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, parseBody, requireUserId } from '@/lib/api'
import { templateUpdateSchema } from '@/lib/schemas'
import { scheduleInputError } from '@/lib/schedule-input'

// PUT /api/templates/[id] — perbarui template
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = 'PUT /api/templates/[id]'
  try {
    const userId = await requireUserId()
    const { id } = await params

    const existing = await db.taskTemplate.findFirst({ where: { id, userId } })
    if (!existing) throw new ApiError(404, 'Template tidak ditemukan', 'NOT_FOUND')

    const input = await parseBody(req, templateUpdateSchema)
    if (input.scheduleType !== undefined || input.scheduleConfig !== undefined) {
      let previous: Record<string, unknown> = {}
      try { previous = JSON.parse(existing.scheduleConfig) } catch { /* legacy config */ }
      const error = scheduleInputError(input.scheduleType ?? existing.scheduleType, input.scheduleConfig ?? previous)
      if (error) throw new ApiError(400, error, 'INVALID_SCHEDULE')
    }

    const template = await db.taskTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.link !== undefined && { link: input.link }),
        ...(input.scheduleType !== undefined && { scheduleType: input.scheduleType }),
        ...(input.scheduleConfig !== undefined && { scheduleConfig: JSON.stringify(input.scheduleConfig) }),
        ...(input.priority !== undefined && { priority: input.priority }),
      },
    })

    return NextResponse.json(template)
  } catch (e) {
    return handleApiError(ctx, e)
  }
}

// DELETE /api/templates/[id]
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = 'DELETE /api/templates/[id]'
  try {
    const userId = await requireUserId()
    const { id } = await params

    const existing = await db.taskTemplate.findFirst({ where: { id, userId } })
    if (!existing) throw new ApiError(404, 'Template tidak ditemukan', 'NOT_FOUND')

    await db.taskTemplate.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    return handleApiError(ctx, e)
  }
}
