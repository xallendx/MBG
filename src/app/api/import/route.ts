import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const data = await req.json()
    if (!data.projects || !data.tasks) {
      return NextResponse.json({ error: 'Format file tidak valid' }, { status: 400 })
    }

    let projectCount = 0
    let taskCount = 0

    // Import projects
    const projectIdMap: Record<string, string> = {}
    if (Array.isArray(data.projects)) {
      for (const p of data.projects) {
        if (!p.name?.trim()) continue
        const existing = await db.project.findFirst({ where: { userId, name: p.name } })
        if (existing) {
          projectIdMap[p.id] = existing.id
          projectCount++
          continue
        }
        const created = await db.project.create({
          data: {
            userId,
            name: p.name.trim(),
            color: p.color || '#000080',
            position: p.position || 0
          }
        })
        projectIdMap[p.id] = created.id
        projectCount++
      }
    }

    // Import tasks
    if (Array.isArray(data.tasks)) {
      const maxPos = await db.task.findFirst({
        where: { userId },
        orderBy: { position: 'desc' },
        select: { position: true }
      })

      for (const t of data.tasks) {
        if (!t.name?.trim()) continue
        const existing = await db.task.findFirst({ where: { userId, name: t.name } })
        if (existing) {
          taskCount++
          continue // skip duplicate names
        }

        const newProjectId = t.project?.name
          ? (await db.project.findFirst({ where: { userId, name: t.project.name } }))?.id || null
          : null

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
            position: ((maxPos?.position || 0) + taskCount + 1),
            projectId: newProjectId,
            logs: {
              create: (t.logs || []).map((l: { completedAt: string }) => ({
                completedAt: new Date(l.completedAt)
              }))
            }
          }
        })
        taskCount++
      }
    }

    // Import settings
    if (data.settings && typeof data.settings === 'object') {
      const user = await db.user.findUnique({ where: { id: userId } })
      const current = user?.settings ? JSON.parse(user.settings) : {}
      const merged = { ...current, ...data.settings }
      await db.user.update({
        where: { id: userId },
        data: { settings: JSON.stringify(merged) }
      })
    }

    return NextResponse.json({ success: true, imported: { projects: projectCount, tasks: taskCount } })
  } catch (e) {
    return NextResponse.json({ error: 'Gagal mengimpor data: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 })
  }
}
