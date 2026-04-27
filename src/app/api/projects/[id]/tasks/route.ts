import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const VALID_SCHEDULE_TYPES = ['sekali', 'harian', 'mingguan', 'jam_tertentu', 'tanggal_spesifik', 'kustom']
const COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/

// GET /api/projects/[id]/tasks — create task directly in project
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await req.json()
    const { name, link, scheduleType, scheduleConfig } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Task name is required' }, { status: 400 })
    }
    if (name.length > 200) {
      return NextResponse.json({ error: 'Nama task maksimal 200 karakter' }, { status: 400 })
    }
    if (link !== undefined && link !== null && link.length > 2000) {
      return NextResponse.json({ error: 'Link maksimal 2000 karakter' }, { status: 400 })
    }
    if (scheduleType && !VALID_SCHEDULE_TYPES.includes(scheduleType)) {
      return NextResponse.json({ error: 'Tipe jadwal tidak valid' }, { status: 400 })
    }

    // Verify project ownership
    const project = await db.project.findFirst({ where: { id, userId } })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Get max position
    const maxPos = await db.task.findFirst({
      where: { projectId: id },
      orderBy: { position: 'desc' },
      select: { position: true },
    })

    const task = await db.task.create({
      data: {
        projectId: id,
        userId,
        name: name.trim(),
        link: link?.trim() || null,
        scheduleType: scheduleType || 'sekali',
        scheduleConfig: typeof scheduleConfig === 'string' ? scheduleConfig : (scheduleConfig ? JSON.stringify(scheduleConfig) : '{}'),
        position: (maxPos?.position ?? -1) + 1,
      },
    })

    return NextResponse.json(task, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
