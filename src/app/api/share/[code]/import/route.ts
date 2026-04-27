import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

// POST /api/share/[code]/import — Import shared project to current user
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
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

    if (!data.project?.name || !Array.isArray(data.tasks)) {
      return NextResponse.json({ error: 'Format data tidak valid' }, { status: 400 })
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
        name: data.project.name.slice(0, 200),
        color: /^#[0-9A-Fa-f]{3,8}$/.test(data.project.color) ? data.project.color : '#000080',
        position: (maxPos?.position || 0) + 1
      }
    })

    // Create tasks
    let importedTasks = 0
    const VALID_SCHEDULE_TYPES = ['sekali', 'harian', 'mingguan', 'jam_tertentu', 'tanggal_spesifik', 'kustom']
    const VALID_PRIORITIES = ['high', 'medium', 'low']

    if (Array.isArray(data.tasks)) {
      for (const t of data.tasks) {
        if (!t.name?.trim() || t.name.length > 200) continue
        let config = {}
        try { config = typeof t.scheduleConfig === 'string' ? JSON.parse(t.scheduleConfig) : (t.scheduleConfig || {}) } catch { /* skip */ }
        await db.task.create({
          data: {
            userId,
            projectId: project.id,
            name: t.name.trim(),
            description: typeof t.description === 'string' ? t.description.trim().slice(0, 5000) || null : null,
            link: typeof t.link === 'string' ? t.link.trim().slice(0, 2000) || null : null,
            scheduleType: VALID_SCHEDULE_TYPES.includes(t.scheduleType) ? t.scheduleType : 'sekali',
            scheduleConfig: JSON.stringify(config),
            notes: typeof t.notes === 'string' ? t.notes.slice(0, 10000) || null : null,
            pinned: Boolean(t.pinned),
            priority: VALID_PRIORITIES.includes(t.priority) ? t.priority : 'medium'
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
  } catch (e) {
    console.error('Share import error:', e)
    return NextResponse.json({ error: 'Gagal mengimpor project' }, { status: 500 })
  }
}
