# Mission Control 2D — EXELYN AI Team Dashboard

Dashboard Mission Control bergaya **game 2D pixel-art** untuk memantau dan
mengelola tim AI. Berjalan **hanya di localhost:3000** — tanpa aplikasi lain,
tanpa layanan eksternal, tanpa dependensi pihak ketiga.

```
http://localhost:3000
```

---

## Cara Menjalankan

```bash
cd ~/mission-control-2d
./start.sh
```

Atau langsung:

```bash
python3 server.py                 # default 127.0.0.1:3000
python3 server.py --port 3000     # eksplisit
```

Buka browser ke **http://localhost:3000**.

Hentikan server dengan `CTRL+C` (atau `kill` PID-nya).

---

## Persyaratan

- Python 3.8+ (memakai pustaka standar saja: `http.server`, `sqlite3`, `json`)
- Browser modern dengan Canvas 2D
- Tidak ada `pip install`, tidak ada `npm install`, tidak ada aplikasi lain

---

## Fitur

### Modul Mission Control
| Halaman | Isi |
|---|---|
| **Dashboard** | Metrik ringkas, distribusi state agent, task prioritas, aktivitas terbaru |
| **Agents** | Kartu semua agent + modal detail (state, room, tugas, riwayat, **hasil AI**) |
| **Task Board** | Kanban 4 kolom: To Do · In Progress · Review · Done |
| **Kalender** | Event tim (meeting, review, milestone) |
| **Aktivitas** | Log lengkap seluruh aktivitas tim |
| **Memory** | Basis pengetahuan tim (kategori + tag) |
| **Visual 2D Office** | Ruang kerja pixel-art dengan agent yang hidup |

### Visual 2D Office
- **Kamera 2D penuh**: drag untuk menggeser, scroll untuk zoom, tombol `＋ − ⤢ 🎯`
- **Peta keyboard**: `←↑→↓` geser · `+`/`-` zoom · `0` reset
- **Tab ruangan**: Workspace · Lounge · Semua Ruangan (kamera terbang ke ruangan)
- **Ikuti agent**: klik karakter, lalu tekan 🎯 agar kamera mengikutinya
- **Dua ruangan + koridor**: Workspace (5 meja, monitor, rak, papan status) dan
  Lounge (sofa, TV, meja kopi, mesin kopi, lampu, poster)
- **Lima ruangan + lorong**: Workspace, Lounge, Ruang Meeting, Pantry, dan Taman.
  Ruangan baris bawah dihubungkan ke lorong lewat **pintu** di dindingnya —
  tanpa pintu itu jalur navigasi (grid BFS) buntu dan agent bisa macet permanen
- **Teks tajam**: label & bubble dirender di layer layar (high-DPI), bukan pixelated
- **Grafis bertekstur**: lantai ubin bervariasi, dinding ber-panel, serat kayu
  pada meja & rak, kain pada sofa & karpet, logam pada kulkas & lemari, bayangan
  lembut, rim light, glow monitor/TV/lampu, dan vignette pencahayaan
- **Ringan**: dekorasi statis (lantai, dinding, panel, pintu) dicache ke
  offscreen canvas sekali, sehingga render tetap cepat (~6 ms/frame)

### Agent yang hidup
- Muncul dari pintu masuk, lalu **berjalan** ke meja/spot-nya
- **Bekerja menghadap komputer** — tampak dari belakang (rambut menutupi kepala,
  tanpa wajah, memakai headset, tangan menjangkau keyboard). Tidak menghadap kamera.
- Agent idle **berkeliaran** di Lounge: sofa, mesin kopi, meja kopi, jalan-jalan
- **Bubble di atas kepala**: nama + tugas nyata (atau aktivitas saat ini)
- **Bubble dialog dengan giliran bicara**:
  - hanya **satu agent bicara pada satu waktu** — yang lain menampilkan
    tanda menunggu `…` beranimasi
  - ada **jeda** antar giliran, sehingga percakapan mudah diikuti
  - nama pembicara tertulis di dalam bubble
  - maksimal **satu percakapan per ruangan** agar tidak ramai
- **Isi obrolan berbeda per ruangan**:
  - **Workspace** → membahas pekerjaan, dirangkai dari **data nyata**:
    judul task dari database, statusnya, siapa yang memegang, dan ringkasan
    progres (mis. `"Oke. Dari 8 task, 1 selesai dan 2 masih jalan."`)
  - **Lounge** → obrolan **santai, tidak membahas pekerjaan** (kopi, musik,
    akhir pekan, tanaman, camilan, dsb.)
- **Pekerjaan baru datang → obrolan langsung dihentikan, agent kembali ke
  komputernya** dan menghadap layar lagi
- Mata berkedip, badan bernapas, kaki melangkah, asap kopi mengepul

### Hasil AI per Agent
Setiap agent menjalankan **otak AI** sendiri di latar belakang: model AI
membaca data nyata terbaru (pekerjaan terbuka, perubahan terakhir, keadaan
rekan satu kantor) lalu memutuskan apa yang dilakukan, apa yang dipikirkan,
dan apa yang dirasakan agent itu. Hasilnya disimpan di tabel `agent_mind`.

Halaman **Agents** menampilkannya langsung:

| Kolom | Asal |
|---|---|
| Mood & emosi agent | Model AI |
| "Sedang Memikirkan" | Model AI |
| Aktivitas (AI) | Model AI |
| Aksi & alasan | Model AI |
| Model AI yang memutuskan | Model AI |
| Ingatan terakhir agent | Model AI |

Modal detail agent menampilkan semuanya sekaligus, plus model AI yang
dipakai dan kapan keputusan terakhir diambil. Agent yang belum pernah
mengambil keputusan ditandai `Belum ada data AI` — bukan data karangan.

---

## Integritas Data

Ini penting dan disengaja:

| Jenis data | Sumber | Status |
|---|---|---|
| Nama, role, warna avatar agent | Database backend | **NYATA** |
| State agent (working/idle/reviewing/...) | Database backend | **NYATA** |
| Judul tugas di atas kepala | Tabel `tasks` (di-join) | **NYATA** |
| Topik obrolan Workspace (judul task, status, assignee, progres) | Tabel `tasks` | **NYATA** |
| Activity feed, kalender, memory, channel | Database backend | **NYATA** |
| Mood, emosi, pikiran, aktivitas, alasan tiap agent | Otak AI (`agent_mind`) | **NYATA** |
| Model AI yang memutuskan tiap agent | Otak AI (`agent_mind`) | **NYATA** |
| Posisi, gerakan, giliran bicara, dan kalimat obrolan | Simulasi di klien | **SIMULASI** |
| Topik obrolan Lounge (santai) | Daftar kalimat di klien | **SIMULASI** |

Gerakan dan dialog **dilabeli jelas** dengan badge kuning
`● SIMULASI GERAK & DIALOG — topik obrolan dari data nyata` di sudut kanvas,
sehingga tidak pernah tertukar dengan data operasional yang nyata.

Data yang tidak tersedia ditampilkan sebagai `Not Available`, bukan dikarang.

---

## Struktur Proyek

```
mission-control-2d/
├── server.py                     # HTTP server + REST API + SQLite (stdlib)
├── start.sh                      # Jalankan server di localhost:3000
├── run_tests.sh                  # Jalankan seluruh pengujian
├── templates/
│   └── index.html                # Shell aplikasi (SPA)
├── static/
│   ├── css/style.css             # Tema Mission Control gelap + pixel-art
│   └── js/
│       ├── api.js                # Klien REST API
│       ├── office.js             # Renderer 2D + kamera + simulasi agent
│       └── app.js                # Logika aplikasi & navigasi
├── tests/
│   └── test_office_renderer.js   # Uji fungsional tanpa browser (19 tes)
└── data/
    └── mission.db                # Database SQLite (dibuat otomatis)
```

---

## REST API

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/dashboard` | Ringkasan metrik |
| GET | `/api/agents` | Daftar agent (termasuk `mind`: hasil AI) |
| GET | `/api/agents/{id}` | Detail agent + aktivitas + task + `mind` (hasil AI) |
| POST | `/api/agents/{id}/state` | Ubah state agent `{state, room}` |
| GET | `/api/tasks` | Daftar task (`?status=`) |
| POST | `/api/tasks` | Buat task |
| PUT | `/api/tasks/{id}` | Ubah task |
| DELETE | `/api/tasks/{id}` | Hapus task |
| GET | `/api/activities` | Log aktivitas (`?limit=`) |
| GET | `/api/calendar` | Event kalender |
| GET / POST | `/api/memory` | Catatan memory |
| DELETE | `/api/memory/{id}` | Hapus catatan |
| GET | `/api/channels` | Status channel |
| GET | `/api/office` | Data ruangan + agent + tugas nyata |

---

## Pengujian

```bash
./run_tests.sh
```

Mencakup: sintaks Python & JavaScript, **19 tes fungsional** `OfficeRenderer`
(dijalankan di Node dengan stub Canvas/DOM — tanpa browser), dan pemeriksaan
seluruh endpoint API.

Yang diuji antara lain:
- Canvas menyesuaikan ukuran panel meski diinisialisasi saat tersembunyi
- Semua agent bergerak secara realtime
- Agent tiba di meja lalu mulai bekerja
- Sesi obrolan terbentuk dan berisi dialog tentang project
- Nama agent & judul tugas nyata dirender di atas kepala
- Zoom dan geser kamera berfungsi
- Agent yang mendapat pekerjaan baru menghentikan obrolan & kembali ke meja

---

## Deploy (GitHub + Vercel + Railway)

Repo ini siap dipublish. Backend memakai **Python standard library saja**
(zero dependencies), jadi tidak butuh `pip install`.

### 1. GitHub
```bash
cd mission-control-2d
git init
git add -A
git commit -m "Mission Control 2D"
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

### 2. Backend → Railway
Backend (`server.py`) adalah HTTP server stdlib Python yang menyajikan
`/api/*` dan database SQLite. Railway menjalankannya lewat `Procfile`:

```
web: python3 server.py --host 0.0.0.0 --port $PORT
```

Langkah:
1. Buat project baru di Railway → **Deploy from GitHub repo** ini.
2. Railway otomatis memakai `railway.json` (builder Nixpacks, port dari `$PORT`).
3. Setelah aktif, salin **URL domain** Railway (mis. `https://xxx.up.railway.app`).

> Catatan: database SQLite di Railway bersifat **ephemeral** — file
> `data/mission.db` bisa hilang saat container restart. Untuk data persisten,
> gunakan volume Railway atau ganti ke PostgreSQL.

### 3. Frontend → Vercel
Frontend (HTML + JS di `static/` dan `templates/`) di-deploy ke Vercel sebagai
static site. `vercel.json` sudah mengatur:
- `/` → `templates/index.html`
- `/api/*` → dialihkan ke URL backend Railway

Langkah:
1. Buat project baru di Vercel → **Import Git Repository** ini.
2. Set environment variable `BACKEND_URL` = URL Railway (langkah 2).
3. Deploy. Frontend akan memanggil API di backend Railway.

### Lingkungan lokal
```bash
python3 server.py --host 0.0.0.0 --port 3000
# buka http://localhost:3000
```
Host/port juga bisa dari environment variable `HOST` dan `PORT`.

---

## Reset Data Demo

Hapus database — server akan membuat ulang data demo saat dijalankan:

```bash
rm -f data/mission.db
python3 server.py
```

---

## Batasan yang Diketahui

- Data demo (agent, task, aktivitas) disimpan di SQLite lokal dan **bukan**
  terhubung ke Hermes core — ini Mission Control yang berdiri sendiri.
- Simulasi gerak/dialog berjalan di klien; membuka banyak tab akan menjalankan
  simulasi terpisah di tiap tab (data tetap sama karena bersumber dari backend).
- Channel messaging (Telegram/Discord/Slack) hanya menampilkan **status**
  yang tersimpan di database; belum ada integrasi koneksi nyata.

# uji deteksi otomatis 1792477440
