# Pemakaian sehari-hari: gampang dan tidak ribet?

Aku ukur **loop harian** (buka app → lihat yang siap → kerjakan → selesai), bukan onboarding.
Dua hal masih ribet. Keduanya sudah diperbaiki dan diuji di browser.

---

## Yang masih ribet sebelum perubahan ini

### 1. Cuma 2 tugas terlihat sekaligus — menggulir terus

Aku ukur pembagian layar HP (390×844):

| Bagian | Tinggi |
|---|---|
| Titlebar | 48 px |
| Menubar File/Lihat/Alat | 47 px |
| Toolbar | 49 px |
| Chip proyek | 56 px |
| **Bar filter + cari + hint** | **135 px** |
| Statusbar | 37 px |
| **Sisa untuk daftar tugas** | **387 px** |

Satu baris tugas **163 px** → **hanya 2 tugas terlihat utuh**. Untuk 11 tugas, harus
menggulir berkali-kali setiap hari.Hampir setengah layar habis untuk hiasan.

### 2. Setelah buka link, harus mencari tugasnya lagi

Loop harian nyata: **Buka link** → kerjakan di tab/aplikasi lain → kembali ke MBG →
**cari barisnya lagi** → tekan Selesai. Untuk 7 tugas siap, itu 7 kali berburu.

Ada opsi 1-ketukan (`Buka + selesai`), tapi **mati secara default** dan tersembunyi di
Pengaturan → Perilaku. Aku cek: `autoCompleteLink: false`.

---

## Yang diperbaiki

### A. Lebih banyak tugas terlihat, area sentuh tidak berkurang

| Ukuran | Sebelum | Sesudah |
|---|---|---|
| Ruang untuk daftar | 387 px | **490 px** (+27%) |
| Tinggi satu baris tugas | 163 px | **120 px** (−26%) |
| Tugas terlihat utuh | **2** | **3** |
| Bar filter | 135 px | **83 px** |

Yang dipangkas **hiasan**, bukan tombol:
- Menubar File/Lihat/Alat disembunyikan di layar sentuh (jarang dipakai harian; semua
  aksinya ada di toolbar/Lainnya). Tetap ada untuk desktop dan tetap bisa dijangkau keyboard
- Hint "Klik tugas untuk melihat detail" dihapus di HP — tidak berguna di layar sentuh
  tapi memakan satu baris setiap kali buka app
- Tab filter jadi **satu baris yang bisa digeser**, tidak membungkus jadi dua baris
- Nama tugas tidak lagi dipaksa setinggi tombol, karena **seluruh baris** sudah bisa
  ditekan untuk membuka detail (diverifikasi: klik baris → detail terbuka)

**Penting — area sentuh tidak dikorbankan.** Aku ukur *target efektif* (baris yang benar-benar
bisa ditekan), bukan hanya elemen tombolnya:

```
target EFEKTIF < 44px: 0
nama tugas: own 28px → effective 120px  ✅
tombol aksi: 48px                        ✅
ikon pojok: 44×44px                      ✅
```

Sempat ikon pojok turun ke 36 px saat memadatkan titlebar; langsung kukembalikan ke 44 px.

### B. Konfirmasi sepulang mengerjakan — satu ketukan

Sekarang setelah menekan **Buka link**, begitu kembali ke aplikasi muncul bar tepat di
atas daftar:

```
┌ Habis dibuka: Submit tugas bounty ───────────┐
│ Sudah selesai dikerjakan?                    │
│   [ ✓ Sudah selesai ]      [ Belum ]         │
└──────────────────────────────────────────────┘
```

Tidak perlu mencari barisnya, tidak perlu menggulir. Jawab sekali, selesai.

**Diuji:** `siap 7 → 6` setelah **1 tap**, bar hilang setelah dijawab, kedua tombol 44 px,
dan **Undo tetap bisa membatalkan**. Bar hanya muncul kalau tugasnya masih berstatus siap,
jadi tidak menawarkan konfirmasi untuk tugas yang sudah selesai.

Ini sengaja **tidak** mengubah default `autoCompleteLink`. Menandai selesai otomatis saat
link dibuka berisiko mencatat tugas yang belum dikerjakan; bar ini memberi kecepatan yang
sama tanpa risiko itu.

---

## Loop harian sekarang

| Langkah | Tap |
|---|---|
| Buka app → langsung lihat tugas siap (tanpa scroll) | **0** |
| Buka link tugas | 1 |
| Kembali → "✓ Sudah selesai" | **1** |
| **Total per tugas** | **2 tap, tanpa mencari** |
| Tugas tanpa link | **1 tap** |
| Batalkan | **1 tap** (Undo) |

Tugas siap sudah tampil paling atas tanpa perlu scroll — itu sudah benar dari awal, jadi tidak kuubah.

---

### C. Undo diperbesar — ketemu saat membuat file HTML

Saat memotret setiap keadaan layar untuk file HTML, aku menemukan yang terlewat: tombol
**Undo** di notifikasi kecil cuma **63×19 px**, dan tombol tutup ✕ **14×14 px**. Padahal Undo
justru pengaman kalau salah tekan "Sudah selesai".

| Tombol | Sebelum | Sesudah |
|---|---|---|
| ↩ Undo | 63×19 px | **85×44 px** |
| ✕ tutup | 14×14 px | **44×44 px** |

Notifikasinya juga dibuat melebar mengikuti layar HP supaya pesannya tidak terpotong.
Diuji: Undo tetap berfungsi, dan **0 tombol di bawah 44px di semua keadaan layar HP**
(sebelumnya pemeriksaan awal hanya mengukur layar utama, tidak mengukur keadaan setelah selesai).

---

## File HTML tampilan

**`TAMPILAN-SEKARANG.html`** — buka langsung di browser, tidak butuh server.

Isi: HTML + CSS **asli yang dirender aplikasi** (bukan gambar, bukan mock-up), untuk 6 keadaan —
HP: buka app / habis buka link / sudah selesai / dialog Pengingat / dialog Tambah tugas,
plus Desktop 1440×900. Alur hariannya bisa diklik: tekan **Buka link** → **✓ Sudah selesai** → **Undo**.

Diuji lewat `file://`: **0 permintaan jaringan keluar** (benar-benar mandiri), **0 error**,
dan ukuran di dalamnya sama dengan aplikasi jalan (HP: daftar 490px, baris 120px, menubar 0;
desktop: menubar 27px, baris 43px).

Catatan: satu hal teknis yang perlu ditangani — gaya layar sentuh memakai `@media (pointer: coarse)`,
sedangkan iframe di desktop tidak mewarisi jenis pointer. Jadi untuk salinan HP syarat itu dipaksa
aktif dan untuk salinan desktop dipaksa nonaktif, supaya keduanya tampil benar di perangkat apa pun.

---

## Verifikasi

`tsc` bersih · **117 test lolos** · **build produksi sukses** · lint **tetap 30** ·
target sentuh efektif **0 yang di bawah 44 px** · **desktop tetap rapat** (20–24 px, menubar tetap ada) ·
complete→undo benar (7→6→7) · **tidak ada error browser**.

Sempat menambah 1 error lint (ref ditulis saat render) — sudah dihapus, kembali ke 30.

## Catatan jujur

- Menubar disembunyikan **hanya di perangkat sentuh**. Di desktop tidak ada yang berubah
- Aku bisa membuktikan jumlah tap, tinggi baris, dan ruang layar. Membuktikan orang
  sungguhan merasa "tidak ribet" tetap butuh uji dengan pengguna harian
- Yang belum kusentuh: 30 error lint lama, Tree View mati, README usang — bukan soal kenyamanan harian

**Coba:** live preview dari HP → `admin1` / `admin123` (akun demo sandbox, bukan akun produksi) → tekan **Buka link** pada tugas mana pun →
kembali ke app → bar "Sudah selesai dikerjakan?" muncul siap ditekan.
