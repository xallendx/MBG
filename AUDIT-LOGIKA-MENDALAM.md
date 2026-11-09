# Audit logika mendalam — alur dunia nyata

Lanjutan dari perbaikan angka tab/arsip. Kali ini yang diperiksa bukan tampilan,
tapi **alur nyata**: apa yang terjadi kalau tugas dikerjakan malam sebelum hari
target, kalau aplikasi dibuka saat jaringan mati, kalau tugas baru dibuat lalu
aplikasi ditutup, dan kalau tugas cuma diganti namanya.

**Metode.** Setiap dugaan dibuktikan dulu sebelum diperbaiki: uji unit dengan
waktu dipalsukan (`vi.setSystemTime`), uji route dengan database tiruan, atau
audit browser terhadap build produksi. Untuk dua temuan, kode lama dipasang
kembali sementara dan tesnya dipastikan **gagal** — supaya jelas tesnya benar
menangkap bug, bukan sekadar ikut kode baru.

---

## Temuan yang diperbaiki

### 1. Tugas mingguan kehilangan satu minggu — **tinggi**

Tugas mingguan target Senin, jeda 24 jam, dikerjakan **Minggu 23:00**.

| | Hasil |
|---|---|
| Sebelum | siap lagi **169 jam** kemudian (Senin pekan depannya lagi) |
| Sesudah | siap lagi **24 jam** kemudian (Senin 23:00) |

Penyebab: kalau akhir jeda melewati tengah malam hari target, kode menambah
**7 hari penuh** ke hari target, bukan mengambil yang paling akhir antara
keduanya. Kasus yang sama terjadi pada jeda 168 jam (nilai maksimum yang
diizinkan validasi) walau dikerjakan tepat pada hari target.

Perbaikan: `getNextReadyAt` mengembalikan `max(hari target berikutnya, akhir jeda)`.
Dua tes lama tentang perilaku mingguan tetap lulus.

### 2. Ganti nama tugas mengirim ulang pengingat — **sedang**

`PUT /api/tasks/[id]` menganggap jadwal berubah kalau body memuat key
`scheduleType`/`scheduleConfig`. Form edit **selalu** mengirim dua key itu walau
yang diubah cuma nama atau prioritas. Akibatnya `notifiedWarnAt`/`notifiedReadyAt`
di-reset, dan sweep berikutnya mengirim lagi "✅ Task Siap Dikerjakan!" untuk
kejadian yang sama.

Perbaikan: bandingkan **nilainya** (`scheduleActuallyChanged`), bukan ada-tidaknya
key. Urutan key JSON yang berbeda tidak dianggap perubahan.

Bukti: dengan kode lama, 2 dari 6 tes route gagal; dengan perbaikan, 6/6 lulus.

### 3. Tugas terjadwal baru tidak pernah diingatkan — **sedang**

Sweep hanya mengambil tugas yang **sudah punya log penyelesaian**. Jadi:

- "Klaim faucet setiap hari 09:00" dibuat jam 08:00 → tidak ada pengingat 08:55
  maupun 09:00, padahal aplikasi sengaja ditutup untuk menunggu pengingat.
- "Mulai tanggal 15 Desember" → tidak pernah dikabari sama sekali sebelum
  dikerjakan; tanggal yang dipasang sendiri tidak ada gunanya.

Perbaikan: tugas tanpa log ikut diperiksa **selama masih menunggu**. Tugas baru
yang sudah siap sejak awal tetap dilewati supaya tidak memborbardir pengguna yang
membuat puluhan tugas sekaligus.

### 4. Cache menyuruh menunggu tugas yang sudah siap — **sedang**

Saat daftar dimuat dari cache localStorage, hanya `cooldownMs` yang dihitung
ulang; `status` dan `cooldownRemaining` dipakai apa adanya. Tugas yang
cooldown-nya sudah lewat tetap tampil "⏳ 5j 0m" dengan tombol utama
**"Lihat detail"** — bukan "Buka link". Kalau jaringan gagal, salahnya permanen:
pengguna tidak bisa mengerjakan tugas yang sebenarnya sudah siap.

Perbaikan: `refreshCachedTask` menghitung status dari waktu, satu arah saja
(cooldown yang lewat → siap). Tugas yang menurut cache sudah siap tidak
diturunkan jadi menunggu; itu wewenang server.

Bukti browser (server `/api/init` dan `/api/identify` sengaja digagalkan):

| Tugas di cache | Tampilan |
|---|---|
| cooldown, waktunya lewat 1 jam | `Siap sekarang` + **Buka link ↗** |
| cooldown, masih 2j 15m | `⏳ 2j 14m` + Lihat detail |
| cooldown tanpa `nextReadyAt` sah | `Siap sekarang` + **Buka link ↗** |

---

## Diperiksa dan ternyata sudah sehat

| Area | Kenapa aman |
|---|---|
| Validasi jadwal | `scheduleInputError` dipanggil di **semua** jalur tulis: tasks, tasks/[id], projects/[id]/tasks, import, import-project (share code), templates. Jeda wajib bulat 1–168 jam (kustom 1–8760), jadi nol/negatif/`"abc"` tidak bisa masuk. |
| Timezone | `resolveSettings`/`getTimezone` membuang nilai tidak sah dan jatuh ke WIB. Perhitungan	offset memakai `Intl` dan `Date.UTC`, tidak bergantung timezone server. |
| Retensi riwayat | Opt-in (default mati) dan **menyisakan log terbaru per tugas**, jadi tugas sekali yang selesai tidak hidup lagi karena riwayatnya menua. |
| Cache antar-akun | Kunci cache per user (`mbg_cache_<id>`), TTL 24 jam, dibersihkan saat logout bersama seluruh state. |
| Kirim ganda notifikasi | Setiap pengiriman diklaim lewat `updateMany` bersyarat pada penanda NULL; cron dan tab terbuka boleh jalan bersamaan. |
| Dobel klik Selesai | Baris tugas dikunci `SELECT … FOR UPDATE` sebelum status dibaca, lalu status dihitung ulang setelah log dibuat. |
| Endpoint cron | Fail-closed: tanpa `CRON_SECRET` semua permintaan ditolak. |
| Link tidak aman | `isSafeHttpUrl` menolak `javascript:`, `data:`, dan URL tanpa skema; kartu jatuh ke "✓ Selesai". |

---

## Temuan yang sengaja belum diubah

1. **Rotasi sweep > 500 pengguna.** `runNotificationSweep` mengambil 500 user
   terurut `updatedAt asc`, tapi sweep tidak menyentuh `User.updatedAt`. Pengguna
   aktif berotasi sendiri saat mengubah data; pengguna yang benar-benar pasif di
   urutan >500 bisa tidak pernah tersentuh. Belum diperbaiki karena butuh sentuhan
   tulis tambahan per user per 5 menit dan jumlah pengguna sekarang jauh di bawah
   batas. Perlu ditinjau sebelum skala naik.
2. **`scheduleType` tidak dikenal berperilaku seperti tugas sekali.** Cabang
   `default` mengembalikan `null` → selesai setelah satu log. Tidak bisa terjadi
   lewat jalur tulis normal (enum ketat), hanya data lama/korup.
3. **Bar "Sudah selesai dikerjakan?" hanya mengingat link terakhir.** Membuka tiga
   link lalu kembali ke aplikasi hanya menawarkan konfirmasi untuk yang terakhir.
4. **Auto-selesai saat buka link masih setelan global**, belum per tugas. Menunggu
   keputusan pemilik produk.
5. **Mode "Kerjakan" (hitung mundur 10 detik + Undo 60 detik) masih kode mati.**
   `startWorking` hanya dipanggil `renderRow`, yang dipakai `renderStatusGroup`,
   dan fungsi itu tidak dipanggil di mana pun. Sudah mati sebelum tampilan kartu.

---

## Cara mengulang verifikasi

```bash
npx tsc --noEmit
npm run lint:baseline
npx vitest run tests/schedule.test.ts tests/logic-flows.test.ts \
  tests/task-update-route.test.ts tests/task-counts.test.ts tests/task-card.test.ts
npm run build
```

Audit browser (butuh build standalone di :3100 dan pratinjau data contoh di :3200,
keduanya berkas `local-*` yang tidak masuk git):

```bash
node local-audit-logika.mjs   # 30 cek: angka tab, arsip, batalkan selesai, HP
node local-audit-cache.mjs    # 5 cek: cache offline dengan server digagalkan
```

`npm test` lengkap di sandbox tanpa Prisma engine tetap memunculkan beberapa
`PrismaClientInitializationError` setelah semua tes lulus; CI menjalankan suite
lengkap dengan engine yang benar.
