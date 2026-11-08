import { NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { ApiError, handleApiError, requireUserId } from '@/lib/api'
import { logWarn } from '@/lib/logger'
import { parseSettings } from '@/lib/settings'
import { PRIORITIES, SCHEDULE_TYPES, settingsUpdateSchema } from '@/lib/schemas'
import { isSafeHttpUrl } from '@/lib/safe-url'
import { scheduleInputError } from '@/lib/schedule-input'

/** Hanya key pengaturan ini yang boleh masuk lewat import (whitelist). */
const ALLOWED_IMPORT_SETTINGS = [
  'timezone',
  'timeFormat',
  'autoExpandSiap',
  'autoCompleteLink',
  'browserNotifEnabled',
  'audioAlertEnabled',
  'pomodoroDuration',
]

const MAX_IMPORT_BYTES = 5_000_000

const COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/

type ImportTask = {
  name?: unknown
  description?: unknown
  link?: unknown
  scheduleType?: unknown
  scheduleConfig?: unknown
  notes?: unknown
  pinned?: unknown
  priority?: unknown
  project?: { id?: unknown; name?: unknown } | null
  logs?: { completedAt?: unknown }[]
}

const asText = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) || null : null

// POST /api/import — impor backup JSON (project, task, log, pengaturan)
export async function POST(req: Request) {
  try {
    const userId = await requireUserId()

    const contentLength = Number(req.headers.get('content-length') ?? 0)
    if (contentLength > MAX_IMPORT_BYTES) {
      throw new ApiError(413, 'File terlalu besar (maksimal 5MB)', 'PAYLOAD_TOO_LARGE')
    }

    let data: {
      projects?: { id?: unknown; name?: unknown; color?: unknown; position?: unknown }[]
      tasks?: ImportTask[]
      settings?: Record<string, unknown>
    }
    try {
      const text = await req.text()
      if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new ApiError(413, 'File terlalu besar (maksimal 5MB)', 'PAYLOAD_TOO_LARGE')
      data = JSON.parse(text)
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new ApiError(400, 'File JSON tidak valid', 'INVALID_JSON')
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) {
      throw new ApiError(400, 'Format file tidak valid (tasks tidak ditemukan)', 'INVALID_FORMAT')
    }

    const projectList = Array.isArray(data.projects) ? data.projects : []
    const taskList = data.tasks
    if (projectList.length > 5000 || taskList.length > 5000) throw new ApiError(413, 'Terlalu banyak item dalam satu impor', 'IMPORT_TOO_LARGE')
    if (projectList.some(p => !p || typeof p !== 'object' || Array.isArray(p)) || taskList.some(t => !t || typeof t !== 'object' || Array.isArray(t))) throw new ApiError(400, 'Item dalam backup tidak valid', 'INVALID_FORMAT')

    // Muat dulu semua nama yang sudah ada → hindari query per item (N+1)
    const [existingProjects, existingTasks, maxTaskPos, user] = await Promise.all([
      db.project.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      db.task.findMany({ where: { userId }, select: { name: true, projectId: true } }),
      db.task.findFirst({
        where: { userId },
        orderBy: { position: 'desc' },
        select: { position: true },
      }),
      db.user.findUnique({ where: { id: userId }, select: { settings: true } }),
    ])

    // Match existing projects by name AND multiplicity, and map backup IDs
    // to new IDs so projects with the same name remain distinct.
    const projectIdByName = new Map<string, string>()
    const importedProjectId = (sourceId: string) => 'imp_' + createHash('sha256').update(JSON.stringify([userId, sourceId])).digest('hex').slice(0, 32)
    const reservedIds = new Set(projectList.flatMap(p => typeof p.id === 'string' ? [importedProjectId(p.id)] : []))
    const existingIdSet = new Set(existingProjects.map(p => p.id))
    const existingByName = new Map<string, string[]>()
    for (const project of existingProjects) {
      if (!projectIdByName.has(project.name)) projectIdByName.set(project.name, project.id)
      const ids = existingByName.get(project.name) ?? []
      if (!reservedIds.has(project.id)) ids.push(project.id)
      existingByName.set(project.name, ids)
    }
    const projectIdBySourceId = new Map<string, string>()
    const newProjects: { id: string; name: string; color: string; position: number }[] = []
    for (const p of projectList) {
      const name = typeof p.name === 'string' ? p.name.trim() : ''
      if (!name || name.length > 200) continue
      const sourceId = typeof p.id === 'string' ? p.id : null
      if (sourceId && projectIdBySourceId.has(sourceId)) throw new ApiError(400, 'ID proyek duplikat dalam backup', 'INVALID_FORMAT')
      const available = existingByName.get(name)
      const stableId = sourceId ? importedProjectId(sourceId) : null
      let id = stableId && existingIdSet.has(stableId) ? stableId : available?.shift()
      if (!id) {
        id = stableId ?? randomUUID()
        newProjects.push({ id, name, color: typeof p.color === 'string' && COLOR_RE.test(p.color) ? p.color : '#000080', position: Number.isInteger(p.position) && Number(p.position) >= 0 && Number(p.position) <= 100000 ? Number(p.position) : 0 })
      }
      if (!projectIdByName.has(name)) projectIdByName.set(name, id)
      if (sourceId) projectIdBySourceId.set(sourceId, id)
    }
    // Match task multiplicities within the mapped project, not by name alone.
    const taskKey = (name: string, projectId: string | null) => JSON.stringify([projectId, name])
    const remainingExisting = new Map<string, number>()
    for (const task of existingTasks) {
      const key = taskKey(task.name, task.projectId)
      remainingExisting.set(key, (remainingExisting.get(key) ?? 0) + 1)
    }

    const newTasks: {
      id: string
      name: string
      description: string | null
      link: string | null
      scheduleType: string
      scheduleConfig: string
      notes: string | null
      pinned: boolean
      priority: string
      position: number
      projectId: string | null
      logs: string[]
    }[] = []

    let skipped = 0
    let pos = (maxTaskPos?.position ?? 0) + 1

    for (const t of taskList) {
      const name = typeof t.name === 'string' ? t.name.trim() : ''
      if (!name || name.length > 200) { skipped++; continue }
      const projectName = typeof t.project?.name === 'string' ? t.project.name.trim() : null
      const sourceProjectId = typeof t.project?.id === 'string' ? t.project.id : null
      const projectId = (sourceProjectId ? projectIdBySourceId.get(sourceProjectId) : undefined) ?? (projectName ? projectIdByName.get(projectName) : undefined) ?? null
      const key = taskKey(name, projectId)
      const available = remainingExisting.get(key) ?? 0
      if (available > 0) { remainingExisting.set(key, available - 1); skipped++; continue }

      const scheduleType =
        typeof t.scheduleType === 'string' &&
        (SCHEDULE_TYPES as readonly string[]).includes(t.scheduleType)
          ? t.scheduleType
          : 'sekali'
      const priority =
        typeof t.priority === 'string' && (PRIORITIES as readonly string[]).includes(t.priority)
          ? t.priority
          : 'medium'

      let scheduleConfig = '{}'
      try {
        scheduleConfig = JSON.stringify(
          typeof t.scheduleConfig === 'string' ? JSON.parse(t.scheduleConfig) : t.scheduleConfig || {}
        )
      } catch {
        throw new ApiError(400, `Jadwal tugas "${name}" tidak valid`, 'INVALID_SCHEDULE')
      }

      const link = asText(t.link, 2000)
      if (link && !isSafeHttpUrl(link)) throw new ApiError(400, `Link tugas "${name}" tidak valid; gunakan HTTP atau HTTPS`, 'INVALID_LINK')
      const configObject = JSON.parse(scheduleConfig)
      if (!configObject || typeof configObject !== 'object' || Array.isArray(configObject)) throw new ApiError(400, `Jadwal tugas "${name}" tidak valid`, 'INVALID_SCHEDULE')
      const scheduleError = scheduleInputError(scheduleType, configObject)
      if (scheduleError) throw new ApiError(400, `Jadwal tugas "${name}": ${scheduleError}`, 'INVALID_SCHEDULE')
      const logs = Array.isArray(t.logs)
        ? t.logs
            .map(l => (l?.completedAt ? new Date(String(l.completedAt)) : null))
            .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
            .map(d => d.toISOString())
        : []

      newTasks.push({
        id: randomUUID(),
        name,
        description: asText(t.description, 5000),
        link,
        scheduleType,
        scheduleConfig,
        notes: asText(t.notes, 10000),
        pinned: Boolean(t.pinned),
        priority,
        position: pos++,
        projectId,
        logs,
      })
    }

    // ── Simpan semuanya dalam satu transaksi (all-or-nothing) ───────────────
    const result = await db.$transaction(async tx => {
      if (newProjects.length > 0) {
        await tx.project.createMany({ data: newProjects.map(p => ({ ...p, userId })) })
      }

      let importedTasks = 0
      if (newTasks.length > 0) {
        await tx.task.createMany({
          data: newTasks.map(t => ({
            id: t.id,
            userId,
            name: t.name,
            description: t.description,
            link: t.link,
            scheduleType: t.scheduleType,
            scheduleConfig: t.scheduleConfig,
            notes: t.notes,
            pinned: t.pinned,
            priority: t.priority,
            position: t.position,
            projectId: t.projectId,
          })),
        })
        importedTasks = newTasks.length

        // IDs are generated per row; same-name tasks cannot receive each other's logs.
        const logRows = newTasks.flatMap(t => t.logs.map(iso => ({ taskId: t.id, completedAt: new Date(iso) })))
        if (logRows.length > 0) await tx.taskLog.createMany({ data: logRows })
      }

      // Gabungkan pengaturan — hanya key whitelist yang boleh berubah
      const current = parseSettings(user?.settings, 'POST /api/import')
      if (data.settings && typeof data.settings === 'object') {
        const sanitized: Record<string, unknown> = {}
        for (const key of ALLOWED_IMPORT_SETTINGS) {
          if (key in data.settings) sanitized[key] = data.settings[key]
        }
        if (Object.keys(sanitized).length && !settingsUpdateSchema.safeParse(sanitized).success) throw new ApiError(400, 'Pengaturan dalam backup tidak valid', 'INVALID_SETTINGS')
        await tx.user.update({
          where: { id: userId },
          data: { settings: JSON.stringify({ ...current, ...sanitized }) },
        })
      }

      return { projects: newProjects.length, tasks: importedTasks }
    })

    if (skipped > 0) {
      logWarn('POST /api/import', 'item dilewati saat impor', { userId, skipped })
    }

    return NextResponse.json({
      success: true,
      imported: { projects: result.projects, tasks: result.tasks, skipped },
    })
  } catch (e) {
    return handleApiError('POST /api/import', e)
  }
}
