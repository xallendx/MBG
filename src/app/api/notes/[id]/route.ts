import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

// PUT /api/notes/[id] — update note
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await db.note.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const { content, color, pinned } = body

    // Input validation
    if (content !== undefined) {
      if (typeof content !== 'string') return NextResponse.json({ error: 'Content harus berupa teks' }, { status: 400 })
      if (content.trim().length === 0) return NextResponse.json({ error: 'Content tidak boleh kosong' }, { status: 400 })
      if (content.length > 10000) return NextResponse.json({ error: 'Content maksimal 10000 karakter' }, { status: 400 })
    }
    if (color !== undefined) {
      if (!/^#[0-9A-Fa-f]{3,8}$/.test(color)) return NextResponse.json({ error: 'Format warna tidak valid' }, { status: 400 })
    }
    if (pinned !== undefined && typeof pinned !== 'boolean') {
      return NextResponse.json({ error: 'Pinned harus berupa boolean' }, { status: 400 })
    }

    const note = await db.note.update({
      where: { id },
      data: {
        ...(content !== undefined ? { content: content.trim() } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(pinned !== undefined ? { pinned } : {})
      }
    })

    return NextResponse.json(note)
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

// DELETE /api/notes/[id]
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const existing = await db.note.findFirst({ where: { id, userId } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await db.note.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
