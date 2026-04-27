import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/

// POST /api/projects/[id]/share — share project via code
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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
    let attempts = 0
    while (await db.sharedProject.findUnique({ where: { code } })) {
      code = genCode()
      attempts++
      if (attempts > 10) break // Prevent infinite loop
    }

    const shared = await db.sharedProject.create({
      data: { code, projectData, createdBy: userId }
    })

    return NextResponse.json({
      code: shared.code,
      taskCount: tasks.length
    })
  } catch (e) {
    console.error('Share project error:', e)
    return NextResponse.json({ error: 'Gagal membagikan project' }, { status: 500 })
  }
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}
