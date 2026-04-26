import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await db.taskTemplate.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { name, description, link, scheduleType, scheduleConfig, priority } = body

  const template = await db.taskTemplate.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(link !== undefined && { link: link?.trim() || null }),
      ...(scheduleType !== undefined && { scheduleType }),
      ...(scheduleConfig !== undefined && { scheduleConfig: JSON.stringify(scheduleConfig) }),
      ...(priority !== undefined && { priority }),
    }
  })

  return NextResponse.json(template)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await db.taskTemplate.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.taskTemplate.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
