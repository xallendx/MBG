import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function GET() {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [tasks, projects] = await Promise.all([
      db.task.findMany({
        where: { userId },
        include: {
          project: { select: { id: true, name: true, color: true } },
          logs: { orderBy: { completedAt: 'desc' } }
        },
        orderBy: { position: 'asc' }
      }),
      db.project.findMany({
        where: { userId },
        orderBy: { position: 'asc' }
      })
    ])

    const user = await db.user.findUnique({ where: { id: userId } })
    let settings: Record<string, unknown> = {}
    try { settings = user?.settings ? JSON.parse(user.settings) : {} } catch { settings = {} }

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      projects: projects.map(p => ({ id: p.id, name: p.name, color: p.color, position: p.position })),
      tasks: tasks.map(t => {
        let config: Record<string, unknown> = {}
        try { config = JSON.parse(t.scheduleConfig) } catch { config = {} }
        return {
          id: t.id, name: t.name, description: t.description, link: t.link,
          scheduleType: t.scheduleType, scheduleConfig: config,
          notes: t.notes, pinned: t.pinned, priority: t.priority, position: t.position,
          project: t.project ? { name: t.project.name, color: t.project.color } : null,
          logs: t.logs.map(l => ({ completedAt: l.completedAt.toISOString() }))
        }
      })
    }

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="mbg-backup-${new Date().toISOString().slice(0, 10)}.json"`
      }
    })
  } catch {
    return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 })
  }
}
