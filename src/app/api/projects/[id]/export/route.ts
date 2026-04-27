import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const VALID_SCHEDULE_TYPES = ['sekali', 'harian', 'mingguan', 'jam_tertentu', 'tanggal_spesifik', 'kustom']
const VALID_PRIORITIES = ['high', 'medium', 'low']

// GET /api/projects/[id]/export — export single project
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
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
      tasks: tasks.map(t => {
        let config: Record<string, unknown> = {}
        try { config = JSON.parse(t.scheduleConfig) } catch { /* skip */ }
        return {
          name: t.name,
          description: t.description,
          link: t.link,
          scheduleType: t.scheduleType,
          scheduleConfig: config,
          notes: t.notes,
          pinned: t.pinned,
          priority: t.priority,
          position: t.position,
        }
      }),
    })
  } catch {
    return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 })
  }
}
