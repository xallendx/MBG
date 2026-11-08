# Perbaikan Fundamental — 3 P0 selesai & terverifikasi

Bukan rencana, bukan mockup. Semua di bawah ini **dijalankan dan dibuktikan**
di workspace: Postgres lokal, migration dari nol, test otomatis, mock Bot API
Telegram untuk membuktikan notifikasi benar-benar keluar dari server.

| # | Masalah fundamental | Status |
|---|---|---|
| P0-1 | Notifikasi mati kalau aplikasi ditutup | ✅ Selesai — terverifikasi terkirim tanpa browser |
| P0-2 | Tanpa migration & tanpa test | ✅ Selesai — migration + 23 test + CI |
| P0-3 | Rate limiter in-memory tidak berfungsi | ✅ Selesai — berbasis database, terverifikasi 429 |

Plus **1 bug produksi ditemukan oleh test baru** (detail di bagian bawah).

---

## P0-1 · Notifikasi sekarang jalan tanpa browser terbuka

### Yang diubah

| File | Perubahan |
|---|---|
| `src/lib/notify-sweep.ts` | **Baru.** Seluruh logika notifikasi dipindah dari route ke satu fungsi yang bisa dipanggil siapa saja |
| `src/app/api/cron/notify/route.ts` | **Baru.** Endpoint cron, dilindungi `CRON_SECRET` (fail closed kalau kosong) |
| `src/app/api/notify/run/route.ts` | Jadi tipis: memanggil sweep yang sama untuk user yang login (*catch-up*) |
| `vercel.json` | **Baru.** Jadwal cron 5 menit |
| `src/lib/telegram.ts` | Base URL Bot API bisa dioverride (`TELEGRAM_API_BASE`) — untuk mock test & proxy |
| `.env.example` | Menambah `CRON_SECRET` |

### Bukti

Dijalankan dengan mock Bot API lokal (merekam setiap pesan yang diterima):

```
$ curl localhost:3000/api/cron/notify                       # tanpa secret
401

$ curl -H "Authorization: Bearer …" localhost:3000/api/cron/notify
{"success":true,"usersChecked":1,"sent":3,"errors":0,"prunedRateLimits":0,"durationMs":49}

$ curl -H "Authorization: Bearer …" localhost:3000/api/cron/notify   # kedua kali
{"success":true,"usersChecked":1,"sent":0,...}               # idempoten
```

Pesan yang benar-benar diterima Bot API (3 task → 3 pesan, tanpa duplikat):

```
✅ Task Siap Dikerjakan! | 📋 [Monad Testnet] Test fitur baru dApp | 👤 Admin MBG
✅ Task Siap Dikerjakan! | 📋 [Monad Testnet] Swap di DEX testnet | 👤 Admin MBG
✅ Task Siap Dikerjakan! | 📋 [GenLayer Mainnet] Kirim notifikasi bukti (cron) | 👤 Admin MBG
```

**Idempotensi** dijamin dengan klaim atomik `updateMany` bersyarat pada kolom
`notifiedWarnAt` / `notifiedReadyAt`. Cron dan browser boleh berjalan bersamaan;
hanya satu yang menang dan benar-benar mengirim.

### Perbaikan tambahan yang muncul saat pengujian

Versi lama, saat aplikasi lama tertutup, mengirim **dua** pesan per task
("Hampir Siap — siap sekarang" lalu "Task Siap"). Hasil uji pertama:
`sent: 3` tapi **6 pesan** terkirim. Sekarang peringatan susulan itu dihapus,
hanya ditandai terkirim: **3 task → 3 pesan**. Nomor telepon tidak dibanjiri.

---

## P0-2 · Migration + test + CI

### Migration

- Folder `prisma/migrations/20260101000000_init/` dibuat dari schema (baseline),
  berisi 10 tabel termasuk `RateLimit`.
- Dibuktikan: database **di-drop lalu dibuat ulang dari nol** dengan
  `prisma migrate deploy` → semua tabel terbentuk.
- `README` diperbarui: pakai `migrate deploy`, **bukan** `db:push`, untuk produksi.

```bash
$ npx prisma migrate deploy
1 migration found in prisma/migrations
All migrations have been successfully applied.
```

### Test

`tests/schedule.test.ts` — **23 test**, semuanya lulus:

```
Test Files  1 passed (1)
     Tests  23 passed (23)
```

Yang dicakup: `sekali`, `harian`, `kustom`, `mingguan`, `jam_tertentu`,
`tanggal_spesifik`, perbedaan WIB/WITA, cooldown default, config JSON rusak,
log bertanggal invalid, dan `canReset`.

### CI

`.github/workflows/ci.yml` — Postgres service, lalu:
`prisma migrate deploy` → `tsc --noEmit` → `npm test` → `npm run build`.

### Tools pendukung (sekaligus memperbaiki onboarding)

- `scripts/seed-demo.mjs` + `npm run db:seed:demo` — data demo idempoten
  (admin, kode undangan, 4 project, 11 task, 2 catatan).
- `vitest.config.ts` — perlu override PostCSS karena `postcss.config.mjs`
  memakai plugin Tailwind v4 yang tidak dipahami Vite.

---

## P0-3 · Rate limit yang benar-benar berlaku

### Yang diubah

- `src/lib/rate-limit.ts` — **baru**. Satu statement atomik
  `INSERT … ON CONFLICT DO UPDATE` ke tabel `RateLimit`, sehingga hitungan
  konsisten lintas instance serverless dan tahan cold start.
- `login/route.ts` — batas **dua lapis**: per username (10/15 menit) dan per IP
  (30/15 menit). Hitungan per-username direset setelah login berhasil.
- `register/route.ts` — per kode undangan (5/15 menit) dan per IP (20/15 menit).
- Respons 429 menyertakan header `Retry-After` dan menit sisa yang bisa dibaca
  manusia, bukan pesan "coba lagi" tanpa angka.
- Pembersihan baris lama dijalankan dari endpoint cron (`pruneRateLimits`).

### Bukti

```
1..10  → 401 {"error":"Username atau password salah"}
11     → 429 {"error":"Terlalu banyak percobaan login. Coba lagi dalam 15 menit."}
12     → 429

$ psql -c 'select key, count from "RateLimit"'
 login:user:admin1 |    12
 login:ip:::1      |    12
```

Setelah baris dihapus, login yang benar kembali `200` — tidak ada state nyangkut
di memori proses.

---

## Bonus: satu bug produksi ditemukan oleh test

Test `tanggal_spesifik` dan `jam_tertentu` awalnya gagal dengan selisih
**+12 sampai +24 jam**. Penyebabnya nyata, bukan salah tulis test:

```js
// src/lib/schedule.ts (sebelum)
date.toLocaleString('en-US', { …, hour12: false })
// → "03/10/2026, 24:00:00"   ← jam 24, bukan 00
```

`hour12: false` di ICU Node menghasilkan `24:00:00` untuk tengah malam. Parser
regex di `getUtcOffsetMs` lalu menghitung offset **-16 jam** alih-alih +8,
sehingga "tengah malam pengguna" bergeser satu hari. Efeknya: task dengan jadwal
`jam_tertentu` / `mingguan` / `tanggal_spesifik` bisa muncul sehari lebih cepat
atau lebih lambat, tergantung jam berapa perhitungan terjadi.

Dua perbaikan:

1. `hourCycle: 'h23'` → selalu `00:00:00`.
2. `new Date(y, m, d)` → `Date.UTC(y, m, d)` agar hasilnya **tidak bergantung
   timezone server** (dulu hanya benar kalau server berjalan di UTC seperti Vercel;
   self-host di WIB/WITA akan salah).

Setelah perbaikan: **23/23 test lulus**.

---

## Status verifikasi akhir

```
npx tsc --noEmit    → bersih
npm test            → 23 passed
npm run build       → sukses (route /api/cron/notify ikut ter-build)
migrate deploy      → sukses dari database kosong
cron notify         → 401 tanpa secret, sent=3 dengan secret, sent=0 saat diulang
rate limit          → 429 pada percobaan ke-11
```

## Yang belum dikerjakan (P1/P2)

Masih terbuka, sesuai urutan di `AUDIT-FUNDAMENTAL.md`:

- **P1-4** react-query menggantikan cache refs manual (`page.tsx` masih 4.151 baris).
- **P1-5** validasi zod seragam di 40 route + mengganti 61 `catch {}`.
- **P1-6** menyatukan dua implementasi daftar task.
- **P2** settings sebagai JSON string, polling 60 detik menarik semua data,
  retensi TaskLog, share project JSON beku, observability, dependency zombie.

Catatan: rate limit per-username bisa disalahgunakan untuk mengunci akun orang
lain (DoS) — sama seperti kebanyakan sistem. Mitigasi lanjutan: hanya hitung
percobaan gagal, atau tambahkan captcha setelah beberapa kegagalan.

---

# Bagian 2 — Lapisan API, validasi, dan retensi (P1-5 + sebagian P2)

Bagian di atas adalah P0. Bagian ini menutup **P1-5** (validasi & penanganan
error) dan tiga item **P2** yang paling berdampak, plus satu regresi keamanan
data yang ditemukan saat mengerjakannya.

## Masalahnya (sebelum)

```ts
// pola yang dipakai di hampir semua route
const body = await req.json()                       // body rusak → 500, bukan 400
if (notifyBeforeCooldownMin && typeof x !== 'number') { /* dibuang diam-diam */ }
...
} catch {
  return NextResponse.json({ error: 'Request failed' }, { status: 500 })
}
```

Akibat nyata:

1. **Pesan error tidak konsisten** — sebagian Inggris (`Request failed`,
   `Unauthorized`), sebagian Indonesia, sebagian kosong. UI menampilkan apa pun
   yang ada di `error`, jadi user bisa menerima teks Inggris atau toast kosong.
2. **Kegagalan produksi tidak bisa dilacak** — `catch {}` membuang error beserta
   stacktrace-nya. Tidak ada route, tidak ada userId, tidak ada jejak sama sekali.
3. **Validasi tidak lengkap per route** — `templates`, `admin/*`, `push/subscribe`,
   `projects/[id]/tasks` masih memakai daftar `VALID_*` manual yang berbeda-beda,
   dan beberapa route tidak memvalidasi panjang string sama sekali.
4. **Body JSON rusak dijawab 500** — salah user, salah server; bisa memicu alert
   palsu dan retry yang tidak perlu.
5. **Pengaturan user diam-diam tidak tersimpan** — nilai yang tipenya salah
   (`"5"` alih-alih `5`) dibuang tanpa pesan, sementara UI sudah menampilkan toast
   "Disimpan!".

## Yang dikerjakan

Tiga modul baru sebagai satu pintu:

| File | Isi |
|---|---|
| `src/lib/logger.ts` | log JSON satu baris (`level`, `ts`, `ctx`, `msg` + meta), `LEVEL_LOG` untuk meredam debug |
| `src/lib/api.ts` | `ApiError`, `parseBody(req, schema)`, `handleApiError(ctx, e)`, `requireUserId()` |
| `src/lib/schemas.ts` | seluruh skema zod (login, register, task, project, note, template, settings, admin, push) |

- **`handleApiError`** memetakan error ke status yang benar: `ApiError` → status
  aslinya, Prisma `P2002` → 409, `P2025` → 404, DB tak terhubung → 503, sisanya
  500 **dengan log**. Semua route sekarang memakai ini; tidak ada lagi 500
  generik tanpa jejak.
- **`parseBody`** mengubah JSON rusak menjadi `400 INVALID_JSON` (bukan 500) dan
  memvalidasi body dengan zod.
- **Pesan validasi berbahasa Indonesia dan menyebut field**: `"timezone: Timezone
  harus WIB, WITA, atau WIT"`, `"notifyBeforeCooldownMin: ... harus berupa angka"`.
  Pesan bawaan zod yang berbahasa Inggris disaring di `zodMessage()` supaya tidak
  pernah bocor ke UI.
- **41 route API**: 30 memakai `lib/api`, 16 memakai skema zod. Sisanya
  (`vapid-key`, `telegram/webhook/setup`, `push/vapid-key`, dll.) tidak menerima
  body yang perlu divalidasi.
- **`catch {}`**: dari 61 kejadian, sisa 22 di direktori `api/` dan **semuanya
  fallback `JSON.parse` / `req.json` yang disengaja** (mis. `settings` lama yang
  rusak dikembalikan sebagai objek kosong + `logWarn`), bukan error handler yang
  ditelan.

### Perubahan perilaku yang disengaja (user akan merasakannya)

| Sebelum | Sesudah |
|---|---|
| `PUT /api/settings` membuang key tak dikenal & nilai salah tanpa pesan | ditolak `400` dengan nama key-nya (`Pengaturan tidak dikenal: tema`) |
| body JSON rusak → `500` | `400 { code: "INVALID_JSON" }` |
| login tanpa body → pesan zod Inggris | `400 "Username wajib diisi"` |
| `POST /api/templates` menerima `priority: "urgent"` → 500 | `400` dengan pesan jelas |

## Bug yang ketemu saat mengerjakan P1-5

**`PUT /api/settings` versi pertama menolak tombol "Putuskan Telegram".**
Skema awal hanya mengizinkan `boolean | number | string`, sementara UI mengirim
`{ telegramChatId: null, telegramId: null, telegramName: null }` untuk memutus
koneksi — dan dua key terakhir bahkan belum terdaftar. Kalau dibiarkan, fitur
disconnect Telegram akan mati total. Sekarang: key koneksi Telegram boleh `null`,
dan `getTimezone` di klien juga di-sanitasi (`['WIB','WITA','WIT']`) supaya
pengaturan lama yang aneh tidak membuat dialog gagal menyimpan.

## P2 yang ikut diselesaikan

1. **Retensi `TaskLog`** (`src/lib/retention.ts`) — cron memangkas log lebih tua
   dari `TASKLOG_RETENTION_DAYS` (default **730 hari**) dan melaporkannya sebagai
   `prunedTaskLogs`. Diuji: log berumur 900 hari terhapus, 5 log terbaru tetap.
2. **Polling tidak lagi boros** — sinkronisasi 60 detik dan `/api/notify/run`
   dilewati saat tab tidak aktif (`document.hidden`), lalu menyegarkan sekali saat
   tab kembali terlihat. Dulu tab yang ditinggal di background tetap menarik
   seluruh dataset tiap menit (biaya kuota Neon + kuota Telegram).
3. **`POST /api/import` ditulis ulang** — dulu N+1 (satu `findFirst` per task,
   satu `create` per task) dan **tidak transaksional**, jadi impor yang gagal di
   tengah meninggalkan data separuh. Sekarang: seluruh nama yang sudah ada dimuat
   sekali, validasi dilakukan di memori, lalu semua penyimpanan berjalan dalam
   **satu transaksi** (`createMany` project → task → log). Impor ulang file yang
   sama melaporkan `{projects:0, tasks:0, skipped:1}` — idempoten.

## Verifikasi

```
npx tsc --noEmit   → bersih (0 error)
npm test           → 55 passed (23 schedule + 27 schemas + 5 retention)
npm run build      → sukses
```

Uji langsung ke server (bukan hanya unit test):

| Uji | Hasil |
|---|---|
| login body kosong | `400 "Username wajib diisi"` |
| body JSON rusak | `400 INVALID_JSON` |
| task tanpa nama + priority `urgent` | `400 "Nama task minimal 1 karakter"` |
| `PUT /api/settings` nilai salah | `400 "notifyBeforeCooldownMin: ... harus berupa angka"` |
| `PUT /api/settings` key asing | `400 "Pengaturan tidak dikenal: tema"` |
| `PUT /api/settings` putus Telegram (`null`) | `200` |
| task id tidak ada | `404 "Task tidak ditemukan"` |
| template / project / note / import | `201` / `201` / `201` / `200` |
| impor ulang file yang sama | `{projects:0, tasks:0, skipped:1}` |
| cron tanpa secret | `401` |
| cron dengan secret | `200 {sent:0, prunedRateLimits:0, prunedTaskLogs:0}` |
| log 900 hari lalu | `prunedTaskLogs: 1` |
| UI: selesaikan task → Undo | toast sukses, task kembali muncul |
| UI: dialog Pengaturan → OK | tersimpan, tanpa error konsol |

## Masih terbuka (jujur)

- **P1-4** react-query: `page.tsx` masih ~4.174 baris dengan state manual. Ini
  refactor besar yang menyentuh hampir seluruh UI; risikonya regresi visual, dan
  tidak memperbaiki bug yang sedang terjadi. **Belum dikerjakan.**
- **P1-6** dua implementasi daftar task (dashboard/tree/modal): masih ada tiga
  tempat yang merender status cooldown dengan cara berbeda. **Belum dikerjakan.**
- **P2 sisa**: `settings` masih kolom JSON string (belum dinormalisasi), share
  project masih menyimpan snapshot beku, dependency zombie (27 `@radix-ui/*`,
  47 `components/ui/*` tidak terpakai), observability masih sebatas log JSON
  (belum ada error tracking).

---

# Bagian 3 — Settings, dedupe aturan tampilan, dan pembersihan dependency

Lanjutan dari Bagian 2. Bagian ini menutup **P1-6** (aturan tampilan ganda),
sebagian **P2** (settings JSON string, dependency zombie), dan merapikan hal-hal
yang selama ini membuat bug "diam-diam".

## 3.1 `src/lib/settings.ts` — settings tidak lagi dibaca sembarangan

Dulu ada **12 tempat** yang masing-masing melakukan `JSON.parse(user.settings)`
lalu `settings.timezone as string`. Cast itu tidak memeriksa apa pun: nilai lama
seperti `"Asia/Jakarta"`, `42`, atau `null` langsung masuk ke `getNextReadyAt()`.
Akibatnya jadwal task bisa meleset tanpa satu pun pesan error.

Sekarang satu modul:

| Fungsi | Jaminan |
|---|---|
| `parseSettings(raw, ctx)` | JSON rusak → `{}` + log; tidak pernah melempar |
| `resolveSettings(raw, ctx)` | setiap field divalidasi; nilai tidak valid → default aman |
| `getTimezone(raw, ctx)` | **selalu** `WIB/WITA/WIT` |
| `mergeSettings(current, patch)` | hanya key yang dikenal yang berubah; key lama tetap |

Pemakai yang dimigrasikan: `init`, `tasks`, `tasks/[id]/complete`, `notify-sweep`,
`settings` (GET/PUT), `telegram/webhook`, `telegram/notify`, `telegram/disconnect`,
`generate-code`, `export`, `import`.

Bonus: `/api/init` dulu mengambil user **dua kali** (sekali untuk profil, sekali
lagi hanya untuk kolom `settings`). Sekarang satu query, settings diturunkan dari
hasil yang sama.

## 3.2 `src/lib/task-view.ts` — aturan tampilan hanya satu versi

Label jadwal, warna/tanda prioritas, dan aturan "cooldown < 5 menit = mendesak"
ditulis ulang tiga kali di `page.tsx` (baris tree, dashboard, dialog detail),
lengkap dengan angka `300000` yang muncul di dua tempat. Sekarang semuanya di
satu modul (`scheduleLabel`, `priorityDot`, `priorityLabel`, `cooldownIcon`,
`cooldownColor`) dengan 8 test, dan ketiga view memakai helper yang sama —
mustahil lagi tampil beda antar-view.

## 3.3 Dependency zombie dihapus

Hasil audit: **63 dependency** tidak pernah diimpor. Yang paling mencolok:

- **27 paket `@radix-ui/*`** + **48 file `src/components/ui/*`** (scaffold shadcn)
  — tidak ada satu pun halaman yang memakainya. Ikut terhapus: `hooks/use-toast`,
  `hooks/use-mobile`, `lib/utils.ts` (hanya berisi `cn()` untuk file-file itu),
  `components.json`.
- **Tailwind CSS** sebenarnya **tidak pernah aktif**: `globals.css` tidak punya
  `@import "tailwindcss"` maupun `@config`, jadi seluruh utility class tidak
  pernah dihasilkan — tema Win95 memang CSS tulis tangan. `tailwind.config.ts`,
  `postcss.config.mjs`, `tailwindcss`, `@tailwindcss/postcss`, `tailwindcss-animate`,
  `tailwind-merge`, `clsx`, `class-variance-authority` dihapus.
- Library besar lain yang tidak terpakai: `@tanstack/react-query`,
  `@tanstack/react-table`, `framer-motion`, `recharts`, `lucide-react`,
  `react-hook-form`, `@hookform/resolvers`, `date-fns`, `zustand`, `next-intl`,
  `next-themes`, `sonner`, `vaul`, `embla-carousel-react`, `react-day-picker`,
  `react-resizable-panels`, `react-markdown`, `react-syntax-highlighter`,
  `@mdxeditor/editor`, `@dnd-kit/*`, `@reactuses/core`, `cmdk`, `uuid`, `sharp`*.

\* `sharp` dipertahankan (dipakai Next untuk optimasi gambar), `react-dom` juga.

Hasilnya:

| | Sebelum | Sesudah |
|---|---|---|
| dependency produksi | 65 | **8** |
| devDependency | 12 | **9** |
| paket terpasang (`npm install`) | ~1.200 | **442** |
| ukuran `node_modules` | 1,2 GB | **665 MB** |

Diverifikasi setelah pembersihan: `tsc` bersih, **78 test** lulus,
`next build` sukses, dan UI dibandingkan lewat screenshot — identik
(dashboard, tree, dialog detail, toast Undo, dialog Pengaturan).

## 3.4 Catatan jujur soal P1-4

Audit menyebut "react-query sudah terpasang tapi tidak dipakai". Setelah
diperiksa, itu benar — tapi sekarang **dependency-nya dihapus**, bukan dipakai.
Artinya **P1-4 tetap belum selesai**: `page.tsx` masih ±4.169 baris dengan state
manual (`fetchData`, ref sinkronisasi, cache localStorage). Mengadopsi react-query
adalah refactor besar yang menyentuh hampir seluruh UI; risikonya regresi visual
dan tidak memperbaiki bug yang sedang terjadi. Yang saya pilih: menghapus ilusi
"kita sudah punya react-query" supaya tidak ada yang mengira masalah ini beres.

## Status verifikasi akhir (Bagian 3)

```
npx tsc --noEmit   → bersih
npm test           → 78 passed (jadwal 23, schema 27, retensi 5, settings 15, task-view 8)
npm run build      → sukses tanpa Tailwind & tanpa components/ui
screenshot UI      → identik dengan sebelum pembersihan
```

---

# Bagian 4 — Rombak tata letak (UX), tema tetap

Detail lengkap ada di [`docs/ux/UX-REVIEW.md`](./docs/ux/UX-REVIEW.md). Ringkasnya:

Masalahnya bukan tema Win95, tapi **struktur bersarang**: tab status → dropdown
project → folder accordion → grup status di dalam folder. Empat lapis untuk 11
task. Ditambah aksi utama ("Selesai") justru tombol paling kecil dan berwarna
abu-abu seperti nonaktif, teks 10–11 px, dan tanpa label kolom.

Yang diubah:

1. **Project → sidebar kiri** (dengan jumlah task + ringkasan status). Dropdown
   project dan accordion folder dihapus → satu lapis penyaringan saja.
2. **Baris task ditulis ulang**: nama 13 px tebal + meta (project/jadwal/berapa
   kali selesai), kolom status berlabel ("Siap sekarang" / "18j 12m" + jam siap),
   tombol berlabel "Kerjakan" / "✓ Selesai" / "↺ Reset", dan pita warna status di
   tepi kiri baris.
3. **Hierarki toolbar**: `＋ Task Baru` (hijau, paling kiri) → Project →
   [Daftar | Monitor] → Refresh/Template/Telegram.
4. **Kontras & ukuran**: teks sekunder `#808080` → `#404040`, font 12–13 px,
   shell mengisi tinggi layar, daftar punya scroll sendiri, plus baris hint
   shortcut di bawah daftar.
5. **HP**: sidebar jadi chip horizontal, status pindah ke bawah nama, tombol aksi
   memenuhi lebar baris.

Tidak diubah: tema, palet, border 3D, seluruh fitur & dialog, dan logika data
(`getActiveTasks`, urutan pinned→prioritas, perhitungan cooldown).

Verifikasi: `tsc` bersih, 78 test lulus, `next build` sukses, diuji di browser
(desktop + HP): filter sidebar, selesaikan task + Undo, buka detail, tanpa error
konsol.

Yang belum: Monitor & dialog detail belum ditata ulang, belum ada drag & drop
maupun aksi massal, dan `page.tsx` masih ±4.100 baris.
