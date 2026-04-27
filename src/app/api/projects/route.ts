import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const COLOR_RE = /^#[0-9A-Fa-f]{3,8}$/

export async function GET() {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const projects = await db.project.findMany({
      where: { userId },
      orderBy: { position: 'asc' },
      include: { _count: { select: { tasks: true } } }
    })

    return NextResponse.json(projects)
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUser()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { name, color } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: 'Nama wajib diisi' }, { status: 400 })
    if (name.length > 200) return NextResponse.json({ error: 'Nama maksimal 200 karakter' }, { status: 400 })
    if (color && !COLOR_RE.test(color)) return NextResponse.json({ error: 'Format warna tidak valid' }, { status: 400 })

    const maxPos = await db.project.findFirst({
      where: { userId },
      orderBy: { position: 'desc' },
      select: { position: true }
    })

    const project = await db.project.create({
      data: {
        userId,
        name: name.trim(),
        color: color || '#000080',
        position: (maxPos?.position || 0) + 1
      }
    })

    return NextResponse.json(project, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
