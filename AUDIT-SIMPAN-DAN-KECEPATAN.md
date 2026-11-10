# "Simpan & selesai" bermasalah + sisir semua bug

Tanggal: 9 November 2026 · Cabang: `arena/a76183ff-mbg` (dari `main` `1039b9e`)

Keluhan: **tombol "Simpan & selesai" terasa tidak jalan / lambat**. Diperiksa dengan
browser sungguhan pada jaringan yang sengaja diperlambat agar mirip kondisi produksi.

---

## 1. Bug utama: hasil simpan dibuang, daftar menunggu request kedua

`saveTask` menerima balasan `POST /api/tasks` (atau `PUT /api/tasks/[id]`) yang sudah
berisi tugas lengkap — **tetapi balasan itu tidak dipakai**. Daftar hanya diperbarui
setelah `/api/init` selesai dipanggil ulang.

Akibatnya, terukur di browser:

| Skenario | Sebelum | Sesudah |
|---|---|---|
| Jaringan lambat 1,2 dtk: dialog tertutup → tugas terlihat | dialog tutup 1313 ms, kartu muncul 2550 ms → **jeda kosong 1237 ms** | dialog tutup 1323 ms, kartu muncul 1324 ms → **jeda 1 ms** |
| `/api/init` gagal setelah simpan | **tugas tersimpan di server tapi tidak pernah muncul** — persis seperti gagal simpan | kartu muncul 254 ms, tidak bergantung `/api/init` |
| Edit → Simpan perubahan (latensi 900 ms) | nama baru muncul 2163 ms | 1288 ms |

Jeda kosong itulah yang terasa sebagai "sudah klik Simpan & selesai tapi tidak terjadi
apa-apa". Dan pada sinyal buruk, tugas benar-benar hilang dari tampilan sampai halaman
dimuat ulang walau sudah tersimpan.

**Perbaikan:** modul baru `src/lib/task-from-api.ts` mengubah balasan server menjadi
bentuk yang dipakai layar, lalu tugas langsung disisipkan/diperbarui. Status dan
cooldown dihitung dengan fungsi yang **sama** seperti server (`schedule.ts`), jadi tidak
ada kedip "siap → cooldown" saat sinkronisasi latar belakang menyusul.

Retry idempoten tetap aman: balasan `200` untuk kunci yang sama memperbarui kartu yang
sudah ada, bukan menambah kartu baru (`upsertTask`).

## 2. Respons basi bisa menghapus hasil aksi

Penjaga lama memakai patokan waktu: "pakai data server kalau sudah lewat 5 detik sejak
tulisan terakhir". Dua masalah: angka sidebar/Monitor tertinggal sampai 5,5 detik, dan
pada jaringan lambat respons yang berangkat **sebelum** aksi selesai masih bisa menimpa
hasilnya.

**Perbaikan:** `fetchData` mencatat waktu berangkat (`startedAt`) dan hanya menerapkan
data kalau tidak ada tulisan lokal yang lebih baru. Jendela tulis diturunkan
5000 ms → 1200 ms, dan `delayedFetch` kini maksimal 4 detik (sebelumnya 10).

Diuji khusus (B3): `/api/init` ditahan, tugas diselesaikan, lalu respons lama dilepas —
hasil aksi **tetap bertahan**.

## 3. Daftar kartu digambar ulang setiap detik

Ticker cooldown membandingkan `cooldownMs === ms`, padahal milidetik berubah tiap detik.
Selama ada satu tugas cooldown, seluruh daftar ikut di-render ulang setiap detik walau
tulisannya tetap "5j 0m" — terasa saat mengetik di kolom cari atau menggulir di HP.

**Perbaikan:** logika dipindah ke `src/lib/cooldown-tick.ts` dan hanya membandingkan
**teks yang ditampilkan**. Tugas berjeda jam kini menyegar sekali per menit; kalau tidak
ada yang berubah, array yang sama dikembalikan sehingga React melewati render.
Bonus: `nextReadyAt` kosong/rusak tidak lagi mengunci tugas sebagai cooldown selamanya.

## 4. Fungsi serverless jauh dari database

`vercel.json` tidak menyetel region, jadi fungsi berjalan di default AS Timur sementara
database Neon ada di `ap-southeast-1` (Singapura) dan pengguna di Indonesia.
**Perbaikan:** `"regions": ["sin1"]` — fungsi satu kota dengan database.

> Catatan penerapan: setelan ini berlaku pada deployment berikutnya. Region fungsi di
> dashboard Vercel sebaiknya dicek sekali setelah deploy untuk memastikan sudah `sin1`.

## 5. Perjalanan database per penyelesaian tugas: 7 → 5

`POST /api/tasks/[id]/complete` dulu menjalankan: query auth, query settings (baris user
yang sama!), kunci baris, baca tugas, update penanda notifikasi, buat log, baca ulang.

**Perbaikan:**
- `requireUserWithSettings()` — auth sekaligus zona waktu dalam **satu** query.
- Pembuatan log dilakukan lebih dulu, lalu **update sekaligus membaca ulang** tugas
  beserta log dan jumlahnya (dulu dua pernyataan terpisah).

Kunci baris `FOR UPDATE`, penolakan tugas yang belum siap, dan reset penanda notifikasi
tetap sama — dikunci 11 tes baru.

---

## Hasil pemeriksaan menyeluruh

**59 pemeriksaan browser, 0 gagal** + **337 tes unit lulus**.

| Kelompok | Cakupan | Hasil |
|---|---|---|
| Dialog tambah | buka, nama kosong, link non-http, jam ngawur, Batal + buang draft, Simpan & tambah lagi, 3 tugas berurutan | 7/7 |
| Jaringan bermasalah | respons hilang + isi sama (tidak dobel), respons hilang + isi diubah (tidak terkunci), respons `/api/init` basi | 3/3 |
| Kartu & detail | detail, catatan otomatis, Pin, Edit, Duplikat, Pindah proyek, Hapus + konfirmasi, Undo toast, return-bar Belum/Sudah selesai | 9/9 |
| Filter & massal | 4 tab, cari + kosongkan, pilih semua, selesaikan pilihan, keluar mode | 3/3 |
| Proyek | buat, menu lengkap (tanpa tombol mati), Complete Semua Siap, Share + Salin, Edit nama, Hapus + jumlah tugas, filter sidebar | 7/7 |
| Catatan/template/admin | catatan tambah-edit-pin-hapus; template buat-pakai; admin kode undangan-refresh-blokir-hapus | 3/3 |
| Pengaturan & menu | auto-selesai ON/OFF, Batal tidak menyimpan, Export Backup, Import Data, Monitor↔Daftar, Bantuan/Pengingat/Telegram, Muat ulang | 7/7 |
| Keyboard | N, Escape, 1–4, Ctrl+Enter | 3/3 |
| HP 390 px | 1 kolom, 4 tab terlihat ≥44 px, tombol utama 48 px, simpan dari HP, menu Lainnya, panel catatan + konfirmasi, OK Pengaturan tanpa menggulir, aksi massal | 8/8 |
| Khusus simpan | cepat, lambat 1,2 dtk, `/api/init` gagal, klik 3× cepat, filter proyek aktif, edit | 6/6 |
| Kesehatan | tidak ada error JavaScript di seluruh penyisiran | 3/3 |

### Gerbang mutu

| Pemeriksaan | Hasil |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm run lint:baseline` | **29 error = baseline 29**, 0 warning (turun dari 30 — satu utang lama hilang dan dikunci) |
| `npm test` | **337 lulus**, 1 dilewati (20 berkas) — **+41 tes baru** |
| `npm run build` | sukses |

Tes baru: `task-from-api` (19), `task-complete-route` (11), `cooldown-tick` (11).

---

## Audit pendalaman (9 November 2026)

Saya telusuri lagi alur edit sampai pemetaan balasan server. Ditemukan satu kasus
sampingan yang lolos dari penyisiran tombol: ketika deskripsi lama dikosongkan lalu
form edit disimpan, balasan API berisi `description: null`, tetapi pemetaan optimistis
menganggap `null` sebagai "kolom tidak dikirim" dan menghidupkan lagi deskripsi lama
untuk sementara. Sinkronisasi berikutnya biasanya membetulkannya, namun layar terlihat
seolah pengosongan gagal.

**Sudah diperbaiki:** `taskFromApi()` kini membedakan kolom yang tidak ada (`undefined`;
pertahankan nilai lama saat edit) dari nilai kosong yang eksplisit (`null` atau string
kosong; hapus nilai). Dua tes regresi baru mengunci kedua perilaku tersebut.

Validasi perubahan pendalaman: `npx tsc --noEmit` lulus; lint tetap **29 = baseline 29**;
`npm run build` lulus. Tes pemetaan khusus **21/21 lulus**. Saat menjalankan seluruh
tes di sandbox ini, **339 tes lulus dan 1 dilewati**, tetapi proses Vitest berakhir gagal
karena tiga unhandled rejection dari Prisma Query Engine native yang memang tidak ada
(`libquery_engine-debian-openssl-3.0.x.so.node`) pada sandbox; bukan assertion yang gagal.
CI PR sebelumnya lulus sebelum dua tes regresi ini ditambahkan.

## Yang belum bisa dipastikan dari sandbox

- **Latensi produksi sesungguhnya**: angka di atas memakai latensi tiruan. Setelah
  deploy dengan region `sin1`, mohon cek sekali lewat DevTools → Network: durasi
  `/api/tasks` dan header `x-vercel-id` (prefiksnya menunjukkan region fungsi).
- **Rute complete dengan database asli**: perilakunya dikunci dengan database tiruan
  (11 tes), bukan PostgreSQL sungguhan.
- Push notification, Telegram asli, Safari iOS/Firefox: belum diuji otomatis.

## Sengaja tidak diubah

- Kartu belum dijadikan komponen ber-`memo`: handler aksinya dibuat ulang setiap render,
  jadi memo belum memberi hasil tanpa refactor besar. Sumber render per detiknya sudah
  dihilangkan lebih dulu (poin 3), yang dampaknya paling besar.
- Polling latar tetap 60 detik; perubahan dari perangkat lain tetap menunggu maksimal
  1 menit atau sampai tab difokuskan kembali.
- Auto-selesai saat klik link masih pengaturan global (menunggu keputusan).
