import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { handleApiError } from '@/lib/api'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    let logId: string | undefined
    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = await req.json().catch(() => null)
      if (!body || typeof body.logId !== 'string' || !body.logId.trim() || body.logId.length > 64) {
        return NextResponse.json({ error: 'ID penyelesaian tidak valid' }, { status: 400 })
      }
      logId = body.logId
    }
    const result = await db.$transaction(async tx => {
      // Serialize with completion and other undo calls for this user's task.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Task" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`
      if (!locked.length) return 'not_found'
      const target = logId
        ? await tx.taskLog.findFirst({ where: { id: logId, taskId: id }, select: { id: true } })
        : await tx.taskLog.findFirst({ where: { taskId: id }, orderBy: { completedAt: 'desc' }, select: { id: true } })
      if (!target) return 'no_log'
      await tx.taskLog.delete({ where: { id: target.id } })
      return 'ok'
    })
    if (result === 'not_found') return NextResponse.json({ error: 'Task tidak ditemukan' }, { status: 404 })
    if (result === 'no_log') return NextResponse.json({ error: 'Penyelesaian tidak ditemukan atau sudah dibatalkan' }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (e) {
    return handleApiError('POST /api/tasks/[id]/undo', e)
  }
}
