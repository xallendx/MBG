import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

// PUT /api/notes/[id] — update note
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await db.note.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { content, color, pinned } = body

  const note = await db.note.update({
    where: { id },
    data: {
      ...(content !== undefined ? { content: content.trim() } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(pinned !== undefined ? { pinned } : {})
    }
  })

  return NextResponse.json(note)
}

// DELETE /api/notes/[id]
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await db.note.findFirst({ where: { id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.note.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
