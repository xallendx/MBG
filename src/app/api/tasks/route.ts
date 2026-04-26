import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { getNextReadyAt, computeStatus } from '@/lib/schedule'

export async function GET() {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const tasks = await db.task.findMany({
      where: { userId },
      include: {
        project: true,
        logs: { orderBy: { completedAt: 'desc' } }
      },
      orderBy: { position: 'asc' }
    })

    const enriched = tasks.map(t => {
      const status = computeStatus(t)
      const nextReady = getNextReadyAt(t)
      const lastCompleted = t.logs.length > 0 ? t.logs[0].completedAt : null
      let cooldownRemaining = ''
      if (status === 'cooldown' && nextReady) {
        const diff = nextReady.getTime() - Date.now()
        const hours = Math.floor(diff / 3600000)
        const mins = Math.floor((diff % 3600000) / 60000)
        const secs = Math.floor((diff % 60000) / 1000)
        if (hours > 0) cooldownRemaining = `${hours}j ${mins}m`
        else if (mins > 0) cooldownRemaining = `${mins}m ${secs}s`
        else cooldownRemaining = `${secs}s`
      }
      const cooldownMs = status === 'cooldown' && nextReady ? Math.max(0, nextReady.getTime() - Date.now()) : 0
      return {
        ...t,
        status,
        nextReadyAt: nextReady?.toISOString() || null,
        lastCompletedAt: lastCompleted?.toISOString() || null,
        cooldownRemaining,
        cooldownMs,
        logCount: t.logs.length,
        project: t.project ? { id: t.project.id, name: t.project.name, color: t.project.color } : null
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
  } catch {
    return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 })
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

    const maxPos = await db.task.findFirst({
      where: { userId },
      orderBy: { position: 'desc' },
      select: { position: true }
    })

    const task = await db.task.create({
      data: {
        userId,
        name: name.trim(),
        description: description?.trim() || null,
        link: link?.trim() || null,
        scheduleType: scheduleType || 'sekali',
        scheduleConfig: JSON.stringify(scheduleConfig || {}),
        projectId: projectId || null,
        pinned: pinned || false,
        priority: priority || 'medium',
        position: (maxPos?.position || 0) + 1
      },
      include: { project: true }
    })

    return NextResponse.json(task, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 })
  }
}
