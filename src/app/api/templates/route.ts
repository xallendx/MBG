import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, parseBody, requireUserId } from '@/lib/api'
import { templateCreateSchema } from '@/lib/schemas'
import { scheduleInputError } from '@/lib/schedule-input'

export async function GET() {
  try {
    const userId = await requireUserId()
    const templates = await db.taskTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(templates)
  } catch (e) {
    return handleApiError('GET /api/templates', e)
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId()
    const input = await parseBody(req, templateCreateSchema)
    const error = scheduleInputError(input.scheduleType, input.scheduleConfig)
    if (error) throw new ApiError(400, error, 'INVALID_SCHEDULE')

    const template = await db.taskTemplate.create({
      data: {
        userId,
        name: input.name,
        description: input.description,
        link: input.link,
        scheduleType: input.scheduleType,
        scheduleConfig: JSON.stringify(input.scheduleConfig),
        priority: input.priority,
      },
    })

    return NextResponse.json(template, { status: 201 })
  } catch (e) {
    return handleApiError('POST /api/templates', e)
  }
}
