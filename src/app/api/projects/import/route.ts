import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await req.json()
    const { project: projectData, tasks: tasksData, targetProjectId } = data

    if (!projectData?.name || !Array.isArray(tasksData)) {
      return NextResponse.json({ error: 'Format tidak valid: butuh { project, tasks }' }, { status: 400 })
    }

    // If targetProjectId is provided, import tasks INTO that existing project
    if (targetProjectId) {
      const targetProject = await db.project.findFirst({ where: { id: targetProjectId, userId } })
      if (!targetProject) {
        return NextResponse.json({ error: 'Target project tidak ditemukan' }, { status: 404 })
      }

      let taskCount = 0
      const maxTaskPos = await db.task.findFirst({
        where: { userId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })

      for (const t of tasksData) {
        if (!t.name?.trim()) continue
        await db.task.create({
          data: {
            userId,
            name: t.name.trim(),
            description: t.description?.trim() || null,
            link: t.link?.trim() || null,
            scheduleType: t.scheduleType || 'sekali',
            scheduleConfig: JSON.stringify(t.scheduleConfig || {}),
            notes: t.notes || null,
            pinned: t.pinned || false,
            priority: t.priority || 'medium',
            position: (maxTaskPos?.position || 0) + taskCount + 1,
            projectId: targetProjectId,
          },
        })
        taskCount++
      }

      return NextResponse.json({
        success: true,
        projectId: targetProjectId,
        projectName: targetProject.name,
        taskCount,
      })
    }

    // No targetProjectId: create a new project (original behavior)
    let projectName = projectData.name.trim()
    const existing = await db.project.findFirst({ where: { userId, name: projectName } })
    if (existing) {
      projectName = `${projectName} (imported)`
    }

    const maxProjectPos = await db.project.findFirst({
      where: { userId },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    const newProject = await db.project.create({
      data: {
        userId,
        name: projectName,
        color: projectData.color || '#000080',
        position: (maxProjectPos?.position || 0) + 1,
      },
    })

    let taskCount = 0
    const maxTaskPos = await db.task.findFirst({
      where: { userId },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    for (const t of tasksData) {
      if (!t.name?.trim()) continue
      await db.task.create({
        data: {
          userId,
          name: t.name.trim(),
          description: t.description?.trim() || null,
          link: t.link?.trim() || null,
          scheduleType: t.scheduleType || 'sekali',
          scheduleConfig: JSON.stringify(t.scheduleConfig || {}),
          notes: t.notes || null,
          pinned: t.pinned || false,
          priority: t.priority || 'medium',
          position: (maxTaskPos?.position || 0) + taskCount + 1,
          projectId: newProject.id,
        },
      })
      taskCount++
    }

    return NextResponse.json({
      success: true,
      projectId: newProject.id,
      projectName,
      taskCount,
    })
  } catch (e) {
    return NextResponse.json({ error: 'Gagal import: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 })
  }
}
