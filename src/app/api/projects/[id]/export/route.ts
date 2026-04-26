import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  // Verify project belongs to user
  const project = await db.project.findFirst({ where: { id, userId } })
  if (!project) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 })

  // Get tasks (without logs)
  const tasks = await db.task.findMany({
    where: { projectId: id, userId },
    orderBy: { position: 'asc' },
  })

  return NextResponse.json({
    project: {
      name: project.name,
      color: project.color,
      position: project.position,
    },
    tasks: tasks.map(t => ({
      name: t.name,
      description: t.description,
      link: t.link,
      scheduleType: t.scheduleType,
      scheduleConfig: JSON.parse(t.scheduleConfig),
      notes: t.notes,
      pinned: t.pinned,
      priority: t.priority,
      position: t.position,
    })),
  })
}
