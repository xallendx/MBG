import { ApiError } from './api'
import { taskCreateSchema } from './schemas'
import { scheduleInputError } from './schedule-input'

/** Validate all items before writing anything, including imports from old share codes. */
export function validateProjectImport(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(400, 'Format proyek tidak valid', 'INVALID_FORMAT')
  const raw = data as Record<string, unknown>
  const project = raw.project && typeof raw.project === 'object' && !Array.isArray(raw.project) ? raw.project as Record<string, unknown> : null
  if (!project || typeof project.name !== 'string' || !project.name.trim() || project.name.trim().length > 200 || !Array.isArray(raw.tasks)) {
    throw new ApiError(400, 'Format tidak valid: butuh nama proyek dan daftar tugas', 'INVALID_FORMAT')
  }
  if (raw.tasks.length > 5000) throw new ApiError(413, 'Terlalu banyak tugas dalam satu impor', 'IMPORT_TOO_LARGE')
  const tasks = raw.tasks.map((item, i) => {
    const parsed = taskCreateSchema.safeParse(item)
    if (!parsed.success) throw new ApiError(400, `Tugas ${i + 1}: ${parsed.error.issues[0]?.message || 'data tidak valid'}`, 'INVALID_TASK')
    const error = scheduleInputError(parsed.data.scheduleType, parsed.data.scheduleConfig)
    if (error) throw new ApiError(400, `Tugas ${i + 1}: ${error}`, 'INVALID_SCHEDULE')
    return parsed.data
  })
  return {
    name: project.name.trim(),
    color: typeof project.color === 'string' && /^#[0-9A-Fa-f]{3,8}$/.test(project.color) ? project.color : '#000080',
    tasks,
  }
}
