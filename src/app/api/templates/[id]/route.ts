import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const VALID_SCHEDULE_TYPES = ['sekali', 'harian', 'mingguan', 'jam_tertentu', 'tanggal_spesifik', 'kustom']
const VALID_PRIORITIES = ['high', 'medium', 'low']

// PUT /api/templates/[id] — update template
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    const existing = await db.taskTemplate.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const { name, description, link, scheduleType, scheduleConfig, priority } = body

    // Input validation
    if (name !== undefined) {
      if (!name?.trim()) return NextResponse.json({ error: 'Nama template wajib diisi' }, { status: 400 })
      if (name.length > 200) return NextResponse.json({ error: 'Nama maksimal 200 karakter' }, { status: 400 })
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

    const template = await db.taskTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(link !== undefined && { link: link?.trim() || null }),
        ...(scheduleType !== undefined && { scheduleType }),
        ...(scheduleConfig !== undefined && { scheduleConfig: typeof scheduleConfig === 'string' ? scheduleConfig : JSON.stringify(scheduleConfig || {}) }),
        ...(priority !== undefined && { priority }),
      }
    })

    return NextResponse.json(template)
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

// DELETE /api/templates/[id]
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    const existing = await db.taskTemplate.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await db.taskTemplate.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
