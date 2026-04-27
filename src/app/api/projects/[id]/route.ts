import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    const existing = await db.project.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const { name, color } = body

    if (name !== undefined && name.length > 200) {
      return NextResponse.json({ error: 'Nama maksimal 200 karakter' }, { status: 400 })
    }
    if (color !== undefined && !COLOR_RE.test(color)) {
      return NextResponse.json({ error: 'Format warna tidak valid' }, { status: 400 })
    }

    const project = await db.project.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(color !== undefined && { color }),
      }
    })

    return NextResponse.json(project)
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    // Use interactive transaction: verify ownership, delete logs first, then tasks, then project
    // Explicit log deletion for reliability with pgbouncer transaction pooling
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.project.findFirst({ where: { id, userId } })
      if (!existing) return 'not_found'

      // Get task IDs in this project for explicit log cleanup
      const projectTasks = await tx.task.findMany({ where: { projectId: id }, select: { id: true } })
      if (projectTasks.length > 0) {
        const taskIds = projectTasks.map(t => t.id)
        // Explicitly delete logs first
        await tx.taskLog.deleteMany({ where: { taskId: { in: taskIds } } })
        // Then delete tasks
        await tx.task.deleteMany({ where: { projectId: id } })
      }
      // Finally delete the project
      await tx.project.delete({ where: { id } })
      return 'ok'
    })

    if (result === 'not_found') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[DELETE /api/projects/[id]]', e)
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
