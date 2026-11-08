import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, requireUserId } from '@/lib/api'
import { validateProjectImport } from '@/lib/import-project'
import { limitShareLookup } from '@/lib/share-rate-limit'

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const userId = await requireUserId()
    await limitShareLookup(req, userId)
    const { code } = await params
    if (!code || code.length !== 6) throw new ApiError(400, 'Kode tidak valid')
    const shared = await db.sharedProject.findUnique({ where: { code } })
    if (!shared) throw new ApiError(404, 'Kode tidak ditemukan')
    let raw: unknown
    try { raw = JSON.parse(shared.projectData) } catch { throw new ApiError(400, 'Data proyek tidak valid') }
    const input = validateProjectImport(raw)
    const project = await db.$transaction(async tx => {
      const max = await tx.project.findFirst({ where: { userId }, orderBy: { position: 'desc' }, select: { position: true } })
      const created = await tx.project.create({ data: { userId, name: input.name, color: input.color, position: (max?.position ?? 0) + 1 } })
      if (input.tasks.length) await tx.task.createMany({ data: input.tasks.map((t, i) => ({
        userId, projectId: created.id, name: t.name, description: t.description, link: t.link,
        scheduleType: t.scheduleType, scheduleConfig: JSON.stringify(t.scheduleConfig), notes: t.notes,
        pinned: t.pinned, priority: t.priority, position: i,
      })) })
      return created
    })
    return NextResponse.json({ success: true, projectName: project.name, projectId: project.id, taskCount: input.tasks.length })
  } catch (e) { return handleApiError('POST /api/share/[code]/import', e) }
}
