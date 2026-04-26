import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

export async function GET() {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const projects = await db.project.findMany({
    where: { userId },
    orderBy: { position: 'asc' },
    include: { _count: { select: { tasks: true } } }
  })

  return NextResponse.json(projects)
}

export async function POST(req: NextRequest) {
  const userId = await requireUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, color } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nama wajib diisi' }, { status: 400 })

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
}
