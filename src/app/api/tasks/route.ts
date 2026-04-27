import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { getNextReadyAt, computeStatus } from '@/lib/schedule'

const VALID_SCHEDULE_TYPES = ['sekali', 'harian', 'mingguan', 'jam_tertentu', 'tanggal_spesifik', 'kustom']
const VALID_PRIORITIES = ['high', 'medium', 'low']
const COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/

export async function GET() {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch user settings for timezone
    const user = await db.user.findUnique({ where: { id: userId }, select: { settings: true } }).catch(() => null)
    let userTz = 'WIB'
    try { userTz = user?.settings ? (JSON.parse(user.settings).timezone as string) || 'WIB' : 'WIB' } catch { /* use default */ }

    const tasks = await db.task.findMany({
      where: { userId },
      include: {
        project: true,
        logs: { orderBy: { completedAt: 'desc' }, take: 1 },
        _count: { select: { logs: true } }
      },
      orderBy: { position: 'asc' }
    })

    const enriched = tasks.map(t => {
      try {
        const status = computeStatus(t, userTz)
        const nextReady = getNextReadyAt(t, userTz)
        const rawLastCompleted = t.logs.length > 0 ? t.logs[0].completedAt : null
        const lastCompleted = rawLastCompleted instanceof Date && !isNaN(rawLastCompleted.getTime()) ? rawLastCompleted : null
        let cooldownRemaining = ''
        if (status === 'cooldown' && nextReady) {
          const diff = nextReady.getTime() - Date.now()
          if (!isNaN(diff) && isFinite(diff)) {
            const hours = Math.floor(diff / 3600000)
            const mins = Math.floor((diff % 3600000) / 60000)
            const secs = Math.floor((diff % 60000) / 1000)
            if (hours > 0) cooldownRemaining = `${hours}j ${mins}m`
            else if (mins > 0) cooldownRemaining = `${mins}m ${secs}s`
            else cooldownRemaining = `${secs}s`
          }
        }
        const cooldownMs = status === 'cooldown' && nextReady && !isNaN(nextReady.getTime()) ? Math.max(0, nextReady.getTime() - Date.now()) : 0
        return {
          ...t,
          status,
          nextReadyAt: nextReady instanceof Date && !isNaN(nextReady.getTime()) ? nextReady.toISOString() : null,
          lastCompletedAt: lastCompleted?.toISOString() || null,
          cooldownRemaining,
          cooldownMs,
          logCount: t._count.logs,
          project: t.project ? { id: t.project.id, name: t.project.name, color: t.project.color } : null
        }
      } catch (e) {
        console.error('[enrichment error for task]', t.id, e)
        return {
          ...t,
          status: 'siap' as const,
          nextReadyAt: null,
          lastCompletedAt: null,
          cooldownRemaining: '',
          cooldownMs: 0,
          logCount: t._count.logs,
          project: t.project ? { id: t.project.id, name: t.project.name, color: t.project.color } : null
        }
      }
    })

    const sorted = enriched.sort((a, b) => {
      if (a.status !== b.status) {
        const order = { siap: 0, cooldown: 1, selesai: 2 }
        return (order[a.status] ?? 9) - (order[b.status] ?? 9)
      }
      if (a.status === 'cooldown' && b.status === 'cooldown') {
        return (a.nextReadyAt || '').localeCompare(b.nextReadyAt || '')
      }
      if (a.pinned !== b.pinned) return b.pinned ? 1 : -1
      // Sort by priority within same status/pinned group
      const prioOrder = { high: 0, medium: 1, low: 2 }
      const ap = prioOrder[a.priority as string] ?? 1
      const bp = prioOrder[b.priority as string] ?? 1
      if (ap !== bp) return ap - bp
      return a.position - b.position
    })

    return NextResponse.json(sorted)
  } catch (e) {
    console.error('[GET /api/tasks]', e)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, description, link, scheduleType, scheduleConfig, projectId, pinned, priority } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Nama task wajib diisi' }, { status: 400 })
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

    const maxPos = await db.task.findFirst({
      where: { userId },
      orderBy: { position: 'desc' },
      select: { position: true }
    })

    // Verify project ownership if projectId is provided
    if (projectId) {
      const project = await db.project.findFirst({ where: { id: projectId, userId } })
      if (!project) return NextResponse.json({ error: 'Project tidak ditemukan' }, { status: 400 })
    }

    // Normalize scheduleConfig: accept both object and string, always store as JSON string
    let config = scheduleConfig || {}
    if (typeof config === 'string') {
      try { config = JSON.parse(config) } catch { config = {} }
    }

    const task = await db.task.create({
      data: {
        userId,
        name: name.trim(),
        description: description?.trim() || null,
        link: link?.trim() || null,
        scheduleType: scheduleType || 'sekali',
        scheduleConfig: JSON.stringify(config),
        projectId: projectId || null,
        pinned: pinned || false,
        priority: priority || 'medium',
        position: (maxPos?.position || 0) + 1
      },
      include: { project: true }
    })

    return NextResponse.json(task, { status: 201 })
  } catch (e) {
    console.error('[POST /api/tasks]', e)
    return NextResponse.json({ error: 'Request failed', detail: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
