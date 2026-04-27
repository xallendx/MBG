import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const VALID_SCHEDULE_TYPES = ['sekali', 'harian', 'mingguan', 'jam_tertentu', 'tanggal_spesifik', 'kustom']
const VALID_PRIORITIES = ['high', 'medium', 'low']

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    const existing = await db.task.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const { name, description, link, scheduleType, scheduleConfig, projectId, pinned, notes, priority } = body

    if (name !== undefined && name.length > 200) {
      return NextResponse.json({ error: 'Nama maksimal 200 karakter' }, { status: 400 })
    }
    if (description !== undefined && description !== null && description.length > 5000) {
      return NextResponse.json({ error: 'Deskripsi maksimal 5000 karakter' }, { status: 400 })
    }
    if (link !== undefined && link !== null && link.length > 2000) {
      return NextResponse.json({ error: 'Link maksimal 2000 karakter' }, { status: 400 })
    }
    if (scheduleType !== undefined && !VALID_SCHEDULE_TYPES.includes(scheduleType)) {
      return NextResponse.json({ error: 'Tipe jadwal tidak valid' }, { status: 400 })
    }
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: 'Priority tidak valid' }, { status: 400 })
    }
    if (notes !== undefined && notes !== null && notes.length > 10000) {
      return NextResponse.json({ error: 'Catatan maksimal 10000 karakter' }, { status: 400 })
    }

    // Normalize scheduleConfig: accept both object and string
    let normalizedConfig: unknown = undefined
    if (scheduleConfig !== undefined) {
      if (typeof scheduleConfig === 'string') {
        try { normalizedConfig = JSON.parse(scheduleConfig) } catch { normalizedConfig = {} }
      } else {
        normalizedConfig = scheduleConfig
      }
    }

    const task = await db.task.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(link !== undefined && { link: link?.trim() || null }),
        ...(scheduleType !== undefined && { scheduleType }),
        ...(normalizedConfig !== undefined && { scheduleConfig: JSON.stringify(normalizedConfig) }),
        ...(projectId !== undefined && { projectId: projectId || null }),
        ...(pinned !== undefined && { pinned }),
        ...(priority !== undefined && { priority }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      include: { project: true }
    })

    return NextResponse.json(task)
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    const existing = await db.task.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await db.task.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
