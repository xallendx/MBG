# Hasil Cek — MBG Airdrop Task Manager

Diperiksa dengan **menjalankan aplikasinya**, bukan hanya membaca kode.
Tanggal cek: 8 November 2026. Commit: `943060b`.

**Tidak ada file kode yang diubah.** Semua temuan di bawah adalah kondisi repo apa adanya.

---

## 1. Apa yang sudah terbukti jalan

Aku jalankan app dengan Postgres lokal + seed demo, lalu uji lewat browser sungguhan (headless Chromium).

| Pemeriksaan | Hasil |
|---|---|
| `npx tsc --noEmit` | ✅ Lolos, 0 error |
| `npm test` (vitest) | ✅ **117 test lolos**, 9 file |
| `npm run build` (produksi) | ✅ Berhasil, 42 route ter-build |
| Migration ke DB kosong | ✅ 11 tabel terbentuk dari `20260101000000_init` |
| Login → dashboard | ✅ Akun demo masuk, 11 task / 4 proyek tampil |
| Tombol **Selesai** | ✅ Status pindah `siap → selesai`, counter update (7→6 siap, 0→1 selesai) |
| **Undo** dari notifikasi | ✅ Balik benar ke kondisi awal (6→7 siap, 1→0 selesai) |
| Dialog Tugas Baru | ✅ Form render, pilihan jadwal lengkap |
| Monitor view | ✅ Statistik + progress bar benar (Siap 64%, Menunggu 36%) |
| Tampilan HP (390×844) | ✅ Rapi, tombol jadi full-width, tidak ada overflow horizontal |
| Cron tanpa secret | ✅ Ditolak **401** (fail-closed, sesuai klaim README) |
| Cron dengan secret | ✅ 200, `usersChecked: 1`, retensi jalan |
| Error browser saat pakai app | ✅ Tidak ada `pageerror` / crash |

Tema Win95-nya konsisten dan enak dilihat — sidebar proyek, daftar dua tingkat, dan statusbar jam WITA semuanya render sesuai niatnya.

> Catatan: ikon emoji tampak kotak-kotak di screenshot uji karena font emoji tidak ada
> di Chromium headless sandbox. Itu artefak alat cek, **bukan** bug aplikasi.

---

## 2. Temuan yang perlu diperbaiki

### 🔴 A. Web Push mati total — service worker gagal install

**Ini yang paling serius, dan lolos dari semua test yang ada.**

`public/sw.js:10-14` melakukan ini saat install:

```js
cache.addAll(['/', '/favicon.ico'])
```

Tapi **`/favicon.ico` tidak ada di repo** — `public/` hanya berisi `logo.svg`, `robots.txt`, `sw.js`.
Aku cek: `GET /favicon.ico` → **404**.

`cache.addAll()` itu **atomik**: satu URL gagal → seluruh install gagal → service worker
langsung dibuang. Hasil uji di browser:

```
SW RESULT:   { finalState: "redundant", registrations: 0, active: false }
CACHE PROBE: { "/": 200, "/favicon.ico": 404,
               addAll: "GAGAL: TypeError: Failed to execute 'addAll' on 'Cache'" }
```

**Efek berantainya:** di `src/app/page.tsx:308-309`

```js
const registration = await navigator.serviceWorker.register('/sw.js')
await navigator.serviceWorker.ready   // ← tidak pernah resolve
```

`navigator.serviceWorker.ready` menunggu worker aktif. Karena worker jadi `redundant`,
baris ini **menggantung selamanya**. Jadi subscription push tidak pernah dibuat, tidak pernah
dikirim ke `/api/push/subscribe`, dan tabel `PushSubscription` selalu kosong.

**Artinya:** klaim "notifikasi tetap jalan saat aplikasi ditutup" saat ini **hanya berlaku
untuk Telegram**. Jalur Web Push — yang justru bagian `PERBAIKAN-FUNDAMENTAL.md` P0-1 —
tidak pernah hidup, padahal cron-nya sudah benar.

**Perbaikan (kecil):**
1. Hapus `'/favicon.ico'` dari `addAll`, atau tambahkan file-nya ke `public/`.
2. Ganti juga 4 referensi ikon lain ke `/logo.svg` (`sw.js:31,42,43` dan `page.tsx:410`).
3. Buat install tahan gagal: `cache.addAll([...]).catch(() => {})` supaya aset yang hilang
   tidak lagi mematikan push.
4. Tambah timeout pada `await navigator.serviceWorker.ready` agar tidak menggantung.

---

### 🟠 B. `npm run lint` gagal — 30 error, dan CI tidak menjalankannya

```
✖ 31 problems (30 errors, 1 warning)   ← semuanya di src/app/page.tsx
```

| Aturan | Jumlah |
|---|---|
| `react-hooks/immutability` | 14 |
| `react-hooks/refs` | 13 |
| `react-hooks/set-state-in-effect` | 2 |
| `react-hooks/preserve-manual-memoization` | 1 |

Contoh nyata — tulis ref saat render (`page.tsx:752-754`):

```js
const fetchDataRef = useRef(fetchData)
fetchDataRef.current = fetchData          // ← ditulis di badan render
const registerPushRef = useRef(registerPushSubscription)
registerPushRef.current = registerPushSubscription
```

Ini pola yang bikin React Compiler menolak mengoptimasi komponen, dan bisa bikin
UI tidak update sesuai harapan.

**Yang bikin lolos:** `.github/workflows/ci.yml` hanya menjalankan
`migrate deploy` → `tsc` → `test` → `build`. **`npm run lint` tidak ada di CI.**
Jadi 30 error ini tidak pernah ketahuan padahal script-nya ada di `package.json`.

React Compiler belum diaktifkan di `next.config.ts`, jadi build sekarang tidak terpengaruh —
tapi ini menghambat kalau nanti mau menyalakannya, dan `npm run lint` praktis tidak bisa dipakai.

**Perbaikan:** bereskan pelan-pelan (pindahkan penulisan ref ke `useEffect`), lalu tambahkan
step `npm run lint` ke CI supaya tidak balik lagi.

---

### 🟡 C. Tree View ada di dokumentasi, tapi tidak bisa diakses

README menampilkan **Tree View** sebagai fitur, dan `viewMode` punya tipe `'tree'`:

```js
const [viewMode, setViewMode] = useState<'tree' | 'dashboard' | 'monitor'>('dashboard')
```

Tapi di seluruh 4.236 baris `page.tsx`:
- **tidak ada satu pun** `setViewMode('tree')`
- `renderFolder()` (baris 2492) **tidak pernah dipanggil** — mati total
- toolbar hanya punya 2 tombol: Daftar (dashboard) dan Monitor

Jadi ada ~100 baris kode render yang tidak bisa dijangkau, plus state `expandedProjects`
yang cuma dipakai kode mati itu. Pilihannya: hapus kode matinya, atau hidupkan lagi tombolnya.

---

### 🟡 D. Dokumentasi tidak sinkron dengan kode

| Lokasi | Tertulis | Kenyataan |
|---|---|---|
| `README.md:25` | "Styling: **Tailwind CSS 4**" | Tidak dipakai. Baris 162 README sendiri bilang "tidak memakai Tailwind" — kontradiksi internal |
| `README.md:151` | schedule.ts "**13 test**" | Sebenarnya **34 test** |
| `README.md` tabel shortcut | "**P** = Project Baru" | Tidak ada `case 'p'` di handler keyboard. Dialog Bantuan di app juga tidak menyebut P |
| `vitest.config.ts:5` | komentar soal `postcss.config.mjs` | File itu sudah tidak ada |

Shortcut yang benar-benar jalan: `R F / N T D M 1-4 ? Esc Ctrl+Enter`.

---

### 🟢 E. Dependency tidak terpakai

- **`sharp`** (produksi) — tidak ada `next/image` maupun `<Image>` di seluruh `src/`. Murni beban install.
- **`bun-types`** (dev) — tidak dirujuk di `tsconfig.json` maupun kode mana pun.
- **`@types/bcryptjs`** — sudah deprecated; bcryptjs v3 membawa type sendiri (npm memperingatkan saat install).

README bilang "8 dependency produksi" — setelah buang `sharp` jadi 7.

---

## 3. Urutan yang aku sarankan

1. **Bug A (Web Push)** — paling kecil effort, paling besar dampak. Ini memulihkan janji inti produk.
2. **Bug B** — tambahkan `lint` ke CI dulu supaya kelihatan, lalu bereskan 30 error bertahap.
3. **C + D** — bersihkan kode mati dan samakan dokumentasi. Cepat, dan mengurangi bingung nanti.
4. **E** — hapus 3 dependency, install jadi lebih ringan.

Fondasinya sendiri bagus: 117 test lolos, type-check bersih, build produksi sukses,
cron fail-closed, rate limit sudah berbasis DB, dan alur complete/undo bekerja benar.
Masalah utamanya bukan fondasi — tapi **satu aset hilang yang mematikan seluruh jalur Web Push**,
dan **lint yang tidak pernah dijalankan CI**.
