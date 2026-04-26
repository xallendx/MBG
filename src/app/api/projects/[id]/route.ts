import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await db.project.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { name, color } = body

  const project = await db.project.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(color !== undefined && { color }),
    }
  })

  return NextResponse.json(project)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await db.project.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Delete all tasks belonging to this project, then delete the project
  await db.task.deleteMany({ where: { projectId: id } })
  await db.project.delete({ where: { id } })

  return NextResponse.json({ success: true })
}
