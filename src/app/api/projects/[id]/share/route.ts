import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const project = await db.project.findFirst({ where: { id, userId } })
  if (!project) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 404 })

  const tasks = await db.task.findMany({
    where: { projectId: project.id },
    select: { name: true, description: true, link: true, scheduleType: true, scheduleConfig: true, notes: true, pinned: true, priority: true }
  })

  const projectData = JSON.stringify({
    project: { name: project.name, color: project.color },
    tasks
  })

  let code = genCode()
  while (await db.sharedProject.findUnique({ where: { code } })) {
    code = genCode()
  }

  const shared = await db.sharedProject.create({
    data: { code, projectData, createdBy: userId }
  })

  return NextResponse.json({
    code: shared.code,
    taskCount: tasks.length
  })
}
