import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { getNextReadyAt, computeStatus } from '@/lib/schedule'
import { ApiError, handleApiError, parseBody, requireUserId } from '@/lib/api'
import { taskCreateSchema } from '@/lib/schemas'
import { getTimezone } from '@/lib/settings'
import { scheduleInputError } from '@/lib/schedule-input'
import { matchesCreatedTask, taskRequestId, type TaskCreatePayload } from '@/lib/task-create-request'

export async function GET() {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch user settings for timezone
    const user = await db.user.findUnique({ where: { id: userId }, select: { settings: true } }).catch(() => null)
    const userTz = getTimezone(user?.settings, 'GET /api/tasks')

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
        // Task tetap ditampilkan (dengan status aman) tapi kegagalannya dicatat.
        handleApiError('enrich-task', e)
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
    return handleApiError('GET /api/tasks', e)
  }
}

export async function POST(req: NextRequest) {
  const ctx = 'POST /api/tasks'
  try {
    const userId = await requireUserId()
    const input = await parseBody(req, taskCreateSchema)
    const scheduleError = scheduleInputError(input.scheduleType, input.scheduleConfig)
    if (scheduleError) throw new ApiError(400, scheduleError, 'INVALID_SCHEDULE')

    const payload: TaskCreatePayload = {
      name: input.name,
      description: input.description,
      link: input.link,
      notes: input.notes,
      scheduleType: input.scheduleType,
      scheduleConfig: input.scheduleConfig,
      projectId: input.projectId,
      pinned: input.pinned,
      priority: input.priority,
    }
    // Tanpa clientRequestId (klien lama) tetap pakai cuid seperti sebelumnya.
    const requestId = input.clientRequestId ? taskRequestId(userId, input.clientRequestId) : null
    const createData = {
      ...(requestId ? { id: requestId } : {}),
      userId,
      ...payload,
      scheduleConfig: JSON.stringify(payload.scheduleConfig),
    }

    const create = async () => db.$transaction(async (tx) => {
      // Verifikasi kepemilikan project sebelum menulis (cegah task lintas user).
      if (payload.projectId) {
        const project = await tx.project.findFirst({ where: { id: payload.projectId, userId } })
        if (!project) throw new ApiError(404, 'Project tidak ditemukan', 'PROJECT_NOT_FOUND')
      }
      const maxPos = await tx.task.findFirst({
        where: { userId },
        orderBy: { position: 'desc' },
        select: { position: true },
      })
      return tx.task.create({
        data: { ...createData, position: (maxPos?.position || 0) + 1 },
        include: { project: true },
      })
    })

    try {
      const task = await create()
      return NextResponse.json(task, { status: 201 })
    } catch (e) {
      // Respons pertama bisa hilang di jaringan setelah DB commit. Retry dengan
      // kunci yang sama harus mengembalikan task yang sama, bukan membuat baru.
      // P2002 ditangani DI LUAR transaksi karena transaksi yang gagal sudah abort.
      if (!requestId || !(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e
      const existing = await db.task.findFirst({ where: { id: requestId, userId }, include: { project: true } })
      if (!existing) throw new ApiError(409, 'Kunci percobaan simpan bentrok. Muat ulang lalu coba lagi.', 'REQUEST_ID_CONFLICT')
      if (!matchesCreatedTask(existing, payload)) {
        throw new ApiError(409, 'Tugas dari percobaan ini sudah tersimpan dengan isi berbeda. Muat ulang daftar sebelum mengubahnya.', 'REQUEST_PAYLOAD_CONFLICT')
      }
      return NextResponse.json(existing, { status: 200 })
    }
  } catch (e) {
    return handleApiError(ctx, e)
  }
}
