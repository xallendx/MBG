import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { handleApiError, parseBody, requireUserId } from '@/lib/api'
import { noteCreateSchema } from '@/lib/schemas'

// GET /api/notes — daftar catatan milik user
export async function GET() {
  const ctx = 'GET /api/notes'
  try {
    const userId = await requireUserId()
    const notes = await db.note.findMany({
      where: { userId },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    })
    return NextResponse.json(notes)
  } catch (e) {
    return handleApiError(ctx, e)
  }
}

// POST /api/notes — buat catatan
export async function POST(req: Request) {
  const ctx = 'POST /api/notes'
  try {
    const userId = await requireUserId()
    const input = await parseBody(req, noteCreateSchema)

    const note = await db.note.create({
      data: {
        userId,
        content: input.content,
        color: input.color || '#FFFFFF',
      },
    })

    return NextResponse.json(note, { status: 201 })
  } catch (e) {
    return handleApiError(ctx, e)
  }
}
