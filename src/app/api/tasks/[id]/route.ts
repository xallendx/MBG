import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await db.task.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { name, description, link, scheduleType, scheduleConfig, projectId, pinned, notes, priority } = body

  const task = await db.task.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(link !== undefined && { link: link?.trim() || null }),
      ...(scheduleType !== undefined && { scheduleType }),
      ...(scheduleConfig !== undefined && { scheduleConfig: JSON.stringify(scheduleConfig) }),
      ...(projectId !== undefined && { projectId: projectId || null }),
      ...(pinned !== undefined && { pinned }),
      ...(priority !== undefined && { priority }),
      ...(notes !== undefined && { notes: notes || null }),
    },
    include: { project: true }
  })

  return NextResponse.json(task)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await db.task.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.task.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
