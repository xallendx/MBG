import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

// POST /api/share/[code]/import — Import shared project to current user
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await params
  if (!code || code.length !== 6) {
    return NextResponse.json({ error: 'Kode tidak valid' }, { status: 400 })
  }

  const shared = await db.sharedProject.findUnique({ where: { code } })
  if (!shared) return NextResponse.json({ error: 'Kode tidak ditemukan' }, { status: 404 })

  let data: { project: { name: string; color: string }; tasks: any[] }
  try {
    data = JSON.parse(shared.projectData)
  } catch {
    return NextResponse.json({ error: 'Data tidak valid' }, { status: 500 })
  }

  // Create project for current user
  const maxPos = await db.project.findFirst({
    where: { userId },
    orderBy: { position: 'desc' },
    select: { position: true }
  })

  const project = await db.project.create({
    data: {
      userId,
      name: data.project.name,
      color: data.project.color || '#000080',
      position: (maxPos?.position || 0) + 1
    }
  })

  // Create tasks
  let importedTasks = 0
  if (Array.isArray(data.tasks)) {
    for (const t of data.tasks) {
      if (!t.name?.trim()) continue
      let config = {}
      try { config = typeof t.scheduleConfig === 'string' ? JSON.parse(t.scheduleConfig) : (t.scheduleConfig || {}) } catch { /* skip */ }
      await db.task.create({
        data: {
          userId,
          projectId: project.id,
          name: t.name.trim(),
          description: t.description || null,
          link: t.link || null,
          scheduleType: t.scheduleType || 'sekali',
          scheduleConfig: JSON.stringify(config),
          notes: t.notes || null,
          pinned: t.pinned || false,
          priority: t.priority || 'medium'
        }
      })
      importedTasks++
    }
  }

  return NextResponse.json({
    success: true,
    projectName: project.name,
    projectId: project.id,
    taskCount: importedTasks
  })
}
