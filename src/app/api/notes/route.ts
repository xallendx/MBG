import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

// GET /api/notes — list all notes for user
export async function GET() {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const notes = await db.note.findMany({
    where: { userId },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }]
  })

  return NextResponse.json(notes)
}

// POST /api/notes — create note
export async function POST(req: Request) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { content, color } = body
    if (!content || !content.trim()) return NextResponse.json({ error: 'Content wajib diisi' }, { status: 400 })

    const note = await db.note.create({
      data: {
        userId,
        content: content.trim(),
        color: color || '#FFFFFF'
      }
    })

    return NextResponse.json(note)
  } catch {
    return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 })
  }
}
