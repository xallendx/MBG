# Rombak alur: langkah-langkahnya sekarang benar-benar mudah

Pertanyaan: *"apakah sekarang langkah-langkahnya mudah digunakan?"*

Aku ukur dulu, dan jawabannya: **sebagian besar sudah, tapi satu alur inti masih jalan buntu.**
Alur itu sudah kurombak. Ini bukan tebakan — semuanya diuji di browser.

---

## Yang masih rusak setelah perbaikan kemarin

Aku klik **"Nyalakan pengingat"** seperti pengguna baru, lalu mencatat apa yang terjadi:

```
Setelah klik "Nyalakan pengingat":
  pushCheckboxSudahCentang: true      ← sudah tercentang!
  izinBrowser: "denied"               ← tapi push belum aktif

Setelah tekan OK (aksi yang paling masuk akal):
  izinBrowser: "denied"               ← tidak berubah
  dialogTertutup: true                ← dialog hilang, push tetap mati
```

**Ini jalan buntu.** Penyebabnya tiga:

1. Tombol itu membuka **Pengaturan umum** — 5 fieldset (Perilaku, Notifikasi, Timing,
   Info, Shortcuts), dan blok notifikasi baru terlihat setelah **scroll 248 px**
2. Checkbox "Push Notifikasi" **sudah tercentang** karena `browserNotifEnabled` default `true`.
   Pengguna wajar mengira sudah aktif
3. Izin browser hanya diminta di `onChange`. Karena sudah tercentang, menekan OK
   **tidak meminta izin apa pun**. Untuk berhasil, pengguna harus **tahu sendiri** untuk
   menghapus centang lalu mencentang ulang — tidak ada yang memberi tahu itu

Alur Telegram juga berbelit: Generate Kode → salin kode → buka Telegram → cari bot →
ketik `/start <kode>` manual. **5+ langkah dan harus menyalin-tempel.**

---

## Yang kurombak

### Dialog "Pengingat" khusus — satu layar, dua pilihan

Bukan lagi daftar checkbox di tengah Pengaturan. Sekarang tiap jalur punya kartu sendiri
dengan **status jujur** dan **satu tombol yang benar-benar melakukan aksinya**:

```
Pengingat
Pilih cara kamu ingin dikabari saat tugas siap dikerjakan. Cukup salah satu.

┌ Notifikasi di perangkat ini ─────────────────
│ Muncul di HP atau komputer ini,              │
│ termasuk saat aplikasi ditutup.              │
│         [ Izinkan notifikasi ]               │  ← langsung minta izin
└──────────────────────────────────────────────┘
┌ Lewat Telegram ──────────────────────────────┐
│ Dikirim ke chat Telegram kamu.               │
│ Tetap masuk walau ganti perangkat.           │
│         [ Hubungkan Telegram ]               │
└──────────────────────────────────────────────┘
                            [ Selesai ]
```

**Status ditampilkan apa adanya**, bukan checkbox yang menyesatkan:

| Keadaan nyata | Yang dilihat pengguna |
|---|---|
| Belum pernah minta izin | tombol **Izinkan notifikasi** |
| Sudah aktif | ✅ **Aktif** + "Kamu akan dikabari otomatis" |
| Izin diblokir browser | petunjuk konkret: buka ikon gembok → ubah ke Izinkan → muat ulang |
| Browser tidak mendukung | saran pakai Chrome/Edge atau Telegram |
| Server belum punya VAPID key | diberitahu terus terang, diarahkan ke Telegram |

Dulu kelima keadaan ini terlihat sama: **checkbox tercentang**.

### Telegram: dari 5+ langkah jadi 3

Kode sekarang dibuat otomatis dan dipasang ke **deep link** `t.me/<bot>?start=<kode>`:

```
DEEP LINK: https://t.me/MBGReminderBot?start=0242d91a
```

Pengguna cukup: **Hubungkan Telegram → Buka Telegram → Start**.
Tidak perlu menyalin kode, tidak perlu mencari bot, tidak perlu mengetik apa pun.
Kode manual tetap ditampilkan sebagai cadangan.

### Jalan masuk ditambah

"🔔 Pengingat" sekarang ada di **Alat** dan **Lainnya ▾** — tidak perlu lagi menebak
bahwa urusannya ada di dalam Pengaturan.

### Checkbox lama tidak lagi menyesatkan

Di Pengaturan umum, teksnya diganti jadi jujur:
> "Centang di atas baru menyimpan pilihan — push belum aktif." **[Aktifkan sekarang]**

---

## Hasil pengukuran

| Alur | Sebelum | Sesudah |
|---|---|---|
| Nyalakan push | 5+ tap, **sering gagal tanpa pesan** | **2 tap**, izin benar-benar diminta |
| Scroll untuk menemukan opsi | 248 px | **0** (muat satu layar) |
| Hubungkan Telegram | 5+ tap + salin-tempel kode | **3 tap**, tanpa menyalin |
| Status push yang salah tampil | 5 keadaan → semua "tercentang" | **5 keadaan, 5 pesan berbeda** |

Bukti fungsi: tombol "Izinkan notifikasi" berukuran **306 × 48 px** dan
`Notification.requestPermission` **benar-benar terpanggil** saat ditekan (diuji, bukan diasumsikan).

---

## Alur lain: sudah mudah, tidak kuubah

Aku cek ulang dan ini sudah baik, jadi sengaja tidak kusentuh:

| Alur | Langkah | Status |
|---|---|---|
| Buat tugas pertama | 1 tap → isi nama → pilih kapan → simpan | ✅ sudah singkat |
| Tandai selesai | **1 tap** | ✅ |
| Batalkan (undo) | **1 tap** dari notifikasi | ✅ |
| Cari tugas | 1 tap kolom cari | ✅ |
| Ganti tampilan | 1 tap Daftar/Monitor | ✅ |

Menambah langkah di sini justru memperburuk. Yang rusak cuma alur pengingat, dan itu sudah dibenahi.

---

## Verifikasi

`tsc` bersih · **117 test lolos** · **build produksi sukses** · lint **tetap 30** (tidak menambah
masalah baru) · target sentuh HP **0 yang di bawah 44 px** · menu keyboard tetap jalan ·
complete→undo benar (7→6→7) · desktop tetap rapat (20–24 px) · **tidak ada error browser**.

Data uji (bot username & kode Telegram) sudah dibersihkan; tinggal akun `admin1`.

## Catatan jujur

- **Push tetap butuh VAPID key di server** untuk benar-benar terkirim. Itu urusan konfigurasi
  deployment, bukan UX — tapi sekarang pengguna **diberi tahu**, bukan dibiarkan mengira sudah aktif
- **Deep link Telegram butuh nama bot** diisi admin. Kalau kosong, dialog mengatakannya terus terang
  dan mengarahkan ke notifikasi perangkat
- Ini uji browser otomatis. Aku bisa membuktikan jumlah tap dan bahwa izin benar-benar diminta;
  membuktikan orang sungguhan merasa lebih mudah tetap butuh uji dengan pengguna baru

**Coba sendiri:** live preview → `admin1` / `admin123` (akun demo sandbox, bukan akun produksi) → gulir daftar ke bawah →
**Nyalakan pengingat**. Atau lewat **Alat → 🔔 Pengingat**.
