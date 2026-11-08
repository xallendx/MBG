# Siap deploy ke Vercel — hasil pemeriksaan

Untuk deploy ke `mbg-xi.vercel.app`. Dokumen ini memisahkan **yang sudah dibuktikan**
dari **yang tidak bisa saya periksa dari sini**.

---

## Temuan utama: deploy-mu SUDAH rusak sebelum saya mulai

Saya tidak bisa membuka `mbg-xi.vercel.app` dari sandbox (host di luar allowlist),
tapi **status deployment bisa dibaca lewat API GitHub** — dan itu membongkar masalah
yang tidak terlihat dari luar.

| Commit | Tanggal | Status Vercel |
|---|---|---|
| `eb35bcc` | 27 Apr | **success** ← ini yang masih live di situsmu |
| `943060b` | 8 Nov, 11:16 | **failure** ← rusak di sini, sebelum pekerjaan UX dimulai |
| semua commit PR ini | 8 Nov | failure (mewarisi kerusakan yang sama) |
| `5f967f5` | 8 Nov, 15:1x | **success** ← setelah diperbaiki |

Jadi situsmu menampilkan versi April. Commit `main` yang sekarang **tidak bisa
di-deploy** — bukan karena perubahan saya.

### Penyebabnya: cron `*/5` ditolak paket Hobby

Bukti waktu, dari API GitHub (commit `4cf851e`):

```
commit masuk   : 15:09:06Z
Vercel failure : 15:09:10Z   <- 4 detik
CI build       : 15:09:12Z -> 15:10:29Z  (77 detik, success)
```

Build Next.js tidak mungkin selesai dalam 4 detik. Kegagalan secepat itu adalah
**penolakan konfigurasi sebelum build dimulai**, dan satu-satunya konfigurasi yang
divalidasi Vercel di tahap itu adalah `vercel.json`. Isinya cron `*/5 * * * *`,
sedangkan **paket Hobby hanya mengizinkan cron sekali sehari**.

`vercel.json` ditambahkan persis di commit `943060b` — commit yang mulai gagal.

**Dibuktikan dengan percobaan nyata:** setelah cron diubah ke harian, status Vercel
berubah dari "ditolak 4 detik" menjadi `pending → deploying → success` (~40 detik,
build sungguhan).

> Catatan: sebelumnya saya menyimpulkan cron tidak perlu diubah karena "deploy lama
> berhasil". Kesimpulan itu **salah** — deploy lama yang berhasil adalah commit April,
> bukan `main` sekarang. Status per-commit yang membantahnya.

### Dua masalah lain yang juga diperbaiki

Commit `943060b` juga menambahkan dua hal yang salah untuk Vercel (akan menjadi
masalah setelah penolakan konfigurasi teratasi):

| Item | Perbaikan |
|---|---|
| `output: 'standalone'` dipaksakan | hanya untuk self-host; Vercel pakai builder-nya sendiri |
| `cp -r .next/static .next/standalone/...` di skrip `build` | dipindah ke `scripts/postbuild.mjs` yang mengecek dulu; kalau folder tidak ada, dilewati bukan gagal |

Diuji kedua jalur: self-host → standalone ada, aset disalin, exit 0.
`VERCEL=1` → tidak ada standalone, postbuild melewatkan, **exit 0**.

### Pengingat tiap 5 menit tetap bisa, tanpa bayar

Cron Vercel sekarang harian (`0 1 * * *`) sebagai jaring pengaman. Pemicu tiap 5 menit
dipindah ke **GitHub Actions** (`.github/workflows/reminder-sweep.yml`) yang memang
mengizinkan jadwal per-menit dan gratis.

**Untuk mengaktifkannya**, isi dua secret di repo GitHub
(Settings → Secrets and variables → Actions):

| Secret | Nilai |
|---|---|
| `APP_URL` | `https://mbg-xi.vercel.app` |
| `CRON_SECRET` | sama persis dengan `CRON_SECRET` di environment Vercel |

Kalau belum diisi, workflow berhenti dengan pesan dan **tidak gagal** — jadi tidak
mengotori riwayat CI. Aplikasi tetap jalan normal; pengingat latar belakang saja yang
belum aktif.

---

## Yang baru pertama kali diuji: mode produksi

Sebelumnya saya hanya memastikan `next build` **berhasil dibangun** — belum pernah
**menjalankan** hasilnya. Itu celah besar, karena mode dev dan produksi berbeda
(React ter-minify, aset statis, header benar-benar diterapkan).

Sekarang sudah dijalankan dan diuji:

```
1. HTTP utama: 200
2. Header keamanan: CSP, nosniff, HSTS, Referrer-Policy, Permissions-Policy — semua ada
   x-powered-by: tidak ada (tidak membocorkan versi)
3. Aset gagal dimuat: tidak ada
4. Dashboard produksi: siap 7, daftar 523px, baris 108px, 11 tugas  <- sama dengan dev
5. Complete -> Undo: 7 -> 6 -> 7
6. Bar konfirmasi sepulang buka link: muncul
7. Service worker: activated, 1 registrasi
8. Cache: ["mbg-v4"]   <- cache lama mbg-v3 dibersihkan
9. Export backup dari HP: tersedia
HYDRATION: []           <- tidak ada error hidrasi
```

Satu-satunya respons ≥400 adalah `401 /api/identify` **sebelum login** — itu memang
pertanyaan "sudah masuk belum?", bukan kerusakan.

**Catatan metode (jujur):** sandbox ini tidak bisa mengunduh query engine Prisma
(host-nya di luar daftar yang diizinkan). Supaya server produksi bisa benar-benar
dijalankan, saya memasang adapter database **sementara** di `src/lib/db.ts`, lalu
**mengembalikannya persis** setelah pengujian — diverifikasi dengan checksum:

```
82cc0ac9f5b928ec134357a6a4fa1be1  src/lib/db.ts
82cc0ac9f5b928ec134357a6a4fa1be1  salinan asli
git diff src/lib/db.ts prisma/schema.prisma  ->  kosong
```

Di Vercel, `prisma generate` berjalan normal dengan engine asli, jadi hambatan ini
tidak ada di sana. Yang diuji adalah kode aplikasi, bukan lapisan koneksi sandbox.

---

## Satu perubahan perilaku yang perlu kamu tahu

**CSP produksi tidak lagi mengizinkan `unsafe-eval`.**

Sebelumnya header mengizinkan `eval()` di semua lingkungan. Padahal itu hanya
dibutuhkan mode dev (React Refresh); pengguna akhir tidak perlu. Sekarang hanya aktif
saat dev.

Diuji di build produksi:
```
CSP: script-src 'self' 'unsafe-inline'     <- unsafe-eval hilang
unsafe-eval masih ada? false
Pelanggaran CSP: []
Halaman terhidrasi & bisa diketik: ya
Chunk JS gagal dimuat: []
```
Kode aplikasi juga diperiksa: tidak ada `eval(` maupun `new Function` di `src/` dan `sw.js`.

**Service worker naik `mbg-v3` → `mbg-v4`.** Pengguna lama akan dapat worker baru dan
cache lama dihapus otomatis. Karena strategi-nya *network-first*, pengguna **tidak**
akan disajikan HTML basi setelah deploy.

---

## Daftar periksa saat deploy

### Sebelum
- [ ] Pastikan `COOKIE_SECRET` di Vercel **tidak diganti** — kalau ganti, semua sesi
      pengguna langsung batal dan mereka harus login ulang.
- [ ] Backup database dulu (menu **Lainnya → Export backup** sekarang tersedia di HP).
- [ ] Merge PR #1 ke `main`.
- [ ] (Opsional, untuk pengingat tiap 5 menit) isi secret `APP_URL` dan `CRON_SECRET` di repo GitHub.

### Sesudah
- [ ] Buka situs dari **HP**, login, dan cek: daftar tugas tampil, 4 tugas terlihat.
- [ ] Tekan satu tugas **Selesai**, lalu **Undo** — hitungan harus kembali.
- [ ] Tekan **Buka link**, kembali ke app → bar "Sudah selesai dikerjakan?" muncul.
- [ ] **Lainnya → Export backup** → berkas JSON terunduh.
- [ ] Muat ulang sekali untuk memastikan service worker baru aktif.
- [ ] Cek log Vercel: tidak ada lonjakan 5xx. Sebelumnya `/api/push/vapid-key`
      membalas 500 tiap kunjungan kalau VAPID belum diisi — **sekarang sudah 200**,
      jadi log seharusnya lebih bersih, bukan lebih kotor.

### Kalau ada masalah
Deploy ulang commit sebelumnya dari dashboard Vercel (**Promote/Rollback**). Karena
tidak ada perubahan schema, rollback aman dan tidak menyentuh data.

---

## Soal notifikasi (tidak memblokir deploy)

Aplikasi tetap jalan penuh tanpa ini. Dialog Pengingat sekarang jujur soal status:

| Keadaan | Yang dilihat pengguna |
|---|---|
| VAPID key belum diisi | "Server belum dikonfigurasi — pakai Telegram" (tidak minta izin sia-sia) |
| Telegram bot belum diisi | diarahkan ke pengaturan |
| Keduanya belum | pengingat hanya saat aplikasi dibuka |

Kalau nanti mau mengaktifkan:
- **Telegram:** isi `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
  `TELEGRAM_WEBHOOK_SECRET`, lalu daftarkan ulang webhook.
- **Web Push:** `npx web-push generate-vapid-keys`, isi
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
  Catatan: di iPhone, push hanya jalan kalau situs dipasang ke Home Screen.

---

## Yang TIDAK bisa saya pastikan dari sini

- **Situs live-mu tidak bisa saya buka.** `mbg-xi.vercel.app` di luar daftar host yang
  boleh diakses sandbox ini. Status deployment tetap bisa saya baca lewat API GitHub,
  dan justru itu yang membongkar penyebab kegagalan.
- **Safari/iOS dan Firefox belum diuji.** Semua pengukuran di Chromium. Push di iOS
  punya aturan sendiri.
- **Pengiriman notifikasi sungguhan belum diuji** — tidak ada layanan push di sandbox.
  Yang terbukti logika aplikasi dan statusnya, bukan notifikasi yang benar-benar sampai.
- **Perilaku database Neon-mu** tidak bisa diuji; sandbox memakai Postgres lokal.
  Karena tidak ada perubahan schema, risikonya kecil.

## Gerbang mutu terakhir

`tsc` bersih · **117 test lolos** · `npm run build` **exit 0** (skrip lengkap, bukan
hanya `next build`) · `lint:baseline` **exit 0** (30 terkunci, 0 warning) ·
build produksi **dijalankan dan diuji** · tanpa error hidrasi.
