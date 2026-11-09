# Audit Tombol & Fungsi — Ronde 3

Tanggal: 8 November 2026 · Cabang: `arena/25fed616-mbg` · PR #5

Ronde ini menjawab dua hal: **kenapa "tambah tugas" kadang tidak bisa disimpan**, dan
**pemeriksaan menyeluruh semua tombol/fungsi** — di desktop maupun layar HP.

Total **126 pemeriksaan otomatis** dijalankan ulang pada kode akhir; **0 gagal**.
Rinciannya: 42 (dialog/form & kartu) + 36 (undo, catatan, template, admin, import/export,
pengaturan) + 10 (HP 390 px) + 3 (skenario koneksi hilang) + 30 (audit logika ronde 2)
+ 5 (cache offline).

---

## 1. Kenapa "Tambah tugas" tidak bisa disimpan

### Penyebab A — kunci percobaan tidak pernah dilepas (penyebab utama)

Aplikasi memakai *idempotency key* (`clientRequestId`) supaya tugas tidak dobel kalau
jaringan lambat lalu pengguna menekan Simpan dua kali. Server menolak kunci yang sama
dengan **isi berbeda** lewat `409 REQUEST_PAYLOAD_CONFLICT`.

Masalahnya, di sisi browser kunci itu disimpan **per dialog**, bukan per isi:

1. Pengguna menekan Simpan → server **berhasil menyimpan**, tetapi responsnya hilang
   di jaringan (HP pindah sinyal, tab ditutup, koneksi terputus).
2. Browser menganggap gagal, lalu **menyimpan kunci tadi** untuk percobaan berikutnya.
3. Pengguna memperbaiki/mengubah isi tugas, lalu menekan Simpan lagi.
4. Terkirim: **kunci lama + isi baru** → server menolak dengan pesan
   *"Tugas dari percobaan ini sudah tersimpan dengan isi berbeda."*
5. Karena kunci tidak pernah dilepas, **setiap** percobaan berikutnya ditolak dengan
   pesan yang sama. Tombol Simpan terlihat "rusak" sampai dialog ditutup dan dibuka lagi.

**Bukti (kode sebelum perbaikan, dijalankan di browser sungguhan):** setelah respons
sengaja dibuang lalu nama tugas diubah, Simpan ditekan **3 kali** — semuanya gagal
dengan pesan yang sama, dialog tidak pernah tertutup.

**Perbaikan** (`src/lib/task-form.ts`, `src/app/page.tsx`):

| Keadaan | Perilaku baru |
|---|---|
| Isi **sama**, tekan Simpan lagi | kunci **sama** → tetap tidak dobel (idempoten) |
| Isi **berubah** setelah gagal | kunci **baru** → Simpan berhasil |
| Server bilang percobaan lama sudah tersimpan | kunci dilepas, daftar dimuat ulang, pesan jelas |
| Berhasil simpan | kunci dilepas seperti sebelumnya |

Pesan yang muncul sekarang menjelaskan apa yang terjadi:
*"Tugas dari percobaan sebelumnya sudah tersimpan (koneksi mungkin terputus). Daftar
sedang diperbarui — periksa dulu. Tekan Simpan lagi hanya kalau ini memang tugas yang berbeda."*

### Penyebab B — browser tanpa Web Crypto

`newTaskRequestId()` bergantung pada `crypto.randomUUID`. Di browser lama / konteks
tidak aman (mis. dibuka lewat `http://` alamat IP), fungsi itu **melempar error di luar
blok `try/catch`** sehingga tombol Simpan tampak mati total tanpa pesan apa pun.
Sekarang ada jalur cadangan, jadi pembuatan kunci tidak pernah gagal.

**Pengujian:** 8 tes baru di `tests/task-form.test.ts` (18 → **26 tes**). Satu tes
("isi diubah setelah gagal → percobaan baru") **gagal** ketika kode lama dipasang
kembali, dan lulus dengan perbaikan — bukti perbaikannya nyata, bukan kebetulan.

---

## 2. Bug lain yang ditemukan saat menyisir tombol

### Bug: tombol **Simpan** catatan terdorong keluar panel

Di panel 📝 Catatan, saat sebuah catatan **diedit**, muncul tombol tambahan "Batal".
Pada layar ≥769 px, `.win95-btn` punya `min-width: 100px`, sehingga
7 kotak warna + Batal + Simpan = ±358 px padahal panelnya hanya 320 px.

Akibatnya tombol Simpan meluber keluar panel: tepi kanannya di **x = 1330** sementara
layar berakhir di **1280** → separuh tombol terpotong dan titik tengahnya berada di
luar layar. Catatan yang sedang diedit praktis tidak bisa disimpan.

**Perbaikan:** baris aksi memakai `flex-wrap` dan kedua tombol `min-width: auto`.
Sesudah perbaikan tepi kanan tombol = **1272** (di dalam layar) dan bisa diklik —
diverifikasi di 1280 px maupun 390 px.

### Bug: konfirmasi **Hapus Catatan** muncul di belakang panel catatan

Konfirmasi dibuka **dari** panel catatan, tetapi z-index overlay dialog hanya **200**
sementara panel catatan **5000**. Di desktop dialog di tengah masih lolos dari panel
320 px di kanan, jadi terlihat baik-baik saja. Di HP (390 px) panel menutupi hampir
seluruh layar → tombol **Ya/Tidak tidak bisa ditekan sama sekali**, catatan tidak
pernah terhapus, dan dialognya tertinggal menutupi aplikasi.

**Perbaikan:** overlay konfirmasi memakai z-index 5500 (di atas panel catatan,
di bawah menu konteks 6000 dan toast 9999).

### Bug: tombol **📁 Collapse / 📂 Expand** di menu proyek tidak melakukan apa pun

Ini sisa tampilan pohon (folder) lama. State `expandedProjects` ditulis di 13 tempat,
tetapi **tidak dibaca oleh tampilan mana pun** — satu-satunya pembacaan adalah untuk
menentukan label tombol itu sendiri. Jadi tombolnya hanya berubah tulisan
"Collapse" ↔ "Expand" tanpa efek apa pun ke daftar tugas.

**Perbaikan:** item menu tersebut dihapus beserta fungsi `toggleFolder`. Menyaring
proyek tetap lewat mengklik namanya di sidebar (diuji: 4 → 2 → 4 kartu).

### Perbaikan HP: tab **Selesai** tersembunyi di luar layar

Baris tab filter dijadikan strip geser dengan **scrollbar disembunyikan**. Setelah
angka jumlah ditambahkan (ronde 1), lebarnya jadi 405 px pada layar 390 px: tab
"✔ Selesai" berakhir di **x = 429** — di luar layar, tanpa petunjuk apa pun bahwa
tab itu ada. Filter Selesai praktis tidak bisa dipakai di HP.

**Perbaikan:** di layar sentuh tab jadi **grid 4 kolom**; ikon dipindah ke
`<span class="v3-tab-icon">` dan disembunyikan di HP. Sekarang keempat tab terlihat
sekaligus, masing-masing tetap **44 px** tingginya.

### Perbaikan HP: tombol OK/Batal dialog panjang harus digulir dulu

Dialog Pengaturan tingginya ±1013 px pada layar 844 px, sehingga OK/Batal berada di
**y = 1016** (di bawah layar). Tombolnya sebenarnya bisa dijangkau dengan menggulir,
tetapi mudah dianggap "tidak ada". Kini footer **semua** dialog menempel di dasar
dialog pada layar ≤760 px (sama seperti form tugas): OK terlihat di **y = 723**
tanpa perlu menggulir.

---

## 3. Hasil sisir tombol per kelompok

Semua baris di bawah lulus pada kode akhir.

| Kelompok | Tombol/fungsi yang diuji | Hasil |
|---|---|---|
| Dialog tambah tugas | Tugas Baru, validasi nama/link/jam, Batal + konfirmasi buang draft, Simpan & tambah lagi, Simpan & selesai, Ctrl+Enter | 7/7 |
| Koneksi hilang | ulangi isi sama (tidak dobel), ubah isi lalu simpan (tidak terkunci) | 3/3 |
| Kartu & detail | klik nama → detail, catatan otomatis, Pin, Edit, Simpan perubahan, Duplikat, Pindah ke Project, Hapus + konfirmasi, Reset, Buka Link | 10/10 |
| Selesai & undo | ✓ Selesai, Undo di toast, ↩ Batalkan selesai, return-bar "Sudah selesai"/"Belum" | 6/6 |
| Filter & massal | 4 tab, kolom cari + kosongkan, Pilih beberapa, Pilih semua, Selesaikan pilihan, Batal memilih | 6/6 |
| Proyek | + Proyek baru, menu klik-kanan (9 item), Tambah Task, Complete Semua Siap, Sort A-Z/default, Edit Nama/Warna, Export Project, Share Project + Salin, Hapus + jumlah tugas, filter sidebar | 9/9 |
| Catatan | buka panel, Tambah, Edit + Simpan, Pin, Hapus + konfirmasi, tutup panel | 4/4 |
| Template | + Template Baru, pakai template di form, Edit, Hapus + konfirmasi | 4/4 |
| Admin | Panel Admin, + Buat Kode User, Refresh, Block/Unblock, hapus kode undangan | 5/5 |
| Import/Export | Export Backup (JSON valid), Import Data (toast jumlah), Import Share Code (Cek → pratinjau → Import) | 4/4 |
| Pengaturan | buka, auto-selesai ON/OFF mengubah label kartu, format jam tersimpan, Batal tidak menyimpan | 5/5 |
| Menu & tampilan | File/Alat/Bantuan, menu profil, Monitor ↔ Daftar, kartu statistik Monitor, Lainnya ▾ (Pengingat, Telegram, Muat ulang), tutup toast | 9/9 |
| Keyboard | N, 1–4, Ctrl+Enter, Escape | 4/4 |
| HP 390 px | 1 kolom, target sentuh ≥44 px, menu Lainnya memuat Export/Import, tambah+simpan, 4 tab terlihat, menu ⋯ → Detail, panel catatan, konfirmasi di atas panel, aksi massal, Pengaturan | 10/10 |
| Kesehatan | tidak ada error JavaScript di seluruh penyisiran (desktop & HP) | bersih |

---

## 4. Gerbang mutu (kode akhir)

| Pemeriksaan | Hasil |
|---|---|
| `npx tsc --noEmit` | 0 error |
| `npm run lint:baseline` | 30 error = baseline 30, **0 warning** (tidak ada utang baru) |
| `npm test` | **296 lulus**, 1 dilewati (17 berkas) |
| `npm run build` | sukses |
| Sisir tombol desktop | 42/42 dan 36/36 |
| Sisir tombol HP | 10/10 |
| Skenario koneksi hilang | 3/3 |
| Audit logika ronde 2 | 30/30 |
| Cache offline | 5/5 |

Catatan: `npm test` masih berakhir dengan kode keluar 1 karena *engine* Prisma tidak
tersedia di sandbox (bukan kegagalan tes); seluruh tesnya lulus dan CI hijau.

---

## 5. Yang belum bisa dipastikan dari sandbox

- **Notifikasi push & izin browser**: butuh HTTPS + interaksi pengguna nyata;
  tombolnya ada dan panel Pengingat menampilkan status dengan benar, tetapi pengiriman
  push sesungguhnya belum diuji.
- **Telegram**: dialog, status koneksi, dan penyimpanan username bot diuji dengan
  layanan tiruan; pengiriman pesan asli belum diuji.
- **Database produksi**: semua uji memakai data contoh di memori. Uji di produksi
  (khususnya login `mimin` setelah `COOKIE_SECRET` dipasang) tetap perlu dilakukan.
- **Browser selain Chromium**: Safari iOS dan Firefox belum diuji otomatis.

## 6. Catatan yang sengaja tidak diubah

- `startWorking` / mode "Kerjakan", `renderStatusGroup`, `getProjectStats`: kode mati
  yang sudah tidak terjangkau sejak tampilan kartu. Tidak menghapusnya menjaga
  perubahan ronde ini tetap kecil; bisa dibersihkan terpisah.
- `expandedProjects` masih ditulis di beberapa tempat (sisa auto-expand lama) walau
  tidak lagi dibaca untuk tampilan. Membersihkannya berarti menyentuh 13 titik;
  ditunda agar tidak menambah risiko.
- Perilaku **auto-selesai saat klik link** masih pengaturan global (default OFF);
  pilihan per-tugas belum diputuskan.
