import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { computeStatus, getNextReadyAt } from '@/lib/schedule'

// GET /api/init — combined initialization endpoint
// Fetches all app data in a single request to avoid multiple Vercel serverless cold starts.
// Optimized: selects only needed fields, strips logs array, uses minimal projection.
export async function GET() {
  try {
    const userId = await requireUser()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Fetch settings + user first (needed for timezone in task enrichment) ──
    const [userResult, settingsResult] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, displayName: true, role: true, settings: true },
      }).then((user) => {
        if (!user) return null
        let settings: Record<string, unknown> = {}
        try { settings = user.settings ? JSON.parse(user.settings) : {} } catch { /* use empty */ }
        return {
          userId: user.id, username: user.username, displayName: user.displayName, role: user.role, authenticated: true,
          timezone: (settings.timezone as string) || 'WIB',
        }
      }).catch((e) => {
        console.error('[GET /api/init] user fetch failed', e)
        return null
      }),
      // Settings will be extracted from userResult above; this placeholder keeps Promise.all happy
      Promise.resolve(null),
    ])

    // Extract timezone from user result
    const userTz = (userResult as Record<string, unknown> | null)?.timezone as string || 'WIB'

    // ── Fetch remaining data in parallel (tasks need timezone from above) ──
    const [tasksResult, projectsResult, settingsOnlyResult, notesResult, templatesResult] = await Promise.all([
      // ── Tasks — select ONLY needed fields ──
      db.task
        .findMany({
          where: { userId },
          select: {
            id: true, name: true, description: true, link: true,
            scheduleType: true, scheduleConfig: true, notes: true,
            pinned: true, priority: true, position: true,
            project: { select: { id: true, name: true, color: true } },
            logs: { select: { completedAt: true }, orderBy: { completedAt: 'desc' }, take: 1 },
            _count: { select: { logs: true } },
          },
          orderBy: { position: 'asc' },
        })
        .then((tasks) => {
          const now = Date.now()
          const enriched = tasks.map((t) => {
            try {
              const status = computeStatus(t, userTz)
              const nextReady = getNextReadyAt(t, userTz)
              const rawLastCompleted = t.logs.length > 0 ? t.logs[0].completedAt : null
              const lastCompleted = rawLastCompleted instanceof Date && !isNaN(rawLastCompleted.getTime()) ? rawLastCompleted : null

              let cooldownRemaining = ''
              let cooldownMs = 0
              if (status === 'cooldown' && nextReady) {
                const diff = nextReady.getTime() - now
                if (!isNaN(diff) && isFinite(diff)) {
                  cooldownMs = Math.max(0, diff)
                  const hours = Math.floor(diff / 3600000)
                  const mins = Math.floor((diff % 3600000) / 60000)
                  const secs = Math.floor((diff % 60000) / 1000)
                  if (hours > 0) cooldownRemaining = `${hours}j ${mins}m`
                  else if (mins > 0) cooldownRemaining = `${mins}m ${secs}s`
                  else cooldownRemaining = `${secs}s`
                }
              }

              return {
                id: t.id, name: t.name, description: t.description, link: t.link,
                scheduleType: t.scheduleType, scheduleConfig: t.scheduleConfig, notes: t.notes,
                pinned: t.pinned, priority: t.priority,
                status, nextReadyAt: nextReady instanceof Date && !isNaN(nextReady.getTime()) ? nextReady.toISOString() : null,
                lastCompletedAt: lastCompleted?.toISOString() || null,
                cooldownRemaining, cooldownMs, logCount: t._count.logs, project: t.project || null,
              }
            } catch (e) {
              console.error('[GET /api/init] task enrichment error for', t.id, e)
              return {
                id: t.id, name: t.name, description: t.description, link: t.link,
                scheduleType: t.scheduleType, scheduleConfig: t.scheduleConfig, notes: t.notes,
                pinned: t.pinned, priority: t.priority,
                status: 'siap' as const, nextReadyAt: null, lastCompletedAt: null,
                cooldownRemaining: '', cooldownMs: 0, logCount: t._count.logs, project: t.project || null,
              }
            }
          })

          return enriched.sort((a, b) => {
            if (a.status !== b.status) {
              const order = { siap: 0, cooldown: 1, selesai: 2 }
              return (order[a.status] ?? 9) - (order[b.status] ?? 9)
            }
            if (a.status === 'cooldown' && b.status === 'cooldown') {
              return (a.nextReadyAt || '').localeCompare(b.nextReadyAt || '')
            }
            if (a.pinned !== b.pinned) return b.pinned ? 1 : -1
            const prioOrder = { high: 0, medium: 1, low: 2 }
            const ap = prioOrder[a.priority as string] ?? 1
            const bp = prioOrder[b.priority as string] ?? 1
            if (ap !== bp) return ap - bp
            return 0
          })
        })
        .catch((e) => {
          console.error('[GET /api/init] tasks fetch failed', e)
          return null
        }),

      // ── Projects ──
      db.project.findMany({
        where: { userId },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, color: true, _count: { select: { tasks: true } } },
      }).catch((e) => {
        console.error('[GET /api/init] projects fetch failed', e)
        return null
      }),

      // ── Settings (fetched again for clean response — user query already has it) ──
      db.user.findUnique({ where: { id: userId }, select: { settings: true } })
        .then((user) => {
          try { return user?.settings ? JSON.parse(user.settings) : {} } catch { return {} }
        })
        .catch((e) => {
          console.error('[GET /api/init] settings fetch failed', e)
          return null
        }),

      // ── Notes ──
      db.note.findMany({
        where: { userId },
        select: { id: true, content: true, color: true, pinned: true, createdAt: true, updatedAt: true },
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      }).catch((e) => {
        console.error('[GET /api/init] notes fetch failed', e)
        return null
      }),

      // ── Templates ──
      db.taskTemplate.findMany({
        where: { userId },
        select: { id: true, name: true, description: true, link: true, scheduleType: true, scheduleConfig: true, priority: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'desc' },
      }).catch((e) => {
        console.error('[GET /api/init] templates fetch failed', e)
        return null
      }),
    ])

    // Build user response without internal timezone field
    const userResponse = userResult ? {
      userId: (userResult as Record<string, unknown>).userId,
      username: (userResult as Record<string, unknown>).username,
      displayName: (userResult as Record<string, unknown>).displayName,
      role: (userResult as Record<string, unknown>).role,
      authenticated: true,
    } : null

    const response = NextResponse.json({
      user: userResponse,
      tasks: tasksResult ?? [],
      projects: projectsResult ?? [],
      settings: settingsOnlyResult ?? {},
      notes: notesResult ?? [],
      templates: templatesResult ?? [],
    })

    response.headers.set('Cache-Control', 'private, max-age=0, must-revalidate')
    return response
  } catch (e) {
    console.error('[GET /api/init] unexpected error', e)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
