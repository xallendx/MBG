import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { computeStatus, getNextReadyAt } from '@/lib/schedule'

// GET /api/init — combined initialization endpoint
// Fetches all app data in a single request to avoid multiple Vercel serverless cold starts.
// Returns: { user, tasks, projects, settings, notes, templates }
export async function GET() {
  try {
    // Single auth check — requireUser returns userId or null
    const userId = await requireUser()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Fetch user identity + all data sections in parallel ──
    const [
      userResult,
      tasksResult,
      projectsResult,
      settingsResult,
      notesResult,
      templatesResult,
    ] = await Promise.all([
      // ── User identity (mirrors /api/identify) ──
      db.user
        .findUnique({
          where: { id: userId },
          select: { id: true, username: true, displayName: true, role: true },
        })
        .then((user) => {
          if (!user) return null
          return {
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            authenticated: true,
          }
        })
        .catch((e) => {
          console.error('[GET /api/init] user fetch failed', e)
          return null
        }),

      // ── Tasks (mirrors /api/tasks with full enrichment) ──
      db.task
        .findMany({
          where: { userId },
          include: {
            project: true,
            logs: { orderBy: { completedAt: 'desc' }, take: 1 },
            _count: { select: { logs: true } },
          },
          orderBy: { position: 'asc' },
        })
        .then((tasks) => {
          const enriched = tasks.map((t) => {
            try {
              const status = computeStatus(t)
              const nextReady = getNextReadyAt(t)
              const rawLastCompleted =
                t.logs.length > 0 ? t.logs[0].completedAt : null
              const lastCompleted =
                rawLastCompleted instanceof Date &&
                !isNaN(rawLastCompleted.getTime())
                  ? rawLastCompleted
                  : null

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

              const cooldownMs =
                status === 'cooldown' &&
                nextReady &&
                !isNaN(nextReady.getTime())
                  ? Math.max(0, nextReady.getTime() - Date.now())
                  : 0

              return {
                ...t,
                status,
                nextReadyAt:
                  nextReady instanceof Date && !isNaN(nextReady.getTime())
                    ? nextReady.toISOString()
                    : null,
                lastCompletedAt: lastCompleted?.toISOString() || null,
                cooldownRemaining,
                cooldownMs,
                logCount: t._count.logs,
                project: t.project
                  ? {
                      id: t.project.id,
                      name: t.project.name,
                      color: t.project.color,
                    }
                  : null,
              }
            } catch (e) {
              console.error(
                '[GET /api/init] task enrichment error for',
                t.id,
                e,
              )
              return {
                ...t,
                status: 'siap' as const,
                nextReadyAt: null,
                lastCompletedAt: null,
                cooldownRemaining: '',
                cooldownMs: 0,
                logCount: t._count.logs,
                project: t.project
                  ? {
                      id: t.project.id,
                      name: t.project.name,
                      color: t.project.color,
                    }
                  : null,
              }
            }
          })

          // Sort: siap → cooldown → selesai, then by nextReadyAt, pinned, priority, position
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
            return a.position - b.position
          })
        })
        .catch((e) => {
          console.error('[GET /api/init] tasks fetch failed', e)
          return null
        }),

      // ── Projects (mirrors /api/projects) ──
      db.project
        .findMany({
          where: { userId },
          orderBy: { position: 'asc' },
          include: { _count: { select: { tasks: true } } },
        })
        .catch((e) => {
          console.error('[GET /api/init] projects fetch failed', e)
          return null
        }),

      // ── Settings (mirrors /api/settings) ──
      db.user
        .findUnique({ where: { id: userId } })
        .then((user) => {
          let settings: Record<string, unknown> = {}
          try {
            settings = user?.settings ? JSON.parse(user.settings) : {}
          } catch {
            settings = {}
          }
          return settings
        })
        .catch((e) => {
          console.error('[GET /api/init] settings fetch failed', e)
          return null
        }),

      // ── Notes (mirrors /api/notes) ──
      db.note
        .findMany({
          where: { userId },
          orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
        })
        .catch((e) => {
          console.error('[GET /api/init] notes fetch failed', e)
          return null
        }),

      // ── Templates (mirrors /api/templates) ──
      db.taskTemplate
        .findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        })
        .catch((e) => {
          console.error('[GET /api/init] templates fetch failed', e)
          return null
        }),
    ])

    // ── Build response — each section is independent ──
    const response = NextResponse.json({
      user: userResult,
      tasks: tasksResult ?? [],
      projects: projectsResult ?? [],
      settings: settingsResult ?? {},
      notes: notesResult ?? [],
      templates: templatesResult ?? [],
    })

    // Cache-Control: private ensures CDN doesn't cache user-specific data,
    // must-revalidate ensures the client always checks for fresh data.
    response.headers.set(
      'Cache-Control',
      'private, max-age=0, must-revalidate',
    )

    return response
  } catch (e) {
    console.error('[GET /api/init] unexpected error', e)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
