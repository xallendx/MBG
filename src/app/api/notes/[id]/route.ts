import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, handleApiError, parseBody, requireUserId } from '@/lib/api'
import { noteUpdateSchema } from '@/lib/schemas'

// PUT /api/notes/[id] — perbarui catatan
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = 'PUT /api/notes/[id]'
  try {
    const userId = await requireUserId()
    const { id } = await params

    const existing = await db.note.findFirst({ where: { id, userId } })
    if (!existing) throw new ApiError(404, 'Catatan tidak ditemukan', 'NOT_FOUND')

    const input = await parseBody(req, noteUpdateSchema)

    const note = await db.note.update({
      where: { id },
      data: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      },
    })

    return NextResponse.json(note)
  } catch (e) {
    return handleApiError(ctx, e)
  }
}

// DELETE /api/notes/[id]
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = 'DELETE /api/notes/[id]'
  try {
    const userId = await requireUserId()
    const { id } = await params

    const existing = await db.note.findFirst({ where: { id, userId } })
    if (!existing) throw new ApiError(404, 'Catatan tidak ditemukan', 'NOT_FOUND')

    await db.note.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    return handleApiError(ctx, e)
  }
}
