import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

// Whitelist of settings keys that can be imported
const ALLOWED_IMPORT_SETTINGS = [
  'timezone', 'timeFormat', 'autoExpandSiap', 'autoCompleteLink',
  'browserNotifEnabled', 'audioAlertEnabled', 'pomodoroDuration'
]

export async function POST(req: NextRequest) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Validate payload size (max 5MB)
    const contentLength = req.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > 5_000_000) {
      return NextResponse.json({ error: 'File terlalu besar (max 5MB)' }, { status: 413 })
    }

    const data = await req.json()
    if (!data.projects || !data.tasks) {
      return NextResponse.json({ error: 'Format file tidak valid' }, { status: 400 })
    }

    let projectCount = 0
    let taskCount = 0

    // Import projects
    const projectIdMap: Record<string, string> = {}
    if (Array.isArray(data.projects)) {
      for (const p of data.projects) {
        if (!p.name?.trim() || p.name.trim().length > 200) continue
        const existing = await db.project.findFirst({ where: { userId, name: p.name.trim() } })
        if (existing) {
          projectIdMap[p.id] = existing.id
          projectCount++
          continue
        }
        const created = await db.project.create({
          data: {
            userId,
            name: p.name.trim(),
            color: /^#[0-9A-Fa-f]{3,8}$/.test(p.color) ? p.color : '#000080',
            position: typeof p.position === 'number' ? p.position : 0
          }
        })
        projectIdMap[p.id] = created.id
        projectCount++
      }
    }

    // Import tasks
    if (Array.isArray(data.tasks)) {
      const maxPos = await db.task.findFirst({
        where: { userId },
        orderBy: { position: 'desc' },
        select: { position: true }
      })

      const VALID_SCHEDULE_TYPES = ['sekali', 'harian', 'mingguan', 'jam_tertentu', 'tanggal_spesifik', 'kustom']
      const VALID_PRIORITIES = ['high', 'medium', 'low']

      for (const t of data.tasks) {
        if (!t.name?.trim() || t.name.trim().length > 200) continue
        const taskName = t.name.trim()

        const existing = await db.task.findFirst({ where: { userId, name: taskName } })
        if (existing) {
          taskCount++
          continue // skip duplicate names
        }

        const scheduleType = VALID_SCHEDULE_TYPES.includes(t.scheduleType) ? t.scheduleType : 'sekali'
        const priority = VALID_PRIORITIES.includes(t.priority) ? t.priority : 'medium'

        const newProjectId = t.project?.name
          ? (await db.project.findFirst({ where: { userId, name: t.project.name } }))?.id || null
          : null

        await db.task.create({
          data: {
            userId,
            name: taskName,
            description: typeof t.description === 'string' ? t.description.trim().slice(0, 5000) || null : null,
            link: typeof t.link === 'string' ? t.link.trim().slice(0, 2000) || null : null,
            scheduleType,
            scheduleConfig: JSON.stringify(t.scheduleConfig || {}),
            notes: typeof t.notes === 'string' ? t.notes.slice(0, 10000) || null : null,
            pinned: Boolean(t.pinned),
            priority,
            position: ((maxPos?.position || 0) + taskCount + 1),
            projectId: newProjectId,
            logs: {
              create: (t.logs || []).map((l: { completedAt: string }) => ({
                completedAt: new Date(l.completedAt)
              }))
            }
          }
        })
        taskCount++
      }
    }

    // Import settings — WHITELISTED keys only (security fix)
    if (data.settings && typeof data.settings === 'object') {
      const user = await db.user.findUnique({ where: { id: userId } })
      const current = user?.settings ? JSON.parse(user.settings) : {}
      const sanitized: Record<string, unknown> = {}
      for (const key of ALLOWED_IMPORT_SETTINGS) {
        if (key in data.settings) sanitized[key] = data.settings[key]
      }
      const merged = { ...current, ...sanitized }
      await db.user.update({
        where: { id: userId },
        data: { settings: JSON.stringify(merged) }
      })
    }

    return NextResponse.json({ success: true, imported: { projects: projectCount, tasks: taskCount } })
  } catch (e) {
    console.error('Import failed:', e)
    return NextResponse.json({ error: 'Gagal mengimpor data' }, { status: 500 })
  }
}
