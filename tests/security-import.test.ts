import { describe, it, expect } from 'vitest'
import { isSafeHttpUrl } from '../src/lib/safe-url'
import { taskCreateSchema, taskUpdateSchema, templateCreateSchema, pushSubscribeSchema } from '../src/lib/schemas'
import { validateProjectImport } from '../src/lib/import-project'

describe('validasi link', () => {
  it.each(['javascript:alert(1)', 'data:text/html,x', '//example.com', 'ftp://example.com', 'https://', 'bukan link'])('menolak %s', url => {
    expect(isSafeHttpUrl(url)).toBe(false)
    expect(taskCreateSchema.safeParse({name:'T',link:url}).success).toBe(false)
    expect(taskUpdateSchema.safeParse({link:url}).success).toBe(false)
    expect(templateCreateSchema.safeParse({name:'T',link:url}).success).toBe(false)
  })
  it.each(['https://example.com/path','http://example.com',' HTTPS://example.com '])('menerima %s', url => expect(isSafeHttpUrl(url)).toBe(true))
  it('mengizinkan link kosong', () => expect(taskCreateSchema.safeParse({name:'T',link:''}).success).toBe(true))
})

describe('validasi impor proyek', () => {
  const project = {name:'P',color:'#000080'}
  it('menerima export proyek normal', () => expect(validateProjectImport({project,tasks:[{name:'T',scheduleType:'harian',scheduleConfig:{}}]}).tasks).toHaveLength(1))
  it('menolak satu jadwal rusak dari banyak tugas', () => expect(() => validateProjectImport({project,tasks:[{name:'Baik'},{name:'Rusak',scheduleType:'jam_tertentu',scheduleConfig:{times:['29:01']}}]})).toThrow(/Tugas 2/))
  it('menolak link berbahaya pada impor', () => expect(() => validateProjectImport({project,tasks:[{name:'T',link:'javascript:alert(1)'}]})).toThrow(/Tugas 1/))
  it('menolak item null dengan jelas', () => expect(() => validateProjectImport({project,tasks:[null]})).toThrow(/Tugas 1/))
})

describe('keamanan endpoint push', () => {
  it.each(['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.attacker.example/x', 'https://fcm.googleapis.com:8443/x', 'https://user:pass@fcm.googleapis.com/x'])('menolak %s', url => {
    expect(pushSubscribeSchema.safeParse({endpoint:url, keys:{auth:'a',p256dh:'b'}}).success).toBe(false)
  })
  it.each(['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://abc.notify.windows.com/x'])('menerima %s', url => {
    expect(pushSubscribeSchema.safeParse({endpoint:url, keys:{auth:'a',p256dh:'b'}}).success).toBe(true)
  })
})
