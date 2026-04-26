import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function GET() {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const templates = await db.taskTemplate.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  })

  return NextResponse.json(templates)
}

export async function POST(req: NextRequest) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, description, link, scheduleType, scheduleConfig, priority } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Nama template wajib diisi' }, { status: 400 })
  }

  const template = await db.taskTemplate.create({
    data: {
      userId,
      name: name.trim(),
      description: description?.trim() || null,
      link: link?.trim() || null,
      scheduleType: scheduleType || 'sekali',
      scheduleConfig: JSON.stringify(scheduleConfig || {}),
      priority: priority || 'medium',
    }
  })

  return NextResponse.json(template, { status: 201 })
}
