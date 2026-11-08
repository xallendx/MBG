import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, requireUserId } from '@/lib/api'
import { validateProjectImport } from '@/lib/import-project'

export async function POST(req: Request) {
  try {
    const userId = await requireUserId()
    if (Number(req.headers.get('content-length') || 0) > 5_000_000) throw new ApiError(413, 'File terlalu besar (maksimal 5MB)')
    const text = await req.text()
    if (Buffer.byteLength(text, 'utf8') > 5_000_000) throw new ApiError(413, 'File terlalu besar (maksimal 5MB)')
    let raw: unknown
    try { raw = JSON.parse(text) } catch { throw new ApiError(400, 'File JSON tidak valid') }
    const input = validateProjectImport(raw)
    const obj = raw as Record<string, unknown>
    const targetProjectId = obj.targetProjectId
    if (targetProjectId != null && (typeof targetProjectId !== 'string' || targetProjectId.length > 64)) throw new ApiError(400, 'Target proyek tidak valid')
    const result = await db.$transaction(async tx => {
      let project
      if (targetProjectId) {
        project = await tx.project.findFirst({ where: { id: targetProjectId as string, userId } })
        if (!project) throw new ApiError(404, 'Target project tidak ditemukan')
      } else {
        const existing = await tx.project.findFirst({ where: { userId, name: input.name } })
        const max = await tx.project.findFirst({ where: { userId }, orderBy: { position: 'desc' }, select: { position: true } })
        project = await tx.project.create({ data: { userId, name: existing ? `${input.name} (imported)` : input.name, color: input.color, position: (max?.position ?? 0) + 1 } })
      }
      const max = await tx.task.findFirst({ where: { userId }, orderBy: { position: 'desc' }, select: { position: true } })
      if (input.tasks.length) await tx.task.createMany({ data: input.tasks.map((t, i) => ({
        userId, projectId: project.id, name: t.name, description: t.description, link: t.link,
        scheduleType: t.scheduleType, scheduleConfig: JSON.stringify(t.scheduleConfig), notes: t.notes,
        pinned: t.pinned, priority: t.priority, position: (max?.position ?? 0) + i + 1,
      })) })
      return { projectId: project.id, projectName: project.name, taskCount: input.tasks.length }
    })
    return NextResponse.json({ success: true, ...result })
  } catch (e) { return handleApiError('POST /api/projects/import', e) }
}
