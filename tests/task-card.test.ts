import { describe, expect, it } from 'vitest'
import { showProjectOnCard, taskCardActions, taskCardStatusText, type TaskCardInput } from '../src/lib/task-card'
import { NO_PROJECT_FILTER } from '../src/lib/task-view'

const task = (over: Partial<TaskCardInput> = {}): TaskCardInput => ({
  status: 'siap',
  link: null,
  cooldownRemaining: '',
  ...over,
})

describe('taskCardActions — satu aksi utama per kartu', () => {
  it('tugas siap dengan link aman → buka link sebagai aksi utama', () => {
    const a = taskCardActions(task({ link: 'https://example.com' }), false)
    expect(a.primary).toBe('open-link')
    expect(a.primaryLabel).toBe('Buka link ↗')
  })

  it('tanpa auto-selesai, tombol Selesai tetap tersedia sebagai aksi kedua', () => {
    expect(taskCardActions(task({ link: 'https://example.com' }), false).showComplete).toBe(true)
  })

  it('dengan auto-selesai, label berubah dan tombol Selesai ganda dihilangkan', () => {
    const a = taskCardActions(task({ link: 'https://example.com' }), true)
    expect(a.primaryLabel).toBe('Buka + selesai')
    expect(a.showComplete).toBe(false)
  })

  it('tugas siap tanpa link → langsung selesai', () => {
    const a = taskCardActions(task(), false)
    expect(a.primary).toBe('complete')
    expect(a.showComplete).toBe(false)
    expect(a.showLink).toBe(false)
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'bukan link', '//example.com'])(
    'link berbahaya %s tidak pernah jadi tombol buka link',
    link => {
      const a = taskCardActions(task({ link }), false)
      expect(a.primary).toBe('complete')
      expect(a.showLink).toBe(false)
    },
  )

  it('tugas menunggu tetap punya jalan membuka link, tapi aksi utamanya detail', () => {
    const a = taskCardActions(task({ status: 'cooldown', link: 'https://example.com' }), false)
    expect(a.primary).toBe('detail')
    expect(a.showLink).toBe(true)
    expect(a.showComplete).toBe(false)
  })

  it('tugas selesai tanpa link hanya menawarkan detail', () => {
    const a = taskCardActions(task({ status: 'selesai' }), false)
    expect(a.primary).toBe('detail')
    expect(a.showLink).toBe(false)
    expect(a.showComplete).toBe(false)
  })

  it('link berbahaya pada tugas menunggu tidak memunculkan tombol link', () => {
    expect(taskCardActions(task({ status: 'cooldown', link: 'javascript:alert(1)' }), false).showLink).toBe(false)
  })

  it('tugas selesai punya jalan batalkan selesai — tugas sekali tidak bisa di-reset', () => {
    const a = taskCardActions(task({ status: 'selesai' }), false)
    expect(a.showUndo).toBe(true)
  })

  it('tugas selesai berlink tetap menawarkan batalkan selesai dan buka link', () => {
    const a = taskCardActions(task({ status: 'selesai', link: 'https://example.com' }), false)
    expect(a.showUndo).toBe(true)
    expect(a.showLink).toBe(true)
  })

  it('tugas siap tidak menawarkan batalkan selesai', () => {
    expect(taskCardActions(task(), false).showUndo).toBe(false)
    expect(taskCardActions(task(), true).showUndo).toBe(false)
  })

  it('tugas menunggu memakai Reset, bukan batalkan selesai', () => {
    expect(taskCardActions(task({ status: 'cooldown' }), false).showUndo).toBe(false)
  })
})

describe('taskCardStatusText', () => {
  it('siap memakai kalimat yang sama dengan daftar lama', () => {
    expect(taskCardStatusText(task())).toEqual({ text: 'Siap sekarang', tone: 'siap' })
  })

  it('menunggu menampilkan sisa waktu apa adanya', () => {
    expect(taskCardStatusText(task({ status: 'cooldown', cooldownRemaining: '5 jam 12 menit' })))
      .toEqual({ text: '5 jam 12 menit', tone: 'cd' })
  })

  it.each(['', '   '])('sisa waktu kosong (%s) tidak membuat kartu tanpa status', empty => {
    expect(taskCardStatusText(task({ status: 'cooldown', cooldownRemaining: empty })))
      .toEqual({ text: 'Menunggu', tone: 'cd' })
  })

  it('selesai punya nada pudar', () => {
    expect(taskCardStatusText(task({ status: 'selesai' }))).toEqual({ text: 'Selesai', tone: 'done' })
  })
})

describe('showProjectOnCard', () => {
  it('gabungan semua proyek → chip proyek tampil', () => {
    expect(showProjectOnCard(null)).toBe(true)
    expect(showProjectOnCard(undefined)).toBe(true)
  })

  it('di dalam satu proyek → chip tidak diulang', () => {
    expect(showProjectOnCard('proj-a')).toBe(false)
  })

  it('filter tanpa proyek juga tidak perlu chip', () => {
    expect(showProjectOnCard(NO_PROJECT_FILTER)).toBe(false)
  })
})
