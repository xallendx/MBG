import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    // Verify task ownership
    const task = await db.task.findFirst({ where: { id, userId } })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Find latest log, then delete it (wrapped in transaction for atomicity)
    const result = await db.$transaction(async (tx) => {
      const latestLog = await tx.taskLog.findFirst({
        where: { taskId: id },
        orderBy: { completedAt: 'desc' },
      })
      if (!latestLog) return null
      await tx.taskLog.delete({ where: { id: latestLog.id } })
      return true
    })

    if (!result) {
      return NextResponse.json({ error: 'No completion to undo' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to undo completion' }, { status: 500 })
  }
}
