import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const VALID_SCHEDULE_TYPES = ['sekali', 'harian', 'mingguan', 'jam_tertentu', 'tanggal_spesifik', 'kustom']
const VALID_PRIORITIES = ['high', 'medium', 'low']

export async function GET() {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const templates = await db.taskTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(templates)
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, description, link, scheduleType, scheduleConfig, priority } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Nama template wajib diisi' }, { status: 400 })
    }
    if (name.length > 200) {
      return NextResponse.json({ error: 'Nama maksimal 200 karakter' }, { status: 400 })
    }
    if (description !== undefined && description !== null && description.length > 5000) {
      return NextResponse.json({ error: 'Deskripsi maksimal 5000 karakter' }, { status: 400 })
    }
    if (link !== undefined && link !== null && link.length > 2000) {
      return NextResponse.json({ error: 'Link maksimal 2000 karakter' }, { status: 400 })
    }
    if (scheduleType && !VALID_SCHEDULE_TYPES.includes(scheduleType)) {
      return NextResponse.json({ error: 'Tipe jadwal tidak valid' }, { status: 400 })
    }
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: 'Priority tidak valid' }, { status: 400 })
    }

    const template = await db.taskTemplate.create({
      data: {
        userId,
        name: name.trim(),
        description: description?.trim() || null,
        link: link?.trim() || null,
        scheduleType: scheduleType || 'sekali',
        scheduleConfig: typeof scheduleConfig === 'string' ? scheduleConfig : JSON.stringify(scheduleConfig || {}),
        priority: priority || 'medium',
      }
    })

    return NextResponse.json(template, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
