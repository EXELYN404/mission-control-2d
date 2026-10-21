/**
 * Office 2D Renderer — Mission Control 2D
 * ========================================
 * Fitur:
 *  - Kamera 2D: drag untuk geser, scroll untuk zoom, tombol reset/ikuti agent
 *  - Teks tajam (high-DPI, dirender di layer layar — bukan pixelated)
 *  - Simulasi gerak agent: berjalan, kerja di meja, ngopi, ngobrol
 *  - Bubble di atas kepala: task nyata + aktivitas yang sedang dilakukan
 *  - Dialog antar karakter tentang project (ditandai SIMULASI)
 *
 * Catatan integritas data:
 *  - Nama, role, state, dan task agent = data NYATA dari backend.
 *  - Gerakan, posisi, dan dialog = SIMULASI (dilabeli jelas di UI).
 */
const OfficeRenderer = (() => {

  // ============================================
  // KONSTANTA DUNIA (world units)
  // ============================================
  const WORLD = { w: 1900, h: 1540 };

  // 5 ruangan: 2 di baris atas, 3 di baris bawah, dihubungkan lorong.
  const ROOM_ORDER = ["workspace", "lounge", "meeting", "pantry", "garden"];

  const ROOMS = {
    workspace: {
      id: "workspace", name: "Workspace", icon: "🏢",
      x: 40, y: 70, w: 880, h: 690, wallH: 250,
      floor: "#2a3550", wall: "#182136", line: "#232d45",
      desc: "Area kerja utama. Agent yang bekerja duduk di meja masing-masing.",
    },
    lounge: {
      id: "lounge", name: "Lounge", icon: "☕",
      x: 980, y: 70, w: 880, h: 690, wallH: 250,
      floor: "#2f2a45", wall: "#1d1a30", line: "#282445",
      desc: "Area istirahat: sofa, TV, dan meja kopi.",
    },
    meeting: {
      id: "meeting", name: "Ruang Meeting", icon: "🗣",
      x: 40, y: 830, w: 600, h: 670, wallH: 170,
      floor: "#2b3348", wall: "#1a2133", line: "#242c40",
      desc: "Ruang diskusi: meja panjang, kursi, dan papan tulis.",
    },
    pantry: {
      id: "pantry", name: "Pantry", icon: "🍽",
      x: 700, y: 830, w: 600, h: 670, wallH: 170,
      floor: "#33304a", wall: "#1f1c31", line: "#2a2740",
      desc: "Dapur kecil: mesin kopi, camilan, dan meja tinggi.",
    },
    garden: {
      id: "garden", name: "Taman", icon: "🌳",
      x: 1360, y: 830, w: 500, h: 670, wallH: 170,
      floor: "#25402f", wall: "#16261c", line: "#2e4d39",
      desc: "Taman dalam ruangan: bangku, pohon, dan air mancur.",
    },
  };

  const floorTop = (r) => r.y + r.wallH;

  // ------------------------------------------------------------------
  // AREA PADAT (dekorasi yang tidak boleh dilewati agent).
  // Koordinatnya sengaja disamakan dengan fungsi gambar di bawah supaya
  // agent tidak pernah terlihat berjalan di atas perabot.
  // ------------------------------------------------------------------
  const SOLIDS = [];
  function solid(x, y, w, h) { SOLIDS.push({ x, y, w, h }); }

  function buildSolids() {
    SOLIDS.length = 0;

    // --- Workspace ---
    DESKS.forEach((d) => solid(d.cx - d.w / 2, d.top, d.w, d.h));
    const W = ROOMS.workspace;
    solid(W.x + W.w - 92, W.y + 170, 74, 110);      // rak buku
    solid(W.x + W.w - 100, W.y + 610, 84, 76);      // meja printer
    solid(W.x + 60, W.y + 570, 46, 92);             // dispenser air

    // --- Lounge ---
    const L = ROOMS.lounge;
    solid(L.x + 70, L.y + 330, 330, 96);            // sofa
    solid(L.x + 420, L.y + 420, 140, 44);           // meja kopi
    solid(L.x + 706, L.y + 486, 70, 60);            // meja mesin kopi
    solid(L.x + 696, L.y + 300, 32, 168);           // lampu berdiri
    solid(L.x + 26, L.y + L.h - 96, 26, 28);        // pot tanaman
    solid(L.x + L.w - 60, L.y + L.h - 96, 26, 28);  // pot tanaman

    // --- Ruang Meeting ---
    const M = ROOMS.meeting;
    solid(M.x + 110, M.y + 200, 340, 76);           // meja rapat
    [190, 300, 410].forEach((cx) => {
      solid(M.x + cx - 18, M.y + 162, 36, 36);      // kursi atas
      solid(M.x + cx - 18, M.y + 292, 36, 36);      // kursi bawah
    });
    solid(M.x + M.w - 80, M.y + M.h - 150, 54, 120); // lemari arsip
    solid(M.x + 24, M.y + M.h - 104, 26, 28);        // pot tanaman

    // --- Pantry ---
    const P = ROOMS.pantry;
    // Meja counter DIPENDEKKAN (380, bukan selebar ruangan) dan digeser ke
    // bawah supaya ada lajur kosong di sisi kanan. Tanpa lajur ini, meja
    // menghalangi seluruh lebar ruangan dan grid BFS tidak punya jalan
    // turun dari pintu ke lantai — agent di Pantry akan macet permanen.
    solid(P.x + 20, P.y + 260, 380, 66);         // meja counter
    solid(P.x + P.w - 110, P.y + 130, 74, 116);  // kulkas
    solid(P.x + 220, P.y + 360, 200, 20);           // meja tinggi
    [30, 96, 162].forEach((dx) => solid(P.x + 220 + dx - 14, P.y + 394, 28, 46)); // kursi bar
    solid(P.x + 26, P.y + P.h - 104, 26, 28);       // pot tanaman

    // --- Taman ---
    const G = ROOMS.garden;
    solid(G.x + 81, G.y + 260, 18, 46);             // batang pohon
    solid(G.x + G.w - 119, G.y + 330, 18, 46);
    solid(G.x + G.w - 69, G.y + G.h - 220, 18, 46);
    solid(G.x + 110, G.y + 278, 100, 42);           // bangku
    solid(G.x + 300, G.y + 278, 100, 42);
    solid(G.x + 134, G.y + 426, 132, 68);           // air mancur
    solid(G.x + 30, G.y + 180, 120, 40);            // petak bunga
    solid(G.x + G.w - 170, G.y + 180, 130, 40);
  }

  /** Apakah kaki agent (x,y) berada di dalam dekorasi? */
  function hitsSolid(x, y) {
    const l = x - 11, r = x + 11, t = y + 4, b = y + 18;
    for (let i = 0; i < SOLIDS.length; i++) {
      const s = SOLIDS[i];
      if (r > s.x && l < s.x + s.w && b > s.y && t < s.y + s.h) return true;
    }
    return false;
  }

  /** Cari posisi bebas terdekat (dipakai untuk titik tujuan yang terhalang). */
  function freeSpot(x, y, maxR = 90) {
    if (!hitsSolid(x, y)) return { x, y };
    for (let r = 14; r <= maxR; r += 14) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const nx = x + Math.cos(a) * r;
        const ny = y + Math.sin(a) * r;
        if (!hitsSolid(nx, ny)) return { x: nx, y: ny };
      }
    }
    return { x, y };
  }

  /**
   * Cari titik yang BISA DITEMPATI (walkable) terdekat. Berbeda dengan
   * freeSpot yang hanya melihat dekorasi — di sini grid walkableAt juga
   * diperiksa. Dipakai saat agent terperosok di "kantong" dekorasi yang
   * dikelilingi perabot (BFS tidak bisa keluar dari sana).
   */
  function freeWalkable(x, y, maxR = 320) {
    if (walkableAt(x, y) && !hitsSolid(x, y)) return { x, y };
    for (let r = 18; r <= maxR; r += 18) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        const nx = x + Math.cos(a) * r;
        const ny = y + Math.sin(a) * r;
        if (walkableAt(nx, ny) && !hitsSolid(nx, ny)) return { x: nx, y: ny };
      }
    }
    return { x, y };
  }

  // ------------------------------------------------------------------
  // NAVIGASI: grid + BFS.
  // Gerak lurus saja tidak cukup — agent bisa buntu di antara meja.
  // Grid dibuat sekali; jalur dicari dengan BFS lalu diikuti waypoint demi
  // waypoint, sehingga agent selalu memutari perabot dengan benar.
  // ------------------------------------------------------------------
  const CELL = 18;
  let GRID_W = 0, GRID_H = 0, GRID = null;

  /** Apakah titik ini masih di dalam area yang boleh dijelajahi? */
  function walkableAt(x, y) {
    for (const id of ROOM_ORDER) {
      const r = ROOMS[id];
      if (x >= r.x + 6 && x <= r.x + r.w - 6 &&
          y >= floorTop(r) + 4 && y <= r.y + r.h - 6) return true;
    }
    if (x >= HALL.x + 6 && x <= HALL.x + HALL.w - 6 &&
        y >= HALL.y + 4 && y <= HALL.y + HALL.h - 4) return true;
    // Pintu: menghubungkan lorong dengan ruangan baris bawah
    if (inDoor(x, y)) return true;
    return false;
  }

  function buildGrid() {
    GRID_W = Math.ceil(WORLD.w / CELL);
    GRID_H = Math.ceil(WORLD.h / CELL);
    GRID = new Uint8Array(GRID_W * GRID_H);
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const wx = gx * CELL + CELL / 2;
        const wy = gy * CELL + CELL / 2;
        const ok = walkableAt(wx, wy) && !hitsSolid(wx, wy);
        GRID[gy * GRID_W + gx] = ok ? 1 : 0;
      }
    }
  }

  const cellOf = (v, max) => Math.max(0, Math.min(max - 1, Math.floor(v / CELL)));

  // Buffer dipakai ulang (menghindari alokasi besar tiap pencarian)
  let _prev = null, _seen = null;
  // Cache jalur antar sel: agent sering menuju titik yang sama
  const pathCache = new Map();
  let pathCalls = 0;

  /** Cari jalur (BFS) dari (sx,sy) ke (tx,ty). Hasil: daftar waypoint dunia. */
  function findPath(sx, sy, tx, ty) {
    if (!GRID) return null;

    const c0x = cellOf(sx, GRID_W), c0y = cellOf(sy, GRID_H);
    let gx1 = cellOf(tx, GRID_W), gy1 = cellOf(ty, GRID_H);
    const cacheKey = `${c0x},${c0y},${gx1},${gy1}`;

    const hit = pathCache.get(cacheKey);
    if (hit) return hit;

    // Kalau sel tujuan tidak bisa dilewati, cari sel bebas terdekat
    if (!GRID[gy1 * GRID_W + gx1]) {
      let found = false;
      for (let r = 1; r <= 4 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            const nx = gx1 + dx, ny = gy1 + dy;
            if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
            if (GRID[ny * GRID_W + nx]) { gx1 = nx; gy1 = ny; found = true; }
          }
        }
      }
      if (!found) return null;
    }

    const start = c0y * GRID_W + c0x;
    const goal = gy1 * GRID_W + gx1;
    if (start === goal) return [{ x: tx, y: ty }];

    if (!_prev || _prev.length !== GRID_W * GRID_H) {
      _prev = new Int32Array(GRID_W * GRID_H);
      _seen = new Uint8Array(GRID_W * GRID_H);
    }
    _prev.fill(-1);
    _seen.fill(0);

    const queue = new Int32Array(GRID_W * GRID_H);
    let qHead = 0, qTail = 0;
    queue[qTail++] = start;
    _seen[start] = 1;
    let found = false;
    let expanded = 0;

    while (qHead < qTail) {
      const cur = queue[qHead++];
      if (cur === goal) { found = true; break; }
      if (++expanded > 4000) break;              // batas aman
      const cx = cur % GRID_W, cy = (cur - cx) / GRID_W;

      for (let k = 0; k < 8; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : k === 2 ? 0 : k === 3 ? 0 : k === 4 ? 1 : k === 5 ? -1 : k === 6 ? 1 : -1);
        const ny = cy + (k === 0 ? 0 : k === 1 ? 0 : k === 2 ? 1 : k === 3 ? -1 : k === 4 ? 1 : k === 5 ? 1 : k === 6 ? -1 : -1);
        if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
        const ni = ny * GRID_W + nx;
        if (_seen[ni] || !GRID[ni]) continue;
        if (nx !== cx && ny !== cy) {
          if (!GRID[cy * GRID_W + nx] || !GRID[ny * GRID_W + cx]) continue;
        }
        _seen[ni] = 1;
        _prev[ni] = cur;
        queue[qTail++] = ni;
      }
    }
    if (!found) return null;

    const path = [];
    let node = goal;
    while (node !== start && node !== -1) {
      const cx = node % GRID_W, cy = (node - cx) / GRID_W;
      path.push({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
      node = _prev[node];
    }
    path.reverse();
    if (path.length) path[path.length - 1] = { x: tx, y: ty };

    pathCalls++;
    if (pathCache.size > 500) pathCache.clear();
    pathCache.set(cacheKey, path);
    return path;
  }

  /** Indeks waypoint terdekat dari posisi agent (untuk memakai cache jalur). */
  function nearestWaypointIndex(path, x, y) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = (path[i].x - x) ** 2 + (path[i].y - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Ikuti jalur hasil BFS. Kembalikan true bila tujuan sudah tercapai. */
  function followPath(sim, tx, ty, dt, force = false) {
    if (sim.giveUp) {
      sim.giveUp = false;
      sim.path = null;
      return true;              // dianggap tiba → agent berhenti dengan tenang
    }
    const dTarget = Math.hypot(tx - sim.x, ty - sim.y);
    if (dTarget < 5) { sim.path = null; return true; }

    const needNew = force || !sim.path || sim.pathTx !== tx || sim.pathTy !== ty ||
      sim.pathIdx >= sim.path.length;

    if (needNew) {
      let p = findPath(sim.x, sim.y, tx, ty);
      if (!p || !p.length) {
        // Titik tujuan mungkin berada di dalam dekorasi: coba titik bebas
        // terdekat dari tujuan.
        const alt = freeSpot(tx, ty, 60);
        if (alt.x !== tx || alt.y !== ty) {
          p = findPath(sim.x, sim.y, alt.x, alt.y);
        }
      }
      if (!p || !p.length) {
        // BUG LAMA: di sini kode tetap memanggil moveToward dan selalu
        // mengembalikan false → agent berjalan di tempat SELAMANYA karena
        // dianggap tidak pernah tiba. Sekarang: menyerah dan anggap tiba,
        // supaya agent berhenti dengan tenang lalu memilih tujuan lain.
        sim.path = null;
        return true;
      }
      const sameTarget = sim.pathTx === tx && sim.pathTy === ty;
      sim.path = p;
      sim.pathTx = tx;
      sim.pathTy = ty;
      // Mulai dari waypoint terdekat. Kalau tujuan belum berubah, JANGAN mundur
      // melewati waypoint yang sudah dilalui — itu membuat gerak tak beraturan.
      const near = nearestWaypointIndex(p, sim.x, sim.y);
      const floor = sameTarget ? Math.max(0, (sim.pathIdx || 0) - 1) : 0;
      sim.pathIdx = Math.max(near, floor);
    }

    let wp = sim.path[sim.pathIdx];
    if (!wp) { sim.path = null; return true; }

    // Kalau waypoint terlalu jauh (agent terlempar), hitung ulang
    if (Math.hypot(wp.x - sim.x, wp.y - sim.y) > CELL * 3) {
      return followPath(sim, tx, ty, dt, true);
    }

    if (moveToward(sim, wp.x, wp.y, dt)) sim.pathIdx++;
    return Math.hypot(tx - sim.x, ty - sim.y) < 8;
  }

  // Lorong utama penghubung semua ruangan
  const HALL = { x: 40, y: 760, w: 1820, h: 70, cy: 795 };
  const HUB = { x: 950, y: 795 };

  // ------------------------------------------------------------------
  // PINTU — bukaan di dinding ruangan baris bawah (Meeting/Pantry/Taman).
  //
  // PENTING: lorong berakhir di y=826, sedangkan lantai ruangan baris bawah
  // baru mulai di y=1004 (dindingnya tinggi 170). Tanpa bukaan ini, grid BFS
  // TIDAK punya jalur dari lorong ke ruangan bawah — akibatnya agent yang
  // pernah berada di sana (atau menerima pekerjaan baru saat di sana) tidak
  // akan pernah bisa kembali, dan macet permanen di mode toDesk/toLounge.
  //
  // Pintu harus berada di lajur yang bebas dekorasi: Meeting di sisi kanan
  // (meja rapat menutup lajur tengah), Pantry di tengah (kulkas menutup sisi
  // kanan). Kalau tidak, dekorasi menghalangi sel grid tepat di bawah pintu
  // dan jalur tetap buntu.
  // ------------------------------------------------------------------
  const DOORS = [
    { room: "meeting", x: 504, y: 826, w: 117, h: 180 },
    { room: "pantry", x: 950, y: 826, w: 96, h: 180 },
    { room: "garden", x: 1562, y: 826, w: 96, h: 180 },
  ];

  /** Apakah (x,y) berada di dalam salah satu pintu? */
  function inDoor(x, y) {
    for (let i = 0; i < DOORS.length; i++) {
      const d = DOORS[i];
      if (x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) return true;
    }
    return false;
  }

  // Meja kerja di Workspace — 9 meja, 2 baris (seperti kantor nyata)
  const DESKS = [
    { cx: 150, top: 380 }, { cx: 310, top: 380 }, { cx: 470, top: 380 },
    { cx: 630, top: 380 }, { cx: 790, top: 380 },
    { cx: 230, top: 590 }, { cx: 390, top: 590 },
    { cx: 550, top: 590 }, { cx: 710, top: 590 },
  ].map((d) => ({ ...d, w: 120, h: 56 }));

  const deskSeat = (i) => {
    const d = DESKS[((i % DESKS.length) + DESKS.length) % DESKS.length];
    return { x: d.cx, y: d.top + 92 };
  };

  // Titik-titik yang bisa dikunjungi agent di setiap ruangan.
  // Semua titik berada di lantai yang bebas dekorasi (lihat SOLIDS).
  // `sit: true` = tempat duduk (agent memakai animasi duduk saat tiba di sini)
  const ROOM_SPOTS = {
    lounge: [
      { x: 1090, y: 530, l: "sofa", sit: true },
      { x: 1230, y: 530, l: "sofa", sit: true },
      { x: 1370, y: 530, l: "sofa", sit: true },
      { x: 1560, y: 640, l: "meja kopi", sit: true },
      { x: 1760, y: 620, l: "mesin kopi" }, { x: 1160, y: 700, l: "lantai" },
      { x: 1400, y: 700, l: "lantai" }, { x: 1650, y: 710, l: "lantai" },
    ],
    meeting: [
      { x: 180, y: 1160, l: "kursi rapat", sit: true },
      { x: 320, y: 1160, l: "kursi rapat", sit: true },
      { x: 460, y: 1160, l: "kursi rapat", sit: true },
      { x: 180, y: 1330, l: "kursi rapat", sit: true },
      { x: 320, y: 1330, l: "kursi rapat", sit: true },
      { x: 520, y: 1270, l: "papan tulis" },
      { x: 110, y: 1450, l: "lantai" }, { x: 470, y: 1460, l: "lantai" },
    ],
    pantry: [
      { x: 830, y: 1170, l: "mesin kopi" },
      { x: 970, y: 1160, l: "meja tinggi", sit: true },
      { x: 1110, y: 1160, l: "meja tinggi", sit: true },
      { x: 1250, y: 1150, l: "kulkas" },
      { x: 860, y: 1300, l: "lantai" }, { x: 1050, y: 1330, l: "lantai" },
      { x: 1210, y: 1400, l: "lantai" },
    ],
    garden: [
      { x: 1470, y: 1165, l: "bangku", sit: true },
      { x: 1660, y: 1165, l: "bangku", sit: true },
      { x: 1560, y: 1360, l: "air mancur" },
      { x: 1410, y: 1380, l: "jalan taman" }, { x: 1710, y: 1380, l: "pohon" },
      { x: 1560, y: 1450, l: "lantai" },
    ],
  };

  const spotsOf = (roomId) => ROOM_SPOTS[roomId] || ROOM_SPOTS.lounge;

  // Ruangan tempat agent berkeliaran saat tidak bekerja
  const HANGOUTS = ["lounge", "pantry", "garden", "meeting"];

  // Titik pertemuan untuk mengobrol (selalu di area kosong)
  const MEET_POINTS = {
    workspace: [{ x: 300, y: 522 }, { x: 620, y: 522 }, { x: 460, y: 522 }],
    lounge: [{ x: 1300, y: 590 }, { x: 1500, y: 590 }, { x: 1180, y: 640 }],
    meeting: [{ x: 300, y: 1210 }, { x: 200, y: 1210 }],
    pantry: [{ x: 1000, y: 1300 }, { x: 880, y: 1300 }],
    garden: [{ x: 1560, y: 1200 }, { x: 1620, y: 1350 }],
  };

  // Label status task (dipakai untuk merangkai obrolan dari data NYATA)
  const STATUS_LABEL = {
    todo: "belum dimulai",
    in_progress: "sedang dikerjakan",
    review: "sedang direview",
    done: "sudah selesai",
  };

  const TASK_TITLE_MAX = 44;

  const WORK_ACTIVITY = {
    working: ["Menulis kode", "Debugging", "Menyusun komponen", "Merancang API", "Optimasi render"],
    reviewing: ["Meninjau kode", "Memeriksa hasil", "Uji kualitas"],
    collaborating: ["Berkoordinasi", "Menyusun rencana"],
  };
  const IDLE_ACTIVITY = ["Ngopi dulu", "Istirahat sebentar", "Menunggu task baru", "Baca catatan tim"];

  // ============================================
  // STATE
  // ============================================
  let canvas, ctx;
  let staticLayer = null;       // offscreen canvas: dekorasi statis (lantai/dinding)
  let dpr = 1;
  let W = 0, H = 0;

  const camera = { x: 0, y: 0, zoom: 1, targetZoom: 1 };
  let flyTo = null;              // { x, y, zoom, t }
  let followAgentId = null;
  let selectedAgentId = null;
  let onAgentClick = null;

  let agents = [];               // data nyata dari backend
  let dataTasks = [];            // task NYATA (bahan obrolan Workspace)
  let dataSummary = null;        // ringkasan task NYATA
  let sims = new Map();          // id -> simulasi (posisi, mode, dst)
  let chats = [];                // sesi obrolan aktif
  let particles = [];
  let frame = 0;
  let lastTime = 0;
  let rafId = null;
  let dragging = false;
  let dragMoved = 0;
  let lastMouse = { x: 0, y: 0 };

  // ============================================
  // HELPER UMUM
  // ============================================
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  /** Konversi koordinat dunia → koordinat layar (CSS px). */
  function w2s(wx, wy) {
    return { x: (wx - camera.x) * camera.zoom, y: (wy - camera.y) * camera.zoom };
  }

  /** Terang-gelapkan warna hex. f<1 lebih gelap, f>1 lebih terang. */
  function shade(hex, f) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return hex || "#4ade80";
    const n = parseInt(m[1], 16);
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
    const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
    const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
    return `rgb(${r},${g},${b})`;
  }

  /**
   * Tekstur serat kayu halus (deterministik) — memberi kesan material nyata
   * pada meja, rak, dan perabot kayu lainnya.
   */
  function woodGrain(c, x, y, w, h, lines) {
    c.fillStyle = "rgba(0,0,0,0.10)";
    for (let i = 0; i < lines; i++) {
      const gy = y + 3 + ((i * 7 + Math.floor(y)) % Math.max(1, h - 5));
      c.fillRect(x + 4, gy, w - 8, 1);
    }
    // Kilau tepi atas (cahaya mengenai permukaan)
    c.fillStyle = "rgba(255,255,255,0.07)";
    c.fillRect(x, y, w, 2);
  }

  /** Tekstur kain/bertekstur halus untuk sofa & kursi. */
  function fabricTex(c, x, y, w, h) {
    c.fillStyle = "rgba(0,0,0,0.08)";
    for (let i = 0; i < 4; i++) {
      const gy = y + 2 + ((i * 9 + Math.floor(x)) % Math.max(1, h - 3));
      c.fillRect(x + 2, gy, w - 4, 1);
    }
  }

  /** Tekstur logam brushed (garis halus + kilau tepi) untuk kulkas & lemari. */
  function metalTex(c, x, y, w, h) {
    c.fillStyle = "rgba(0,0,0,0.07)";
    for (let i = 0; i < 5; i++) {
      const gy = y + 3 + ((i * 11 + Math.floor(x)) % Math.max(1, h - 5));
      c.fillRect(x + 2, gy, w - 4, 1);
    }
    c.fillStyle = "rgba(255,255,255,0.09)";
    c.fillRect(x, y, 2, h);
  }

  /** Tekstur karpet kantor — bintik halus + alur anyaman. */
  function carpetTex(c, x, y, w, h) {
    c.fillStyle = "rgba(255,255,255,0.028)";
    const n = Math.min(2000, Math.max(0, Math.floor((w * h) / 520)));
    for (let i = 0; i < n; i++) {
      const px = x + ((i * 37 + 11) % Math.max(1, w));
      const py = y + ((i * 53 + 7) % Math.max(1, h));
      c.fillRect(px, py, 2, 2);
    }
    // Alur anyaman khas karpet
    c.fillStyle = "rgba(0,0,0,0.045)";
    for (let px = x; px < x + w; px += 34) c.fillRect(px, y, 1, h);
    for (let py = y; py < y + h; py += 34) c.fillRect(x, py, w, 1);
  }

  /** Tekstur lantai kayu — papan memanjang dengan warna & sambungan. */
  function woodFloorTex(c, x, y, w, h) {
    const PLANK = 46;
    for (let px = x; px < x + w; px += PLANK) {
      const seed = Math.abs(Math.floor(px / PLANK)) % 5;
      c.fillStyle = shade("#6b4f34", 0.82 + seed * 0.07);
      c.fillRect(px + 1, y, PLANK - 2, h);
      // Sambungan papan (vertikal) + garis gelap
      c.fillStyle = "rgba(0,0,0,0.22)";
      c.fillRect(px, y, 1, h);
      // Sambungan memanjang (offset tiap papan)
      const off = (Math.abs(Math.floor(px / PLANK)) % 3) * 40 + 30;
      for (let py = y + off; py < y + h; py += 120) {
        c.fillRect(px, py, PLANK, 1);
      }
    }
  }

  /** Tekstur keramik — kotak rapi dengan grout terang. */
  function tileTex(c, x, y, w, h, tile = 54) {
    for (let ty = y; ty < y + h; ty += tile) {
      for (let tx = x; tx < x + w; tx += tile) {
        const seed = Math.abs((tx * 7 + ty * 13) / tile | 0) % 5;
        c.fillStyle = shade("#7d8794", 0.9 + seed * 0.08);
        c.fillRect(tx + 1, ty + 1, tile - 2, tile - 2);
      }
    }
    c.fillStyle = "rgba(220,230,240,0.18)";
    for (let ty = y; ty < y + h; ty += tile) c.fillRect(x, ty, w, 2);
    for (let tx = x; tx < x + w; tx += tile) c.fillRect(tx, y, 2, h);
  }

  /** Tekstur rumput taman — helai rumput + variasi warna hijau. */
  function grassTex(c, x, y, w, h) {
    for (let i = 0; i < 2600; i++) {
      const px = x + ((i * 41 + 3) % Math.max(1, w));
      const py = y + ((i * 67 + 5) % Math.max(1, h));
      const light = ((i * 13) % 8) / 8;
      c.fillStyle = `rgba(${30 + light * 50 | 0},${80 + light * 70 | 0},${34 + light * 40 | 0},0.6)`;
      c.fillRect(px, py, 2, 3);
    }
    // Beberapa bunga kecil
    for (let i = 0; i < 40; i++) {
      const px = x + ((i * 91 + 17) % Math.max(1, w));
      const py = y + ((i * 57 + 23) % Math.max(1, h));
      c.fillStyle = i % 3 ? "#e8a0bf" : "#f2d06b";
      c.fillRect(px, py, 3, 3);
    }
  }

  /** Konversi koordinat layar → koordinat dunia. */
  function s2w(sx, sy) {
    return { x: sx / camera.zoom + camera.x, y: sy / camera.zoom + camera.y };
  }

  /** Ruangan yang memuat titik (x, y); null bila berada di lorong. */
  function roomOf(x, y) {
    for (const id of ROOM_ORDER) {
      const r = ROOMS[id];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return id;
    }
    return null;
  }

  /** Ruangan terdekat dari sebuah titik (dipakai saat agent di lorong). */
  function nearestRoom(x, y) {
    let best = "workspace", bestD = Infinity;
    for (const id of ROOM_ORDER) {
      const r = ROOMS[id];
      const dx = r.x + r.w / 2 - x;
      const dy = r.y + r.h / 2 - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  /** Ruangan tempat agent berada (lorong → ruangan terdekat). */
  const roomAt = (x, y) => roomOf(x, y) || nearestRoom(x, y);

  function roomCenter(roomId) {
    const r = ROOMS[roomId] || ROOMS.workspace;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  // ============================================
  // INIT & RESIZE
  // ============================================
  function init(canvasEl, clickHandler) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    onAgentClick = clickHandler;

    buildSolids();
    buildGrid();
    staticLayer = buildStaticLayer();

    resize();
    window.addEventListener("resize", resize);

    // Ukuran canvas ikut berubah saat halaman/panel ditampilkan atau di-resize
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => resize());
      ro.observe(canvas.parentElement);
    }

    // Kamera awal: fokus Workspace (perhitungkan zoom agar tepat di tengah)
    camera.zoom = camera.targetZoom = 0.85;
    const c = roomCenter("workspace");
    camera.x = c.x - W / (2 * camera.zoom);
    camera.y = c.y - H / (2 * camera.zoom);

    // --- Kontrol kamera: drag untuk geser ---
    canvas.addEventListener("mousedown", (e) => {
      dragging = true;
      dragMoved = 0;
      lastMouse = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = "grabbing";
    });
    window.addEventListener("mouseup", () => {
      dragging = false;
      canvas.style.cursor = "crosshair";
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      flyTo = null;
      lastMouse = { x: e.clientX, y: e.clientY };
    });

    // --- Zoom dengan scroll (ke arah kursor) ---
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const before = s2w(sx, sy);
      camera.targetZoom = clamp(camera.targetZoom * (e.deltaY < 0 ? 1.15 : 0.87), 0.35, 3.2);
      camera.zoom = camera.targetZoom;
      const after = s2w(sx, sy);
      camera.x += before.x - after.x;
      camera.y += before.y - after.y;
      flyTo = null;
    }, { passive: false });

    // --- Klik agent (bedakan dari drag) ---
    canvas.addEventListener("click", (e) => {
      if (dragMoved > 6) return;
      const rect = canvas.getBoundingClientRect();
      const w = s2w(e.clientX - rect.left, e.clientY - rect.top);
      const agent = agentAtWorld(w.x, w.y);
      if (agent && onAgentClick) onAgentClick(agent);
    });

    canvas.addEventListener("mousemove", (e) => {
      if (dragging) return;
      const rect = canvas.getBoundingClientRect();
      const w = s2w(e.clientX - rect.left, e.clientY - rect.top);
      canvas.style.cursor = agentAtWorld(w.x, w.y) ? "pointer" : "crosshair";
    });

    // --- Keyboard: panah untuk geser, +/- zoom, 0 reset ---
    window.addEventListener("keydown", (e) => {
      const step = 60 / camera.zoom;
      if (e.key === "ArrowLeft") { camera.x -= step; flyTo = null; }
      else if (e.key === "ArrowRight") { camera.x += step; flyTo = null; }
      else if (e.key === "ArrowUp") { camera.y -= step; flyTo = null; }
      else if (e.key === "ArrowDown") { camera.y += step; flyTo = null; }
      else if (e.key === "+" || e.key === "=") zoomBy(1.2);
      else if (e.key === "-") zoomBy(0.83);
      else if (e.key === "0") resetCamera();
      else return;
      if (e.target === document.body) e.preventDefault();
    });

    startLoop();
  }

  // Batas aman bitmap canvas (Chromium menolak bitmap yang terlalu besar,
  // dan canvas yang melewati batas akan tampil kosong).
  const MAX_CANVAS = 4096;

  function resize() {
    const wrap = canvas.parentElement;
    if (!wrap) return;

    // clientWidth/clientHeight = content box (tanpa border), dan TIDAK dipengaruhi
    // oleh ukuran canvas karena canvas diposisikan absolute lewat CSS.
    const cssW = Math.min(Math.floor(wrap.clientWidth || 0), MAX_CANVAS);
    const cssH = Math.min(Math.floor(wrap.clientHeight || 0), MAX_CANVAS);
    if (cssW < 40 || cssH < 40) return;          // panel belum tampil

    // Idempoten: jangan sentuh apa pun kalau ukuran tidak berubah,
    // supaya tidak memicu ResizeObserver lagi (penyebab "resize loop").
    if (cssW === W && cssH === H && canvas.width > 0) return;

    const first = W < 10;
    W = cssW;
    H = cssH;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    // Catatan: style width/height TIDAK diubah di sini — ukuran elemen
    // diatur CSS (100% dari wrapper). Mengubahnya di sini menyebabkan
    // wrapper ikut membesar tanpa henti.

    // Pertama kali ukuran nyata diketahui → pusatkan kamera ke Workspace
    if (first) {
      const c = roomCenter("workspace");
      camera.zoom = camera.targetZoom = 0.85;
      camera.x = c.x - W / (2 * camera.zoom);
      camera.y = c.y - H / (2 * camera.zoom);
    }
  }

  /**
   * Perbaikan ukuran otomatis: dipanggil tiap beberapa frame.
   * Menjamin canvas selalu mengikuti ukuran panel walau di-inisialisasi
   * saat halaman masih tersembunyi (display: none).
   */
  let sizeTick = 0;
  function maybeResize() {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const w = Math.min(Math.floor(wrap.clientWidth || 0), MAX_CANVAS);
    const h = Math.min(Math.floor(wrap.clientHeight || 0), MAX_CANVAS);
    if (w < 40 || h < 40) return;
    if (w !== W || h !== H) resize();
  }

  // ============================================
  // KONTROL KAMERA (dipanggil dari UI)
  // ============================================
  function zoomBy(factor) {
    camera.targetZoom = clamp(camera.targetZoom * factor, 0.35, 3.2);
    camera.zoom = camera.targetZoom;
    flyTo = null;
  }

  function resetCamera() {
    const c = roomCenter("workspace");
    flyTo = { x: c.x, y: c.y, zoom: 0.85, t: 0 };
    followAgentId = null;
  }

  function setRoom(roomId) {
    if (roomId === "all") {
      // Perkecil agar seluruh peta (5 ruangan) masuk layar
      flyTo = { x: WORLD.w / 2, y: WORLD.h / 2, zoom: 0.37, t: 0 };
      followAgentId = null;
      return;
    }
    const c = roomCenter(roomId);
    flyTo = { x: c.x, y: c.y, zoom: 0.85, t: 0 };
    followAgentId = null;
  }

  function setFollow(agentId) {
    followAgentId = agentId;
    flyTo = null;
  }

  function getFollow() { return followAgentId; }
  function getZoom() { return camera.zoom; }
  function getCamera() { return { ...camera }; }

  // ============================================
  // DATA DARI BACKEND
  // ============================================
  function setData(data) {
    agents = data.agents || [];
    dataTasks = data.tasks || [];
    dataSummary = data.task_summary || null;

    // Urutan stabil (by id) supaya penugasan meja/spot tidak berubah-ubah
    const working = agents
      .filter((a) => isWorkingState(a.state))
      .sort((a, b) => a.id.localeCompare(b.id));
    const idle = agents
      .filter((a) => a.state === "idle" || a.state === "unknown")
      .sort((a, b) => a.id.localeCompare(b.id));

    working.forEach((a) => {
      const sim = ensureSim(a);
      // PENTING: meja ditetapkan SEKALI saat agent muncul. Sebelumnya nilai ini
      // ditimpa pada setiap penyegaran data (30 detik), sehingga agent terus
      // berpindah tujuan secara mendadak — itulah gerakan "blink".
      if (sim.deskIndex === undefined || sim.deskIndex === null) {
        sim.deskIndex = working.indexOf(a) % DESKS.length;
      }
      sim.homeRoom = "workspace";
      sim.agent = a;

      if (sim.state !== a.state) {
        // State benar-benar berubah → kembali ke meja (berjalan, bukan pindah)
        if (sim.chatId) endChatById(sim.chatId);
        sim.state = a.state;
        sim.mode = "toDesk";
        sim.activity = "Ada pekerjaan baru — menuju meja";
        sim.timer = 0;
        sim.bubble = null;
      }
    });

    idle.forEach((a) => {
      const sim = ensureSim(a);
      // Spot juga ditetapkan sekali — logika berkeliaran yang mengubahnya,
      // bukan penyegaran data.
      if (!sim.hangout) sim.hangout = "lounge";
      if (sim.spotIndex === undefined || sim.spotIndex === null) {
        sim.spotIndex = idle.indexOf(a) % spotsOf(sim.hangout).length;
      }
      sim.homeRoom = sim.hangout;
      sim.agent = a;

      if (sim.state !== a.state) {
        sim.state = a.state;
        sim.mode = "toLounge";
        sim.activity = "Menuju " + ROOMS[sim.hangout].name;
        sim.timer = 0;
        sim.bubble = null;
      }
    });

    // Agent yang tidak lagi ada di daftar → hapus sim
    const ids = new Set(agents.map((a) => a.id));
    for (const id of [...sims.keys()]) {
      if (!ids.has(id)) sims.delete(id);
    }
  }

  const isWorkingState = (s) =>
    s === "working" || s === "reviewing" || s === "collaborating";

  // Titik masuk ruangan (agent muncul dari sini lalu berjalan ke tujuannya)
  const ENTRANCE = {
    workspace: { x: 865, y: 625 },
    lounge: { x: 1035, y: 625 },
  };

  function ensureSim(agent) {
    let sim = sims.get(agent.id);
    if (sim) return sim;

    const isWork = isWorkingState(agent.state);
    const idx = isWork ? sims.size % DESKS.length : sims.size % spotsOf("lounge").length;
    const room = isWork ? "workspace" : "lounge";
    const door = ENTRANCE[room];

    sim = {
      id: agent.id,
      agent,
      // Muncul di pintu masuk, lalu berjalan ke meja/spot-nya
      x: door.x + rnd(-16, 16),
      y: door.y + rnd(-12, 12),
      tx: door.x,
      ty: door.y,
      speed: rnd(58, 66),
      facing: room === "workspace" ? "right" : "right",
      mode: isWork ? "toDesk" : "toLounge",
      state: agent.state,
      deskIndex: idx,
      spotIndex: idx,
      hangout: isWork ? null : "lounge",
      homeRoom: room,
      timer: rnd(2, 7),
      activity: isWork ? "Masuk kantor — menuju meja" : "Masuk lounge",
      bubble: null,
      chatId: null,
      resumeMode: isWork ? "work" : "loungeIdle",
      walkBob: Math.random() * 6,
      blink: rnd(2, 6),
    };
    sims.set(agent.id, sim);
    return sim;
  }

  function agentAtWorld(wx, wy) {
    for (const a of agents) {
      const sim = sims.get(a.id);
      if (!sim) continue;
      if (wx >= sim.x - 20 && wx <= sim.x + 20 && wy >= sim.y - 52 && wy <= sim.y + 18) {
        return a;
      }
    }
    return null;
  }

  function setSelectedAgent(id) { selectedAgentId = id; }

  // ============================================
  // LOOP UTAMA
  // ============================================
  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    lastTime = performance.now();

    function loop(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      frame++;
      update(dt);
      render();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  // ============================================
  // UPDATE SIMULASI
  // ============================================
  function update(dt) {
    // Cek ukuran canvas secara berkala (self-healing)
    sizeTick++;
    if (sizeTick % 20 === 0) maybeResize();

    // Kamera: animasi flyTo — SELALU mendarat tepat di target
    if (flyTo) {
      flyTo.t = Math.min(flyTo.t + dt / 0.65, 1);
      const e = 1 - Math.pow(1 - flyTo.t, 3);
      const tx = flyTo.x - W / (2 * flyTo.zoom);
      const ty = flyTo.y - H / (2 * flyTo.zoom);

      camera.x += (tx - camera.x) * e * 0.35;
      camera.y += (ty - camera.y) * e * 0.35;
      camera.zoom += (flyTo.zoom - camera.zoom) * e * 0.35;

      // Setelah durasi animasi habis, kunci posisi ke target. Tanpa ini,
      // pada frame rate rendah kamera bisa berhenti jauh dari tujuan.
      if (flyTo.t >= 1) {
        camera.x = tx;
        camera.y = ty;
        camera.zoom = flyTo.zoom;
        camera.targetZoom = flyTo.zoom;
        flyTo = null;
      }
    }

    // Kamera: ikuti agent terpilih
    if (followAgentId) {
      const sim = sims.get(followAgentId);
      if (sim) {
        camera.x += (sim.x - W / (2 * camera.zoom) - camera.x) * 0.08;
        camera.y += (sim.y - H / (2 * camera.zoom) - camera.y) * 0.08;
      }
    }

    // Update setiap agent
    for (const sim of sims.values()) {
      updateAgent(sim, dt);
    }

    // Update sesi obrolan
    updateChats(dt);

    // OTAK MANDIRI: secara berkala tiap agent memutuskan sendiri apa yang
    // dia pikirkan/lakukan (lewat model AI + data nyata terbaru).
    brainTimer += dt;
    if (brainTimer >= BRAIN_INTERVAL) {
      brainTimer = 0;
      requestBrain();
    }

    // Perilaku spontan: saling menyapa saat berpapasan
    greetTimer += dt;
    if (greetTimer >= 1.5) {
      greetTimer = 0;
      maybeGreet();
    }

    // Siapkan dialog berikutnya di latar belakang supaya tidak ada jeda
    poolTimer += dt;
    if (poolTimer >= 6) {
      poolTimer = 0;
      fillDialoguePool();
    }

    // Partikel debu/ambient
    if (frame % 24 === 0 && particles.length < 18) {
      particles.push({
        x: rnd(60, WORLD.w - 60), y: rnd(120, WORLD.h - 60),
        vx: rnd(-6, 6), vy: rnd(-12, -4),
        life: 1, decay: rnd(0.15, 0.35), size: rnd(1, 2.2),
        color: Math.random() > 0.5 ? "#4ade80" : "#22d3ee",
      });
    }
    particles = particles.filter((p) => {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt;
      return p.life > 0;
    });

    // Bubble kedaluwarsa
    for (const sim of sims.values()) {
      if (sim.bubble) {
        sim.bubble.ttl -= dt;
        if (sim.bubble.ttl <= 0) sim.bubble = null;
      }
    }
  }

  /**
   * Geser HALUS ke titik pemulihan (sim.slideTo). Mengembalikan true bila
   * sudah tiba. Dipisah supaya bisa dipanggil di semua mode agent, bukan hanya
   * saat mengikuti jalur — kalau tidak, agent yang sedang tidak mengikuti jalur
   * bisa tertahan di tengah pemulihan.
   */
  function stepSlide(sim, dt) {
    if (!sim.slideTo) return false;
    const sx = sim.slideTo.x - sim.x;
    const sy = sim.slideTo.y - sim.y;
    const sd = Math.hypot(sx, sy);
    if (sd < 2.5) {
      sim.x = sim.slideTo.x;
      sim.y = sim.slideTo.y;
      sim.slideTo = null;
      sim.progRef = { x: sim.x, y: sim.y };
      return true;
    }
    const st = Math.min(sd, sim.speed * 1.15 * dt);   // hampir sama dengan jalan biasa
    const sx2 = sim.x + (sx / sd) * st;
    const sy2 = sim.y + (sy / sd) * st;
    // JANGAN menembus dekorasi: kalau jalur geseran menghalangi, hentikan
    // pemulihan di tempat (agent dianggap sudah tiba).
    if (hitsSolid(sx2, sy2)) {
      sim.slideTo = null;
      sim.progRef = { x: sim.x, y: sim.y };
      return true;
    }
    sim.x = sx2;
    sim.y = sy2;
    sim.walkBob += dt * 11.5;
    if (Math.abs(sx) > 2) sim.facing = sx >= 0 ? "right" : "left";
    return false;
  }

  /**
   * Bergerak menuju (tx,ty) dengan menghindari dekorasi:
   * coba lurus → geser horizontal → geser vertikal → memutari rintangan.
   */
  function moveToward(sim, tx, ty, dt) {
    // Pemulihan dari macet: bergerak halus (lebih cepat) ke titik pemulihan.
    // Tidak ada lompatan posisi sama sekali.
    if (sim.slideTo) return stepSlide(sim, dt);

    const dx = tx - sim.x;
    const dy = ty - sim.y;
    const d = Math.hypot(dx, dy);
    // Dianggap tiba pada jarak < 2 px TANPA memindahkan posisi. Cara lama
    // memindahkan agent sekaligus (snap 4 px) → terasa "blink"; cara 0,5 px
    // membuat agent tidak pernah sampai dan berhenti di tempat selamanya.
    if (d < 2) { sim.stuckFor = 0; return true; }

    const step = Math.min(sim.speed * dt, d);
    const ux = dx / d;
    const uy = dy / d;

    const nx = sim.x + ux * step;
    const ny = sim.y + uy * step;
    const beforeX = sim.x, beforeY = sim.y;

    // Agent hanya boleh berada di area yang boleh dijelajahi (walkableAt):
    // lantai ruangan + lorong + pintu. Tanpa batasan ini agent bisa "nyasar"
    // ke dinding lalu macet permanen (mis. di atas petak bunga Taman, tepat
    // di bawah garis pintu) karena jalur keluar diblokir dekorasi.
    // Pengecualian: kalau agent SUDAH di luar area walkable (mis. ter-slide),
    // ia tetap boleh bergerak untuk keluar.
    const curWalk = walkableAt(sim.x, sim.y);
    const okTo = (x, y) => !hitsSolid(x, y) && (!curWalk || walkableAt(x, y));

    const tryMove = (x, y) => {
      if (okTo(x, y)) { sim.x = x; sim.y = y; return true; }
      return false;
    };
    if (!tryMove(nx, ny)) {
      // Gerakan lurus terhalang → coba semua arah dengan LANGKAH PENUH.
      // Jangan memakai `ux*step`: kalau tujuan hampir sejajar sumbu (mis. tepat
      // di atas petak bunga), `ux` bisa 0,0005 sehingga agent bergerak 0,001 px
      // per frame — praktis diam selamanya.
      if (!tryMove(sim.x + step, sim.y) &&
          !tryMove(sim.x - step, sim.y) &&
          !tryMove(sim.x, sim.y + step) &&
          !tryMove(sim.x, sim.y - step)) {
        // Arah tegak lurus (memutari rintangan)
        const px = -uy, py = ux;
        for (const sgn of [1, -1]) {
          if (tryMove(sim.x + px * step * sgn, sim.y + py * step * sgn)) break;
        }
      }
    }
    // Diagnostik: seberapa jauh agent bergerak di frame ini (dipakai pengujian)
    sim.lastMove = Math.hypot(sim.x - beforeX, sim.y - beforeY);

    // Pengaman "benar-benar diam": kalau tidak ada arah yang bebas, agent
    // berhenti total. Setelah 0,4 detik, PAKSA keluar ke titik bebas terdekat
    // supaya tidak pernah macet permanen (dulu bisa diam berjam-jam).
    if (sim.x === beforeX && sim.y === beforeY) {
      sim.noMove = (sim.noMove || 0) + dt;
      if (sim.noMove > 0.4) {
        sim.noMove = 0;
        sim.stuckFor = 0;
        sim.progTimer = 0;
        // Keluar ke titik yang benar-benar bisa ditempati (walkable + bebas
        // dekorasi), bukan sekadar bebas dekorasi.
        const out = freeWalkable(sim.x, sim.y, 320);
        if (walkableAt(out.x, out.y) && !hitsSolid(out.x, out.y)) {
          sim.slideTo = { x: out.x, y: out.y };
        }
        sim.progRef = { x: sim.x, y: sim.y };
        sim.giveUp = true;
        return true;
      }
    } else {
      sim.noMove = 0;
    }

    // --------------------------------------------------------------
    // ANTI "JALAN DI TEMPAT"
    // Deteksi berbasis JENDELA WAKTU (bukan per frame): agent yang bergerak
    // bolak-balik beberapa piksel tetap dianggap tidak maju. Setelah itu ia
    // dipindahkan ke titik bebas terdekat supaya tidak selamanya berjalan
    // tanpa berpindah tempat.
    //
    // Toleransi `far` sengaja longgar (10 px per 0,3 s ≈ 33 px/s): agent
    // yang benar-benar berjalan bergerak ~18 px per 0,3 s, sedangkan agent
    // yang mengosilasi di atas perabot hanya bergeser beberapa piksel.
    // Dengan toleransi 6 px, osilasi lambat (mis. di atas meja counter)
    // tidak terdeteksi dan agent bisa diam selama beberapa menit.
    // --------------------------------------------------------------
    sim.progTimer = (sim.progTimer || 0) + dt;
    if (sim.progTimer >= 0.3) {
      const far = sim.progRef
        ? Math.hypot(sim.x - sim.progRef.x, sim.y - sim.progRef.y) : 999;
      const targetFar = sim.progDistRef !== undefined
        ? (sim.progDistRef - d) : 999;         // seberapa jauh mendekat
      // Macet bila hampir tidak berpindah DAN tidak mendekat ke tujuan
      const stuck = far < 10 && targetFar < 4;
      sim.stuckFor = stuck ? (sim.stuckFor || 0) + sim.progTimer : 0;
      sim.progRef = { x: sim.x, y: sim.y };
      sim.progDistRef = d;
      sim.progTimer = 0;
    }

    if (sim.stuckFor > 1.0) {
      sim.stuckFor = 0;
      sim.progTimer = 0;
      sim.path = null;
      sim.slideTo = null;
      sim.giveUp = true;
      return true;
    }

    if (sim.stuckFor > 0.2) {
      const near = freeSpot(tx, ty, Math.max(30, Math.min(d, 110)));
      if (!hitsSolid(near.x, near.y) && Math.hypot(near.x - sim.x, near.y - sim.y) < d + 1) {
        // PENTING: jangan memindahkan agent sekaligus — itu terlihat seperti
        // "blink". Simpan titik pemulihan, lalu digeser HALUS di frame berikut.
        sim.slideTo = { x: near.x, y: near.y };
        sim.stuckFor = 0;
        sim.progRef = { x: sim.x, y: sim.y };
        return false;
      }
      if (d < 34) { sim.stuckFor = 0; return true; }   // sudah sangat dekat
    }

    if (Math.abs(dx) > 2) sim.facing = dx >= 0 ? "right" : "left";
    sim.walkBob += dt * 11;
    return false;
  }

  /**
   * Menuju (tx,ty) memakai jalur BFS (memutari perabot).
   * Nama dipertahankan agar seluruh pemanggil tetap bekerja.
   */
  function routeTo(sim, tx, ty, dt) {
    return followPath(sim, tx, ty, dt);
  }

  /** Ambil sesi obrolan berdasarkan id. */
  function chatById(id) {
    return chats.find((c) => c.id === id) || null;
  }

  /** Spot tempat agent idle sedang berada. */
  function currentSpot(sim) {
    const spots = spotsOf(sim.hangout || "lounge");
    return spots[((sim.spotIndex % spots.length) + spots.length) % spots.length];
  }

  /**
   * Pilih ruangan santai berikutnya. Cenderung mengikuti agent idle lain
   * supaya mereka bisa bertemu dan mengobrol, kadang memilih tempat baru.
   */
  /**
   * Pilih ruangan santai berikutnya.
   *
   * Sengaja TIDAK mengikuti agent yang sedang berjalan — kalau dua agent idle
   * saling mengikuti, mereka akan mondar-mandir tanpa henti (gerak tak
   * beraturan). Hanya rekan yang sudah tenang di tempatnya yang diikuti.
   */
  function pickHangout(sim) {
    // Cenderung MENGIKUTI agen idle lain supaya mereka berkumpul dan bisa
    // mengobrol (kalau tersebar sendiri-sendiri, tidak pernah ada percakapan).
    // Tidak harus sedang "loungeIdle" — yang penting satu bidang dan di
    // ruangan yang berbeda.
    const others = [...sims.values()].filter(
      (s) => s.id !== sim.id && !isWorkingState(s.state) && s.hangout &&
             s.hangout !== sim.hangout);
    if (others.length && Math.random() < 0.8) return pick(others).hangout;
    const options = HANGOUTS.filter((h) => h !== sim.hangout);
    return options.length ? pick(options) : sim.hangout;
  }

  function updateAgent(sim, dt) {
    if (sim.chatCooldown > 0) sim.chatCooldown = Math.max(0, sim.chatCooldown - dt);
    if (sim.giveUpWait > 0) {
      sim.giveUpWait -= dt;
      return;                 // berdiri menunggu: tidak berjalan, tidak bekerja
    }
    // Selesaikan pemulihan (slide) di SEMUA mode — kalau tidak, agent bisa
    // tertahan di tengah pemulihan saat mode-nya berpindah.
    if (sim.slideTo) {
      stepSlide(sim, dt);
      return;
    }
    // Blink & bob
    sim.blink -= dt;
    if (sim.blink <= -0.12) sim.blink = rnd(2.5, 6);

    // Agent sedang menghampiri/mengobrol → diurus updateChats.
    // Pada fase "prefetch" (menunggu balasan AI) agent TETAP bekerja,
    // sehingga tidak ada waktu terbuang dan tidak ada tanda menunggu.
    if (sim.chatId) {
      const c = chatById(sim.chatId);
      if (!c || c.phase !== "prefetch") return;
    }

    sim.timer -= dt;

    switch (sim.mode) {
      case "toDesk": {
        const seat = deskSeat(sim.deskIndex);
        // Pertahankan alasan bila karena pekerjaan baru
        if (!sim.activity || !sim.activity.startsWith("Ada pekerjaan baru")) {
          sim.activity = "Menuju meja kerja";
        }
        if (routeTo(sim, seat.x, seat.y, dt)) {
          const far = Math.hypot(seat.x - sim.x, seat.y - sim.y);
          if (far > 70) {
            // Jalur ke meja buntu: berhenti dengan tenang di tempat, lalu
            // coba lagi. Tidak "bekerja" di lokasi yang salah.
            sim.deskTries = (sim.deskTries || 0) + 1;
            if (sim.deskTries >= 5) {
              // Jaring pengaman terakhir: jalur ke meja benar-benar buntu.
              // Menyerah dengan tenang dan beralih ke perilaku ruangan,
              // supaya agent TIDAK macet permanen di mode ini.
              sim.deskTries = 0;
              const here = roomAt(sim.x, sim.y);
              sim.hangout = HANGOUTS.indexOf(here) >= 0 ? here : "lounge";
              sim.spotIndex = Math.floor(Math.random() * spotsOf(sim.hangout).length);
              sim.mode = "toLounge";
              sim.timer = 0;
              sim.activity = "Mencari tempat lain";
            } else {
              sim.giveUpWait = rnd(1.5, 3);
              sim.activity = "Mencari jalur ke meja";
            }
          } else {
            sim.deskTries = 0;
            sim.mode = "work";
            sim.settleTime = 0;
            sim.timer = rnd(6, 14);
            sim.activity = pick(WORK_ACTIVITY[sim.state] || WORK_ACTIVITY.working);
          }
        }
        break;
      }

      case "work": {
        sim.activity = pick(WORK_ACTIVITY[sim.state] || WORK_ACTIVITY.working);
        if (sim.timer <= 0) {
          // Fokus utama: MENGobrol dengan rekan kerja (bukan bicara sendiri)
          if (Math.random() < 0.92 && startChat(sim)) break;
          sim.timer = rnd(2.5, 5);
        }
        break;
      }

      case "toLounge": {
        const spot = currentSpot(sim);
        sim.activity = "Menuju " + spot.l;
        if (routeTo(sim, spot.x, spot.y, dt)) {
          const farSpot = Math.hypot(spot.x - sim.x, spot.y - sim.y);
          if (farSpot > 70) {
            // Jalur buntu: coba lagi beberapa kali, lalu pilih ruangan lain
            // yang lebih mungkin terjangkau (jaring pengaman anti-macet).
            sim.loungeTries = (sim.loungeTries || 0) + 1;
            if (sim.loungeTries >= 5) {
              sim.loungeTries = 0;
              sim.hangout = pickHangout(sim);
              sim.spotIndex = Math.floor(Math.random() * spotsOf(sim.hangout).length);
              sim.giveUpWait = rnd(1, 2);
              sim.activity = "Mencari tempat lain";
            } else {
              sim.giveUpWait = rnd(1.5, 3);
              sim.activity = "Mencari jalan";
            }
            break;
          }
          sim.loungeTries = 0;
          sim.mode = "loungeIdle";
          sim.settleTime = 0;
          sim.timer = rnd(9, 22);
          sim.activity = pick(IDLE_ACTIVITY);
        }
        break;
      }

      case "loungeIdle": {
        sim.settleTime = (sim.settleTime || 0) + dt;   // sudah tenang selama ini
        if (sim.timer <= 0) {
          // Fokus utama: MENGobrol. Baru kalau tidak ada rekan, ia berpindah.
          if (Math.random() < 0.95 && startChat(sim)) break;

          // Berkeliaran: kalau sudah lama di satu ruangan, pindah ke ruangan
          // santai lain. Tanpa jaminan ini agen sering "diam" di satu ruangan
          // terus-menerus karena percakapan selalu berhasil.
          const wantMove = sim.settleTime > 60 || Math.random() < 0.22;
          if (wantMove) {
            sim.settleTime = 0;
            sim.hangout = pickHangout(sim);
            sim.spotIndex = Math.floor(Math.random() * spotsOf(sim.hangout).length);
            sim.mode = "toLounge";
            sim.activity = "Menuju " + ROOMS[sim.hangout].name;
          } else {
            const spots = spotsOf(sim.hangout);
            sim.spotIndex = Math.floor(Math.random() * spots.length);
            const s2 = spots[sim.spotIndex];
            sim.mode = "walkSpot";
            sim.tx = s2.x;
            sim.ty = s2.y;
            sim.activity = "Menuju " + s2.l;
          }
          sim.timer = rnd(3, 8);
        }
        break;
      }

      case "walkSpot": {
        if (moveToward(sim, sim.tx, sim.ty, dt)) {
          sim.mode = "loungeIdle";
          sim.timer = rnd(4, 10);
          sim.activity = pick(IDLE_ACTIVITY);
          sim.walkSpotTries = 0;
        } else {
          // Pengaman yang sama seperti walkBack: jangan macet di tempat.
          sim.walkSpotTries = (sim.walkSpotTries || 0) + dt;
          if (sim.walkSpotTries > 6) {
            sim.walkSpotTries = 0;
            sim.mode = "loungeIdle";
            sim.timer = rnd(4, 10);
            sim.activity = pick(IDLE_ACTIVITY);
          }
        }
        break;
      }

      case "walkBack": {
        const target = sim.returnTo;
        if (!target) {
          sim.mode = sim.resumeMode;
          sim.timer = rnd(6, 14);
          break;
        }
        const arrived = moveToward(sim, target.x, target.y, dt);
        if (arrived) {
          sim.mode = sim.resumeMode;
          sim.timer = rnd(6, 14);
          sim.activity = sim.mode === "work"
            ? pick(WORK_ACTIVITY[sim.state] || WORK_ACTIVITY.working)
            : pick(IDLE_ACTIVITY);
          sim.walkBackTries = 0;
        } else {
          // Pengaman: jalur ke spot bisa buntu di balik perabot. Tanpa batas
          // ini agent bisa macet di walkBack SELAMANYA (pernah terlihat
          // diam di Pantry berjam-jam). Setelah beberapa detik, berhenti dan
          // lanjutkan rutinitas.
          sim.walkBackTries = (sim.walkBackTries || 0) + dt;
          if (sim.walkBackTries > 6) {
            sim.walkBackTries = 0;
            // Keluar dari kantong dekorasi bila terperosok di sana.
            const out = freeWalkable(sim.x, sim.y, 320);
            if (walkableAt(out.x, out.y) && !hitsSolid(out.x, out.y)) {
              sim.slideTo = { x: out.x, y: out.y };
            }
            sim.mode = sim.resumeMode;
            sim.timer = rnd(6, 14);
            sim.activity = sim.mode === "work"
              ? pick(WORK_ACTIVITY[sim.state] || WORK_ACTIVITY.working)
              : pick(IDLE_ACTIVITY);
          }
        }
        break;
      }

      case "toHelp": {
        // Menuju rekan yang diputuskan AI untuk dibantu, lalu ikut bekerja.
        const t = sims.get(sim.helpTarget);
        if (!t || t.chatId || sim.chatId) {
          sim.mode = sim.homeRoom === "workspace" ? "toDesk" : "toLounge";
          sim.helpTarget = null;
          sim.timer = 0;
          break;
        }
        const spot = { x: t.x + 34, y: t.y + 8 };
        const near = Math.hypot(t.x - sim.x, t.y - sim.y);
        if (routeTo(sim, spot.x, spot.y, dt) || near < 74) {
          sim.mode = "work";
          sim.settleTime = 0;
          sim.timer = rnd(12, 26);
          sim.helping = t.id;
          sim.activity = "Membantu " + (t.agent ? t.agent.name : "rekan");
          // Tawarkan bantuan lewat obrolan juga (membahas pekerjaan nyata)
          if (Math.random() < 0.7) startChat(sim, "help");
        }
        break;
      }

      default:
        sim.mode = sim.homeRoom === "workspace" ? "work" : "loungeIdle";
    }
  }

  // ============================================
  // SISTEM OBROLAN
  // ============================================
  const SPEAK_DUR = 3.2;   // durasi satu kalimat
  const GAP_DUR = 0.65;    // jeda antar giliran — singkat supaya obrolan tidak
                           // terasa "berhenti tiba-tiba"

  // ------------------------------------------------------------------
  // EMOSI — agent bisa senang, tertawa, sedih, marah, kesal, cemas, dll.
  // Emoji tampil di atas kepala; warna gelembung & ekspresi wajah mengikuti.
  // ------------------------------------------------------------------
  const EMOTION_EMOJI = {
    senang: "😊", tertawa: "😂", sedih: "😢", marah: "😠", kesal: "😒",
    cemas: "😟", bangga: "😎", kagum: "🤩", bingung: "🤔", tenang: "🙂",
    lelah: "😪", semangat: "🔥",
  };
  const EMOTION_COLOR = {
    senang: "#4ade80", tertawa: "#facc15", sedih: "#60a5fa", marah: "#ef4444",
    kesal: "#fb923c", cemas: "#a78bfa", bangga: "#f472b6", kagum: "#22d3ee",
    bingung: "#94a3b8", tenang: "#94a3b8", lelah: "#a3a3a3", semangat: "#f97316",
  };
  const emotionEmoji = (e) => EMOTION_EMOJI[String(e || "").toLowerCase()] || "";
  const emotionColor = (e) => EMOTION_COLOR[String(e || "").toLowerCase()] || "#94a3b8";

  function truncate(s, n) {
    const t = String(s || "");
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }

  function startChat(initiator, kind) {
    if ((initiator.chatCooldown || 0) > 0) return false;   // sedang jeda
    // Cari partner: sama ruangan, tidak sedang mengobrol, tidak offline
    const initRoom = roomAt(initiator.x, initiator.y);

    // Maksimal SATU percakapan per ruangan agar percakapan tetap jelas dibaca
    if (chats.some((c) => c.room === initRoom)) return false;

    const candidates = [];
    for (const sim of sims.values()) {
      if (sim.id === initiator.id) continue;
      if (sim.chatId) continue;
      if (sim.agent && sim.agent.state === "offline") continue;
      if ((sim.chatCooldown || 0) > 0) continue;
      if (roomAt(sim.x, sim.y) !== initRoom) continue;
      candidates.push(sim);
    }
    if (!candidates.length) return false;

    const partner = pick(candidates);
    const meet = pick(MEET_POINTS[initRoom] || MEET_POINTS.workspace);

    // Perilaku mandiri: kadang ia MENGAJAK rekannya pindah tempat.
    // Tujuannya dipilih sendiri (ruangan santai lain), lalu dipakai setelah
    // obrolan selesai — kalau rekannya setuju (terlihat dari balasan AI).
    let chatKind = kind || "chat";
    let inviteTo = null;
    if (!kind && initRoom !== "workspace" && Math.random() < 0.32) {
      const others = HANGOUTS.filter((r) => r !== initRoom);
      inviteTo = pick(others);
      chatKind = "invite";
    }

    const chat = {
      id: "chat-" + frame + "-" + Math.random().toString(36).slice(2, 6),
      aId: initiator.id,
      bId: partner.id,
      meet,
      room: initRoom,
      kind: chatKind,
      inviteTo,
      lines: null,          // diisi oleh model AI (lihat requestDialogue)
      source: null,
      phase: "prefetch",    // prefetch → approach → talk
      sub: "speak",         // speak → gap → speak (bergantian)
      idx: 0,
      t: 0,
      waited: 0,
    };
    chats.push(chat);

    initiator.chatId = chat.id;
    partner.chatId = chat.id;
    initiator.activity = "Menghampiri rekan";
    partner.activity = "Menghampiri rekan";

    // Dialog SIAP PAKAI lebih dulu → gelembung langsung muncul tanpa menunggu.
    const ready = takePooledDialogue(initiator.id, partner.id, initRoom);
    if (ready) {
      chat.lines = ready.lines.map((l) => ({
        speaker: l.speaker === "b" ? "b" : "a",
        text: String(l.text || ""),
        emotion: l.emotion ? String(l.emotion).toLowerCase() : null,
      }));
      chat.source = ready.source || "ai";
      chat.model = ready.model || null;
      chat.phase = "approach";          // langsung berjalan ke titik temu
      instantChats++;
      applyAiActivities(initiator, partner, ready.activities);
      applyThoughts(initiator, partner, ready.thoughts, ready.focus);
      fillDialoguePool();               // isi ulang untuk obrolan berikutnya
    } else {
      // Belum ada di kolam: minta ke model AI (agent tetap bekerja sambil menunggu)
      requestDialogue(chat, initiator, partner);
    }
    return true;
  }

  // ------------------------------------------------------------------
  // KOLAM DIALOG
  // Dialog disiapkan LEBIH DULU di latar belakang untuk pasangan agent yang
  // kemungkinan segera mengobrol. Jadi begitu agent memutuskan ngobrol,
  // gelembungnya langsung muncul — tidak ada jeda menunggu model AI.
  // ------------------------------------------------------------------
  const dialoguePool = [];
  const poolPending = new Set();
  const POOL_TARGET = 3;
  let poolBusy = false;
  let instantChats = 0;   // obrolan yang mulai tanpa menunggu model AI

  function poolKey(aId, bId, room) { return aId + "|" + bId + "|" + room; }

  /** Cari pasangan agent yang mungkin segera mengobrol, lalu siapkan dialognya. */
  function fillDialoguePool() {
    if (poolBusy || dialoguePool.length >= POOL_TARGET) return;
    const list = [...sims.values()].filter(
      (s) => s.agent && !s.chatId && s.agent.state !== "offline");
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const room = roomAt(a.x, a.y);
        if (!room || room !== roomAt(b.x, b.y)) continue;
        const key = poolKey(a.id, b.id, room);
        if (poolPending.has(key) || dialoguePool.some((e) => e.key === key)) continue;
        poolPending.add(key);
        poolBusy = true;
        requestPooledDialogue(key, a, b, room);
        return;
      }
    }
  }

  function requestPooledDialogue(key, a, b, room) {
    fetch("/api/office/dialogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: a.id, b: b.id, room, kind: "chat" }),
    })
      .then((r) => r.json())
      .then((res) => {
        const d = res && res.data;
        poolPending.delete(key);
        poolBusy = false;
        if (d && Array.isArray(d.lines) && d.lines.length >= 2) {
          dialoguePool.push({
            key, lines: d.lines, activities: d.activities,
            thoughts: d.thoughts, focus: d.focus,
            source: d.source, model: d.model,
          });
          if (dialoguePool.length > 6) dialoguePool.shift();
        }
      })
      .catch(() => { poolPending.delete(key); poolBusy = false; });
  }

  /** Ambil dialog siap pakai untuk pasangan ini (null kalau belum ada). */
  function takePooledDialogue(aId, bId, room) {
    const k1 = poolKey(aId, bId, room);
    const k2 = poolKey(bId, aId, room);
    const idx = dialoguePool.findIndex((e) => e.key === k1 || e.key === k2);
    if (idx < 0) return null;
    return dialoguePool.splice(idx, 1)[0];
  }

  /**
   * Ambil dialog dari backend (yang memanggil model AI dengan data nyata).
   * Kalau gagal / terlalu lama, pakai rangkaian lokal sebagai cadangan
   * supaya percakapan tidak pernah macet.
   */
  function requestDialogue(chat, aSim, bSim) {
    // TIDAK ADA dialog template. Kalau model AI tidak menghasilkan kalimat,
    // percakapan dibatalkan — lebih baik agent diam daripada mengulang
    // kalimat buatan yang sama.
    const url = "/api/office/dialogue";
    const payload = JSON.stringify({
      a: aSim.id, b: bSim.id, room: chat.room, kind: chat.kind || "chat",
    });

    // Catatan: tidak memakai setTimeout — jaring pengaman waktu tunggu
    // ditangani di updateChats (chat.waited), jadi tidak ada dependensi
    // tambahan pada API browser.
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    })
      .then((r) => r.json())
      .then((res) => {
        const d = res && res.data;
        if (d && Array.isArray(d.lines) && d.lines.length >= 2) {
          chat.lines = d.lines.map((l) => ({
            speaker: l.speaker === "b" ? "b" : "a",
            text: String(l.text || ""),
            emotion: l.emotion ? String(l.emotion).toLowerCase() : null,
          }));
          chat.source = d.source || "ai";
          chat.model = d.model || null;
          applyAiActivities(aSim, bSim, d.activities);
          applyThoughts(aSim, bSim, d.thoughts, d.focus);
        } else {
          chat.lines = [];
          chat.source = "none";
        }
      })
      .catch(() => {
        chat.lines = [];
        chat.source = "none";
      });
  }

  /**
   * Tebak ruangan tujuan dari kata-kata aktivitas AI.
   * Ini hanya membantu mereka BERGALAK — isi pikiran tetap datang dari model.
   */
  function roomFromText(txt) {
    const low = String(txt || "").toLowerCase();
    if (low.includes("kopi") || low.includes("makan") || low.includes("camilan") ||
        low.includes("minum") || low.includes("teh") || low.includes("pantry")) return "pantry";
    if (low.includes("sofa") || low.includes("duduk") || low.includes("istirahat") ||
        low.includes("santai") || low.includes("lounge")) return "lounge";
    if (low.includes("taman") || low.includes("jalan") || low.includes("udara") ||
        low.includes("bunga") || low.includes("tanaman")) return "garden";
    if (low.includes("rapat") || low.includes("diskusi") || low.includes("papan") ||
        low.includes("meeting") || low.includes("briefing")) return "meeting";
    return null;
  }

  /**
   * Label aktivitas dari AI dipakai untuk teks di atas kepala agent
   * (mengurangi pengulangan), dan untuk memilih ruangan tujuan agent idle.
   */
  function applyAiActivities(aSim, bSim, activities) {
    if (!activities) return;
    const map = [[aSim, activities.a], [bSim, activities.b]];
    for (const [sim, label] of map) {
      const txt = String(label || "").trim();
      if (txt.length < 3) continue;
      sim.aiActivity = txt;
      const room = roomFromText(txt);
      if (room) { sim.hangout = room; sim.spotIndex = 0; }
    }
  }

  /**
   * Pikiran agent dari AI disimpan sebagai ingatan mereka, lalu dipakai
   * sebagai label — jadi yang tampil di layar benar-benar isi pikiran mereka.
   */
  function rememberThought(sim, thought) {
    const txt = String(thought || "").trim();
    if (txt.length < 3) return;
    sim.thought = txt;
    sim.memory = sim.memory || [];
    if (sim.memory[sim.memory.length - 1] !== txt) sim.memory.push(txt);
    if (sim.memory.length > 6) sim.memory.shift();
  }

  function applyThoughts(aSim, bSim, thoughts, focus) {
    if (thoughts) {
      rememberThought(aSim, thoughts.a);
      rememberThought(bSim, thoughts.b);
    }
    if (focus && focus.title) {
      aSim.focusTitle = focus.title;
      bSim.focusTitle = focus.title;
    }
  }

  // ------------------------------------------------------------------
  // MENYAPA SAAT BERTEMU — perilaku spontan antar agent.
  // Kalau dua agent berdekatan dan sama-sama tidak mengobrol, kadang salah
  // satu menyapa. Tidak dijadwalkan: muncul sendiri seperti orang lewat.
  // ------------------------------------------------------------------
  const greetedAt = new Map();          // "idA|idB" → frame terakhir menyapa
  const GREET_COOLDOWN = 60 * 240;      // 4 menit agar tidak berulang
  let greetTimer = 0;
  let poolTimer = 0;

  function maybeGreet() {
    const list = [...sims.values()].filter((s) => s.agent && !s.chatId &&
      s.agent.state !== "offline" && (s.mode === "loungeIdle" || s.mode === "work"));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) > 120) continue;
        const key = [a.id, b.id].sort().join("|");
        const last = greetedAt.get(key);
        if (last !== undefined && frame - last < GREET_COOLDOWN) continue;
        if (Math.random() > 0.65) continue;
        greetedAt.set(key, frame);
        startChat(a, "greet");
        return;
      }
    }
  }

  // ------------------------------------------------------------------
  // OTAK MANDIRI — tiap agent memutuskan sendiri, tanpa disuruh.
  // Frontend hanya bertanya "apa yang kamu pikirkan sekarang?" ke backend,
  // yang menjalankannya lewat model AI dengan data nyata terbaru.
  // ------------------------------------------------------------------
  const BRAIN_INTERVAL = 20;      // detik antar keputusan per gelombang
  const BRAIN_BATCH = 3;          // agent per permintaan (hemat kuota model)
  let brainTimer = BRAIN_INTERVAL - 4;
  const brainPending = new Set();

  function requestBrain() {
    const queue = [];
    // Utamakan agent yang tidak punya pekerjaan — merekalah yang paling
    // butuh menentukan sendiri mau apa.
    const order = [...sims.values()].sort((x, y) => {
      const xi = x.agent && x.agent.state !== "idle" ? 1 : 0;
      const yi = y.agent && y.agent.state !== "idle" ? 1 : 0;
      return xi - yi;
    });
    for (const sim of order) {
      if (!sim.agent || sim.agent.state === "offline") continue;
      if (sim.chatId) continue;                 // sedang mengobrol
      if (brainPending.has(sim.id)) continue;
      queue.push({ id: sim.id, room: roomAt(sim.x, sim.y) || "workspace" });
      if (queue.length >= BRAIN_BATCH) break;
    }
    if (!queue.length) return;
    queue.forEach((q) => brainPending.add(q.id));

    fetch("/api/office/brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents: queue }),
    })
      .then((r) => r.json())
      .then((res) => {
        const list = (res && res.data && res.data.decisions) || [];
        for (const d of list) {
          brainPending.delete(d.id);
          const sim = sims.get(d.id);
          if (sim) applyBrainDecision(sim, d);
        }
        for (const q of queue) brainPending.delete(q.id);
      })
      .catch(() => { queue.forEach((q) => brainPending.delete(q.id)); });
  }

  /** Terapkan keputusan mandiri agent: pikiran, suasana hati, dan tujuan. */
  function applyBrainDecision(sim, d) {
    rememberThought(sim, d.thought);
    const emo = String(d.emotion || d.mood || "").trim().toLowerCase();
    if (emo) {
      sim.emotion = emo;
      sim.mood = emo;
    }
    const act = String(d.activity || "").trim();
    if (act.length >= 3) sim.aiActivity = act;

    // AI MEMUTUSKAN UNTUK MEMBANTU REKAN (karena melihat keadaannya langsung)
    // → agent menghampiri rekan itu dan ikut bekerja.
    if (String(d.action || "").toLowerCase() === "help" && d.target) {
      const t = [...sims.values()].find(
        (s) => s.id !== sim.id && s.agent && s.agent.name === d.target);
      if (t && !t.chatId && !sim.chatId) {
        sim.helpTarget = t.id;
        sim.mode = "toHelp";
        sim.timer = 0;
        sim.settleTime = 0;
        sim.activity = "Menuju " + (t.agent ? t.agent.name : "rekan");
        return;                    // jangan timpa dengan keputusan lain
      }
    }

    // Agent yang tidak bekerja boleh memilih tujuan sendiri — TAPI hanya
    // setelah ia cukup lama tenang di tempatnya. Tanpa jeda ini, keputusan
    // otak tiap 20 detik membuat agent terus berpindah dan geraknya terlihat
    // tidak beraturan.
    const idle = sim.agent && sim.agent.state === "idle";
    sim.settleTime = (sim.settleTime || 0) + 0;   // diisi di updateAgent
    if (idle && sim.mode === "loungeIdle" && sim.settleTime > 12) {
      const room = roomFromText(act) || roomFromText(d.thought) ||
                   roomFromText(d.reason);
      if (room && room !== sim.hangout) {
        sim.hangout = room;
        sim.spotIndex = 0;
        sim.timer = 0;
        sim.settleTime = 0;
        sim.activity = act || "Berkeliling kantor";
      }
    }
  }

  function updateChats(dt) {
    for (const chat of [...chats]) {
      const a = sims.get(chat.aId);
      const b = sims.get(chat.bId);
      if (!a || !b) { endChat(chat); continue; }

      // Berjalan ke titik pertemuan
      const aOff = { x: chat.meet.x - 28, y: chat.meet.y };
      const bOff = { x: chat.meet.x + 28, y: chat.meet.y };
      const aDone = routeTo(a, aOff.x, aOff.y, dt);
      const bDone = routeTo(b, bOff.x, bOff.y, dt);

      if (chat.phase === "prefetch") {
        // Menunggu balasan model AI. Keduanya MASIH BEKERJA (lihat updateAgent),
        // jadi saat dialog siap mereka baru berjalan menemui satu sama lain —
        // begitu bertemu, dialog langsung keluar tanpa jeda "…".
        chat.waited += dt;
        const ready = Array.isArray(chat.lines) && chat.lines.length >= 2;

        if (ready || chat.waited > 40) {
          if (!ready) {
            // Model AI tidak menjawab → batalkan obrolan.
            // TIDAK memakai kalimat template (permintaan pengguna).
            endChat(chat);
            continue;
          }
          chat.phase = "approach";
          a.activity = "Menghampiri rekan";
          b.activity = "Menghampiri rekan";
        }
        continue;
      }

      if (chat.phase === "approach") {
        if (aDone && bDone) {
          chat.phase = "talk";
          chat.sub = "speak";
          chat.idx = 0;
          chat.t = 0;
          a.bubble = null;
          b.bubble = null;
        }
        continue;
      }

      // Pengaman: jangan pernah masuk fase bicara tanpa kalimat
      if (!Array.isArray(chat.lines) || chat.lines.length < 2) {
        endChat(chat);
        continue;
      }

      // Berdua saling menghadap
      a.facing = "right";
      b.facing = "left";

      chat.t += dt;

      if (chat.sub === "speak") {
        const line = chat.lines[chat.idx];
        const speaker = line.speaker === "a" ? a : b;
        const listener = line.speaker === "a" ? b : a;

        // HANYA satu yang berbicara; yang lain hanya menampilkan tanda menunggu
        const emo = line.emotion || speaker.emotion || null;
        if (emo) speaker.emotion = emo;
        speaker.bubble = {
          kind: "chat",
          text: line.text,
          speaker: speaker.agent ? speaker.agent.name : "",
          emotion: emo,
          ttl: 0.3,
        };
        listener.bubble = {
          kind: "waiting",
          ttl: 0.3,
          dx: listener.x < speaker.x ? -42 : 42,
        };

        speaker.activity = "Berbicara dengan " + (listener.agent ? listener.agent.name : "rekan");
        listener.activity = "Mendengarkan " + (speaker.agent ? speaker.agent.name : "rekan");

        // Durasi bicara mengikuti panjang kalimat — kalimat panjang (pembahasan
        // mendalam) diberi waktu lebih lama agar bisa dibaca sampai tuntas.
        const dur = Math.max(3.0, Math.min(14, line.text.length / 15));
        if (chat.t >= dur) {
          // Masuk jeda: kedua bubble hilang agar giliran terlihat jelas
          chat.sub = "gap";
          chat.t = 0;
          a.bubble = null;
          b.bubble = null;
        }
      } else {
        // Jeda — tidak ada yang berbicara
        if (chat.t >= GAP_DUR) {
          chat.idx++;
          chat.t = 0;
          if (chat.idx >= chat.lines.length) { endChat(chat); continue; }
          chat.sub = "speak";
        }
      }
    }
  }

  function endChatById(chatId) {
    const chat = chats.find((c) => c.id === chatId);
    if (chat) endChat(chat);
  }

  function endChat(chat) {
    // Kalau obrolan batal (model AI tidak menjawab), beri jeda sebelum agent
    // mencoba mengobrol lagi. Tanpa ini, agent berulang kali berjalan ke titik
    // temu lalu batal — geraknya terlihat tidak beraturan.
    const hadTalk = !!(chat.lines && chat.lines.length);
    if (!hadTalk) {
      for (const id of [chat.aId, chat.bId]) {
        const sim = sims.get(id);
        if (sim) sim.chatCooldown = 25;
      }
    }
    // Ajakan pindah tempat: kalau rekan menyetujui, keduanya berangkat bersama.
    if (chat.inviteTo && chat.lines && chat.lines.length) {
      const text = chat.lines.map((l) => String(l.text || "").toLowerCase()).join(" ");
      const refuses = /(nggak|tidak|enggan|males|malas|nanti|sendiri|maaf)/.test(text);
      if (!refuses) {
        for (const id of [chat.aId, chat.bId]) {
          const sim = sims.get(id);
          if (!sim) continue;
          sim.hangout = chat.inviteTo;
          sim.spotIndex = 0;
          sim.mode = "toLounge";
          sim.timer = 0;
          sim.activity = "Ikut ke " + (ROOMS[chat.inviteTo] ? ROOMS[chat.inviteTo].name : "ruangan lain");
        }
      }
    }
    for (const id of [chat.aId, chat.bId]) {
      const sim = sims.get(id);
      if (!sim) continue;
      sim.chatId = null;
      sim.bubble = null;
      // Kembali ke rutinitas
      if (sim.homeRoom === "workspace") {
        const seat = deskSeat(sim.deskIndex);
        sim.mode = "walkBack";
        sim.returnTo = seat;
        sim.resumeMode = "work";
        sim.activity = "Kembali ke meja";
      } else {
        const spot = currentSpot(sim);
        sim.mode = "walkBack";
        sim.returnTo = spot;
        sim.resumeMode = "loungeIdle";
        sim.activity = "Kembali bersantai";
      }
      sim.timer = rnd(2, 5);
    }
    chats = chats.filter((c) => c.id !== chat.id);
  }

  // ============================================
  // RENDER
  // ============================================
  function render() {
    // Bersihkan (layer layar)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, W, H);

    // ---- LAYER DUNIA ----
    ctx.save();
    ctx.setTransform(
      dpr * camera.zoom, 0, 0, dpr * camera.zoom,
      -camera.x * camera.zoom * dpr, -camera.y * camera.zoom * dpr
    );
    drawWorld();
    drawParticles();
    drawAgents();
    ctx.restore();

    // ---- LAYER CAHAYA: vignette ----
    // Sudut layar sedikit lebih gelap, seolah cahaya datang dari tengah.
    // Ini yang memberi kesan "pencahayaan" tanpa membebani render.
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ---- LAYER TEKS (TAJAM) ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBubbles();
    drawHud();
  }

  // ---------- DUNIA ----------
  /**
   * Gambar dekorasi STATIS (lantai, dinding, panel, ubin, pintu, jendela) ke
   * offscreen canvas SEKALI. Ini hemat besar: tanpa cache, ribuan rect
   * (ubin + panel) digambar ulang tiap frame dan membuat render sangat berat.
   *
   * Hanya bisa di browser (butuh document.createElement). Di pengujian tanpa
   * DOM, mengembalikan null dan drawWorld menggambar langsung.
   */
  function buildStaticLayer() {
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas");
    c.width = WORLD.w;
    c.height = WORLD.h;
    const cx = c.getContext("2d");
    if (!cx) return null;
    const saved = ctx;
    ctx = cx;                       // sementara: gambar ke layer statis
    try {
      for (const id of ROOM_ORDER) drawRoomBase(ROOMS[id]);
    } finally {
      ctx = saved;
    }
    return c;
  }

  function drawWorld() {
    // Latar luar
    ctx.fillStyle = "#080c16";
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    drawHall();

    // Dekorasi ruangan statis — dari cache (cepat) atau langsung (fallback)
    if (staticLayer) {
      ctx.drawImage(staticLayer, 0, 0);
    } else {
      for (const id of ROOM_ORDER) drawRoomBase(ROOMS[id]);
    }

    drawWorkspaceProps();
    drawLoungeProps();
    drawMeetingProps();
    drawPantryProps();
    drawGardenProps();
  }

  /** Lorong utama yang menghubungkan semua ruangan. */
  function drawHall() {
    ctx.fillStyle = "#20283c";
    ctx.fillRect(HALL.x, HALL.y, HALL.w, HALL.h);

    // Garis tengah lorong
    ctx.strokeStyle = "#33405e";
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 18]);
    ctx.beginPath();
    ctx.moveTo(HALL.x + 20, HALL.cy);
    ctx.lineTo(HALL.x + HALL.w - 20, HALL.cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bingkai atas & bawah lorong
    ctx.strokeStyle = "#3b4a6a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(HALL.x, HALL.y); ctx.lineTo(HALL.x + HALL.w, HALL.y);
    ctx.moveTo(HALL.x, HALL.y + HALL.h); ctx.lineTo(HALL.x + HALL.w, HALL.y + HALL.h);
    ctx.stroke();

    // Lampu lorong
    for (let x = HALL.x + 90; x < HALL.x + HALL.w; x += 220) {
      const glow = 0.5 + Math.sin(frame * 0.03 + x) * 0.12;
      ctx.fillStyle = `rgba(250,204,21,${glow * 0.18})`;
      ctx.beginPath();
      ctx.arc(x, HALL.cy, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#facc15";
      ctx.fillRect(x - 9, HALL.y + 8, 18, 7);
    }
  }

  function drawRoomBase(room) {
    const top = floorTop(room);

    // Lantai — gradien halus (lebih terang dekat dinding, lebih gelap ke bawah)
    // supaya terasa punya kedalaman, bukan warna rata.
    const fg = ctx.createLinearGradient(0, top, 0, room.y + room.h);
    fg.addColorStop(0, shade(room.floor, 1.08));
    fg.addColorStop(0.45, room.floor);
    fg.addColorStop(1, shade(room.floor, 0.7));
    ctx.fillStyle = fg;
    ctx.fillRect(room.x, top, room.w, room.h - room.wallH);

    // Dinding — gradien dari atas yang lebih gelap
    const wg = ctx.createLinearGradient(0, room.y, 0, top);
    wg.addColorStop(0, shade(room.wall, 0.66));
    wg.addColorStop(1, shade(room.wall, 1.1));
    ctx.fillStyle = wg;
    ctx.fillRect(room.x, room.y, room.w, room.wallH);

    // Tekstur dinding: panel vertikal halus (bukan bidang rata)
    ctx.strokeStyle = shade(room.wall, 0.82);
    ctx.lineWidth = 1;
    for (let x = room.x + 64; x < room.x + room.w - 20; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, room.y + 2); ctx.lineTo(x, top); ctx.stroke();
    }
    // Garis horizontal halus di tengah dinding
    ctx.strokeStyle = shade(room.wall, 1.12);
    ctx.beginPath();
    ctx.moveTo(room.x, room.y + room.wallH * 0.55);
    ctx.lineTo(room.x + room.w, room.y + room.wallH * 0.55);
    ctx.stroke();

    // Material lantai BEDA per ruangan supaya tiap ruang punya karakter
    // nyata: karpet kantor, lantai kayu, keramik, dan rumput taman.
    const fx = room.x, fy = top, fw = room.w, fh = room.y + room.h - top;
    switch (room.id) {
      case "lounge":
        woodFloorTex(ctx, fx, fy, fw, fh);
        break;
      case "pantry":
        tileTex(ctx, fx, fy, fw, fh);
        break;
      case "garden":
        grassTex(ctx, fx, fy, fw, fh);
        break;
      default:
        carpetTex(ctx, fx, fy, fw, fh);
    }

    // Ambient occlusion: bagian lantai dekat dinding sedikit lebih gelap,
    // seolah cahaya tidak mencapai tepi secara merata.
    const ao = ctx.createLinearGradient(0, top, 0, top + 90);
    ao.addColorStop(0, "rgba(0,0,0,0.28)");
    ao.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ao;
    ctx.fillRect(room.x, top, room.w, 90);

    // Skirting board (papan lis) di dasar dinding — kesan arsitektur nyata.
    ctx.fillStyle = shade(room.wall, 1.35);
    ctx.fillRect(room.x, top - 7, room.w, 7);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(room.x, top - 7, room.w, 2);

    // Garis dinding-lantai
    ctx.strokeStyle = "#3b4a6a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(room.x, top);
    ctx.lineTo(room.x + room.w, top);
    ctx.stroke();

    // Bingkai ruangan
    ctx.lineWidth = 4;
    ctx.strokeRect(room.x, room.y, room.w, room.h);

    // Jendela (hanya ruangan baris atas yang punya dinding lebar)
    if (room.wallH >= 220) {
      const n = Math.max(2, Math.floor(room.w / 290));
      for (let i = 0; i < n; i++) {
        drawWindow(room.x + 70 + i * ((room.w - 140) / n), room.y + 45, 150, 120);
      }
    }

    // Pintu: bukaan di dinding yang menghubungkan ruangan ini dengan lorong.
    // Digambar paling akhir supaya menutupi bingkai ruangan.
    const dr = DOORS.find((d) => d.room === room.id);
    if (dr) {
      // Bukaan — tampilkan lantai menembus dinding
      ctx.fillStyle = room.floor;
      ctx.fillRect(dr.x, room.y + 4, dr.w, room.wallH - 4);
      // Kusen kiri & kanan
      ctx.fillStyle = "#4a5a7d";
      ctx.fillRect(dr.x - 7, room.y, 7, room.wallH + 10);
      ctx.fillRect(dr.x + dr.w, room.y, 7, room.wallH + 10);
      // Ambang pintu di garis dinding-lantai
      ctx.fillStyle = "#4a5a7d";
      ctx.fillRect(dr.x - 7, top - 6, dr.w + 14, 6);
      // Daun pintu terbuka (garis tipis di tengah bukaan)
      ctx.strokeStyle = "#3b4a6a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(dr.x + dr.w / 2, room.y + 8);
      ctx.lineTo(dr.x + dr.w / 2, top - 6);
      ctx.stroke();
    }
  }

  function drawWindow(x, y, w, h) {
    ctx.fillStyle = "#2a3550";
    ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
    ctx.fillStyle = "#0a1628";
    ctx.fillRect(x, y, w, h);

    // Bintang
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 14; i++) {
      const sx = x + 8 + ((i * 53) % (w - 16));
      const sy = y + 8 + ((i * 37) % (h - 16));
      ctx.fillRect(sx, sy, 2, 2);
    }
    // Bulan
    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.arc(x + w - 34, y + 30, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0a1628";
    ctx.beginPath();
    ctx.arc(x + w - 28, y + 26, 11, 0, Math.PI * 2);
    ctx.fill();

    // Kusen
    ctx.fillStyle = "#2a3550";
    ctx.fillRect(x + w / 2 - 2, y, 4, h);
    ctx.fillRect(x, y + h / 2 - 2, w, 4);
  }

  function drawWorkspaceProps() {
    const R = ROOMS.workspace;

    // --- dekorasi dinding ---
    drawWhiteboard(R.x + 60, R.y + 95, 250, 135);
    drawStatusBoard(R.x + R.w / 2 - 90, R.y + 100);
    drawWallClock(R.x + R.w - 165, R.y + 62);
    drawShelf(R.x + R.w - 92, R.y + 170);

    // --- meja kerja: 9 meja dalam 2 baris ---
    DESKS.forEach((d, i) => drawDesk(d, i));

    // --- jalur antar baris meja ---
    ctx.fillStyle = "#334060";
    roundRect(ctx, R.x + 60, R.y + 498, R.w - 120, 48, 10);
    ctx.fill();
    ctx.strokeStyle = "#43527a";
    ctx.lineWidth = 3;
    ctx.stroke();

    // --- peralatan kantor ---
    drawWaterCooler(R.x + 24, R.y + 560);
    drawPrinter(R.x + R.w - 96, R.y + 610);

    // --- tanaman ---
    drawPlant(R.x + 26, R.y + R.h - 120);
    drawPlant(R.x + R.w - 58, R.y + 500);
    drawPlant(R.x + R.w - 58, R.y + R.h - 120);
  }

  function drawDesk(desk, i) {
    const x = desk.cx - desk.w / 2;
    const y = desk.top;

    // Bayangan lembut di bawah meja (gradien, bukan blok rata)
    const dg = ctx.createLinearGradient(0, y + desk.h - 6, 0, y + desk.h + 14);
    dg.addColorStop(0, "rgba(0,0,0,0)");
    dg.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = dg;
    ctx.fillRect(x - 8, y + desk.h - 6, desk.w + 16, 20);

    // Kaki meja
    ctx.fillStyle = "#5b4630";
    ctx.fillRect(x + 8, y + desk.h - 22, 9, 22);
    ctx.fillRect(x + desk.w - 17, y + desk.h - 22, 9, 22);

    // Badan meja — ketebalan + sisi yang lebih gelap memberi kesan volume
    ctx.fillStyle = "#8b6f47";
    ctx.fillRect(x, y + 14, desk.w, desk.h - 14);
    // Sisi bawah lebih gelap (menjauh dari cahaya)
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x, y + desk.h - 5, desk.w, 5);
    // Sisi kiri lebih gelap, sisi kanan sedikit terang (cahaya dari kanan atas)
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(x, y + 14, 4, desk.h - 14);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x + desk.w - 4, y + 14, 4, desk.h - 14);
    // Permukaan meja
    ctx.fillStyle = "#a08454";
    ctx.fillRect(x, y, desk.w, 14);
    // Kilau tepi depan permukaan (cahaya mengenai pinggir)
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(x, y + 12, desk.w, 2);
    // Tekstur serat kayu pada permukaan & badan meja
    woodGrain(ctx, x, y, desk.w, 14, 2);
    woodGrain(ctx, x, y + 14, desk.w, desk.h - 14, 4);

    // Monitor
    const mx = desk.cx - 34;
    const my = y - 44;
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(mx - 3, my - 3, 74, 46);
    ctx.fillStyle = "#0f2b45";
    ctx.fillRect(mx, my, 68, 40);

    // Isi layar (baris kode berwarna, berkedip halus)
    const colors = ["#22d3ee", "#4ade80", "#fbbf24", "#f87171", "#a78bfa"];
    for (let r = 0; r < 5; r++) {
      ctx.fillStyle = colors[(r + i) % colors.length];
      const lw = 16 + ((r * 17 + i * 11 + frame * 0.2) % 40);
      ctx.fillRect(mx + 6, my + 5 + r * 7, lw, 3);
    }
    // Glow layar — cahaya monitor memancar ke permukaan sekitar (pencahayaan)
    ctx.fillStyle = "rgba(34,211,238,0.12)";
    ctx.fillRect(mx - 14, my - 12, 96, 68);
    ctx.fillStyle = "rgba(34,211,238,0.05)";
    ctx.fillRect(mx - 24, my - 20, 116, 84);
    // Highlight layar (kilau kaca)
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(mx + 4, my + 4, 22, 6);

    // Kaki monitor
    ctx.fillStyle = "#374151";
    ctx.fillRect(desk.cx - 5, y - 3, 10, 8);

    // Keyboard
    ctx.fillStyle = "#374151";
    ctx.fillRect(desk.cx - 26, y + 18, 52, 13);
    ctx.fillStyle = "#4b5563";
    for (let kx = 0; kx < 6; kx++) {
      for (let ky = 0; ky < 2; ky++) {
        ctx.fillRect(desk.cx - 22 + kx * 8, y + 21 + ky * 5, 6, 3);
      }
    }
    // Mouse
    ctx.fillStyle = "#6b7280";
    ctx.fillRect(desk.cx + 32, y + 20, 10, 8);

    // Kursi — dudukan + sandaran + kaki, dengan tekstur kain
    ctx.fillStyle = "#3a4556";
    ctx.fillRect(desk.cx - 22, y + desk.h + 6, 44, 14);        // sandaran
    ctx.fillStyle = "#4a5568";
    ctx.fillRect(desk.cx - 20, y + desk.h + 18, 40, 12);       // dudukan
    fabricTex(ctx, desk.cx - 20, y + desk.h + 18, 40, 12);     // tekstur kain
    // Kaki kursi
    ctx.fillStyle = "#2f3949";
    ctx.fillRect(desk.cx - 18, y + desk.h + 30, 5, 8);
    ctx.fillRect(desk.cx + 13, y + desk.h + 30, 5, 8);
    // Rim light di sandaran
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(desk.cx - 22, y + desk.h + 6, 44, 2);
  }

  function drawLoungeProps() {
    const R = ROOMS.lounge;

    // Sofa
    drawSofa(R.x + 70, R.y + 330);

    // TV di dinding
    drawTV(R.x + R.w / 2 - 90, R.y + 80);

    // Meja kopi
    drawCoffeeTable(R.x + 420, R.y + 420);

    // Mesin kopi
    drawCoffeeMachine(R.x + 720, R.y + 470);

    // Lampu lantai
    drawFloorLamp(R.x + 700, R.y + 300);

    // Poster
    drawPoster(R.x + 120, R.y + 70, 110, 130, "MISSION", "#4ade80");
    drawPoster(R.x + 640, R.y + 90, 90, 100, "2D", "#22d3ee");

    // Tanaman
    drawPlant(R.x + 26, R.y + R.h - 120);
    drawPlant(R.x + R.w - 60, R.y + R.h - 120);

    // Karpet — tekstur kain + pola garis halus
    ctx.fillStyle = "#3d3560";
    roundRect(ctx, R.x + 250, R.y + 500, 440, 150, 14);
    ctx.fill();
    fabricTex(ctx, R.x + 250, R.y + 500, 440, 150);
    ctx.strokeStyle = "#4d4478";
    ctx.lineWidth = 3;
    roundRect(ctx, R.x + 250, R.y + 500, 440, 150, 14);
    ctx.stroke();
    // Pola garis karpet
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const yy = R.y + 500 + i * 30;
      ctx.beginPath();
      ctx.moveTo(R.x + 260, yy);
      ctx.lineTo(R.x + 680, yy);
      ctx.stroke();
    }
  }

  function drawSofa(x, y) {
    const w = 330, h = 96;
    // Bayangan lembut di bawah sofa (gradien)
    const sg = ctx.createLinearGradient(0, y + h - 6, 0, y + h + 12);
    sg.addColorStop(0, "rgba(0,0,0,0)");
    sg.addColorStop(1, "rgba(0,0,0,0.4)");
    ctx.fillStyle = sg;
    ctx.fillRect(x - 8, y + h - 6, w + 16, 18);

    // Badan sofa — gradien supaya terasa empuk dan tidak rata
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, "#7c3aed");
    bg.addColorStop(1, "#4c1d95");
    ctx.fillStyle = bg;
    ctx.fillRect(x, y + 26, w, h - 26);
    // Sandaran & lengan
    ctx.fillStyle = "#581c87";
    ctx.fillRect(x, y, w, 34);
    ctx.fillRect(x - 14, y + 12, 18, h - 12);
    ctx.fillRect(x + w - 4, y + 12, 18, h - 12);
    // Bantalan duduk dengan tekstur kain
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = "#7c3aed";
      roundRect(ctx, x + 18 + i * 100, y + 44, 88, 30, 6);
      ctx.fill();
      fabricTex(ctx, x + 18 + i * 100, y + 44, 88, 30);
    }
    // Rim light pada sandaran
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(x, y, w, 3);
  }

  function drawTV(x, y) {
    const w = 180, h = 104;
    // Glow layar — cahaya TV memancar ke dinding sekitar
    const tg = ctx.createRadialGradient(x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, w);
    tg.addColorStop(0, "rgba(34,211,238,0.10)");
    tg.addColorStop(1, "rgba(34,211,238,0)");
    ctx.fillStyle = tg;
    ctx.fillRect(x - 40, y - 40, w + 80, h + 80);

    ctx.fillStyle = "#111827";
    ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
    ctx.fillStyle = "#152b47";
    ctx.fillRect(x, y, w, h);
    // Kilau kaca layar
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(x + 10, y + 10, 46, 12);

    // Grafik gelombang animasi
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= w; i += 3) {
      const yy = y + h / 2 + Math.sin((i + frame * 3) * 0.05) * 24;
      i === 0 ? ctx.moveTo(x + i, yy) : ctx.lineTo(x + i, yy);
    }
    ctx.stroke();

    ctx.strokeStyle = "#4ade80";
    ctx.beginPath();
    for (let i = 0; i <= w; i += 3) {
      const yy = y + h / 2 + Math.cos((i + frame * 2) * 0.04) * 18;
      i === 0 ? ctx.moveTo(x + i, yy) : ctx.lineTo(x + i, yy);
    }
    ctx.stroke();

    ctx.fillStyle = "#374151";
    ctx.fillRect(x + w / 2 - 6, y + h + 5, 12, 18);
    ctx.fillRect(x + w / 2 - 28, y + h + 23, 56, 7);
  }

  function drawCoffeeTable(x, y) {
    // Bayangan lembut
    const cg = ctx.createLinearGradient(0, y + 26, 0, y + 40);
    cg.addColorStop(0, "rgba(0,0,0,0)");
    cg.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = cg;
    ctx.fillRect(x - 6, y + 26, 152, 14);

    // Meja — kayu dengan serat
    ctx.fillStyle = "#6d5636";
    ctx.fillRect(x, y, 140, 12);
    woodGrain(ctx, x, y, 140, 12, 2);
    ctx.fillStyle = "#5c4033";
    ctx.fillRect(x + 8, y + 12, 10, 30);
    ctx.fillRect(x + 122, y + 12, 10, 30);
    woodGrain(ctx, x + 8, y + 12, 10, 30, 2);
    woodGrain(ctx, x + 122, y + 12, 10, 30, 2);

    // Cangkir & buku
    ctx.fillStyle = "#d4a574";
    ctx.fillRect(x + 22, y - 12, 16, 12);
    ctx.fillStyle = "#8b6f47";
    ctx.fillRect(x + 60, y - 10, 26, 10);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(x + 100, y - 9, 20, 9);
  }

  function drawCoffeeMachine(x, y) {
    ctx.fillStyle = "#374151";
    ctx.fillRect(x, y - 54, 46, 54);
    ctx.fillStyle = "#4b5563";
    ctx.fillRect(x + 5, y - 48, 36, 14);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(x + 10, y - 44, 5, 5);
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(x + 20, y - 44, 5, 5);
    // Cangkir
    ctx.fillStyle = "#d4a574";
    ctx.fillRect(x + 16, y - 14, 14, 12);
    // Asap
    const s = (frame * 0.05) % 4;
    ctx.fillStyle = "rgba(226,232,240,0.3)";
    ctx.fillRect(x + 20, y - 22 - s * 5, 3, 5);
    ctx.fillRect(x + 24, y - 27 - s * 5, 3, 5);
    // Meja
    ctx.fillStyle = "#6d5636";
    ctx.fillRect(x - 10, y, 66, 12);
    ctx.fillStyle = "#5c4033";
    ctx.fillRect(x - 4, y + 12, 8, 32);
    ctx.fillRect(x + 48, y + 12, 8, 32);
  }

  function drawFloorLamp(x, y) {
    ctx.fillStyle = "#4b5563";
    ctx.fillRect(x + 10, y, 6, 150);
    ctx.fillStyle = "#374151";
    ctx.fillRect(x, y + 148, 26, 8);
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(x - 6, y - 26, 38, 32);

    const g = ctx.createRadialGradient(x + 13, y - 10, 6, x + 13, y - 10, 110);
    g.addColorStop(0, "rgba(251,191,36,0.16)");
    g.addColorStop(1, "rgba(251,191,36,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 100, y - 120, 240, 240);
  }

  function drawPoster(x, y, w, h, text, color) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.min(w / 4, h / 3.4)}px 'Courier New', monospace`;
    ctx.textAlign = "center";
    ctx.fillText(text, x + w / 2, y + h / 2 + 6);
    ctx.textAlign = "left";
  }

  function drawShelf(x, y) {
    // Bayangan lembut di belakang rak
    const shg = ctx.createLinearGradient(0, y, 0, y + 110);
    shg.addColorStop(0, "rgba(0,0,0,0)");
    shg.addColorStop(1, "rgba(0,0,0,0.3)");
    ctx.fillStyle = shg;
    ctx.fillRect(x - 4, y + 4, 82, 110);
    // Rak — kayu dengan serat
    ctx.fillStyle = "#5c4033";
    ctx.fillRect(x, y, 74, 110);
    woodGrain(ctx, x, y, 74, 110, 6);
    // Rim light pada tepi kiri
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x, y, 3, 110);
    for (let i = 0; i < 3; i++) {
      const sy = y + 16 + i * 32;
      ctx.fillStyle = "#8b7355";
      ctx.fillRect(x + 6, sy, 62, 5);
      const cols = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b"];
      for (let j = 0; j < 5; j++) {
        ctx.fillStyle = cols[(i * 5 + j) % cols.length];
        const iw = 8 + ((j * 7 + i * 5) % 9);
        const ih = 12 + ((j * 6 + i * 9) % 14);
        ctx.fillRect(x + 10 + j * 12, sy - ih, iw, ih);
        // Kilau buku
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(x + 10 + j * 12, sy - ih, 2, ih);
      }
    }
  }

  function drawStatusBoard(x, y) {
    const w = 180, h = 62;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#2a3550";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);

    const states = ["working", "idle", "reviewing", "collaborating"];
    const colors = { working: "#4ade80", idle: "#facc15", reviewing: "#22d3ee", collaborating: "#a855f7" };
    states.forEach((s, i) => {
      const sx = x + 14 + i * 42;
      const blink = Math.sin(frame * 0.06 + i) > 0;
      ctx.fillStyle = blink ? colors[s] : colors[s] + "44";
      ctx.fillRect(sx, y + 14, 12, 12);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 10px 'Courier New', monospace";
      ctx.fillText(s.slice(0, 3).toUpperCase(), sx - 1, y + 44);
    });
  }

  function drawPlant(x, y) {
    // Bayangan pot di lantai
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x + 2, y + 48, 24, 6);

    // Pot — gradien (kiri terang, kanan gelap) + rim
    const pg = ctx.createLinearGradient(x, y + 26, x + 26, y + 52);
    pg.addColorStop(0, "#a0522d");
    pg.addColorStop(1, "#6b3410");
    ctx.fillStyle = pg;
    ctx.fillRect(x, y + 26, 26, 26);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x, y + 26, 26, 2);

    // Batang
    ctx.strokeStyle = "#3f6212";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 13, y + 30);
    ctx.lineTo(x + 13, y + 8);
    ctx.stroke();

    // Daun — beberapa lapis warna untuk kesan rimbun
    ctx.fillStyle = "#2d6a4f";
    const leaves = [[6, 0], [20, 0], [4, -12], [22, -12], [13, -20]];
    for (const [lx, ly] of leaves) ctx.fillRect(x + lx, y + ly + 8, 6, 6);
    ctx.fillStyle = "#40916c";
    const leaves2 = [[10, -6], [16, -6], [11, -14], [15, -14], [13, -2]];
    for (const [lx, ly] of leaves2) ctx.fillRect(x + lx, y + ly + 8, 5, 5);
    ctx.fillStyle = "#74c69d";
    ctx.fillRect(x + 11, y + 2, 6, 6);
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = p.life * 0.5;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- DEKORASI TAMBAHAN ----------
  function drawWhiteboard(x, y, w, h) {
    ctx.fillStyle = "#e8eefb";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    // Kilau permukaan papan (pantulan cahaya)
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(x + 4, y + 4, w * 0.45, 8);
    ctx.fillStyle = "rgba(148,163,184,0.18)";
    ctx.fillRect(x + 4, y + h - 14, w - 8, 10);

    // Coretan diagram
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 16, y + 20, 60, 38);
    ctx.strokeRect(x + 100, y + 20, 60, 38);
    ctx.beginPath();
    ctx.moveTo(x + 76, y + 39); ctx.lineTo(x + 100, y + 39);
    ctx.moveTo(x + 130, y + 58); ctx.lineTo(x + 130, y + 92);
    ctx.stroke();
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(x + 16, y + 78, 110, 4);
    ctx.fillStyle = "#16a34a";
    ctx.fillRect(x + 16, y + 90, 78, 4);
    ctx.fillStyle = "#334155";
    ctx.fillRect(x + 16, y + h - 26, 150, 4);
  }

  function drawWallClock(x, y) {
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(x + 26, y + 26, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 3;
    ctx.stroke();

    const t = frame * 0.01;
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 26, y + 26);
    ctx.lineTo(x + 26 + Math.cos(t) * 13, y + 26 + Math.sin(t) * 13);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 26, y + 26);
    ctx.lineTo(x + 26 + Math.cos(t * 12) * 9, y + 26 + Math.sin(t * 12) * 9);
    ctx.stroke();
  }

  function drawWaterCooler(x, y) {
    // Badan dispenser
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(x + 8, y, 34, 62);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(x + 8, y + 26, 34, 8);
    // Galon
    ctx.fillStyle = "#38bdf8";
    roundRect(ctx, x + 12, y - 26, 26, 28, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x + 16, y - 22, 5, 20);
    // Kran
    ctx.fillStyle = "#475569";
    ctx.fillRect(x + 16, y + 36, 6, 10);
    ctx.fillRect(x + 28, y + 36, 6, 10);
    // Tetesan
    const d = (frame * 0.08) % 8;
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(x + 18, y + 48 + d, 3, 4);
  }

  function drawPrinter(x, y) {
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x - 4, y + 42, 76, 8);
    // Meja
    ctx.fillStyle = "#5c4033";
    ctx.fillRect(x - 6, y + 34, 80, 10);
    ctx.fillRect(x, y + 44, 7, 22);
    ctx.fillRect(x + 61, y + 44, 7, 22);
    // Printer
    ctx.fillStyle = "#334155";
    ctx.fillRect(x + 4, y, 60, 34);
    ctx.fillStyle = "#475569";
    ctx.fillRect(x + 10, y - 8, 48, 10);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(x + 12, y + 6, 44, 8);
    // Kertas keluar
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(x + 18, y - 18, 32, 12);
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(x + 48, y + 20, 6, 5);
  }

  // ---------- RUANG MEETING ----------
  function drawMeetingProps() {
    const R = ROOMS.meeting;

    // Papan tulis & layar proyektor di dinding
    drawWhiteboard(R.x + 50, R.y + 40, 250, 110);
    ctx.fillStyle = "#111827";
    ctx.fillRect(R.x + R.w - 130, R.y + 40, 110, 78);
    ctx.fillStyle = "#1e3a5f";
    ctx.fillRect(R.x + R.w - 124, R.y + 46, 98, 66);
    ctx.fillStyle = "#22d3ee";
    ctx.font = "bold 12px 'Courier New', monospace";
    ctx.textAlign = "center";
    ctx.fillText("AGENDA", R.x + R.w - 75, R.y + 84);
    ctx.textAlign = "left";

    // Meja rapat panjang — volume (sisi gelap) + serat kayu
    const tx = R.x + 110, ty = R.y + 200, tw = 340, th = 76;
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.fillRect(tx - 6, ty + th - 6, tw + 12, 12);
    // Badan meja
    ctx.fillStyle = "#5c4033";
    ctx.fillRect(tx, ty + 18, tw, th - 18);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(tx, ty + th - 5, tw, 5);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(tx, ty + 18, 4, th - 18);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(tx + tw - 4, ty + 18, 4, th - 18);
    // Permukaan meja
    ctx.fillStyle = "#6d5636";
    ctx.fillRect(tx, ty, tw, 18);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(tx, ty + 16, tw, 2);
    woodGrain(ctx, tx, ty, tw, 18, 3);
    woodGrain(ctx, tx, ty + 18, tw, th - 18, 4);
    // Kaki
    ctx.fillStyle = "#4a3528";
    ctx.fillRect(tx + 10, ty + th - 16, 10, 16);
    ctx.fillRect(tx + tw - 20, ty + th - 16, 10, 16);

    // Dokumen & cangkir di atas meja
    ctx.fillStyle = "#e8eefb";
    ctx.fillRect(tx + 40, ty + 24, 46, 30);
    ctx.fillRect(tx + 150, ty + 26, 46, 30);
    ctx.fillStyle = "#d4a574";
    ctx.fillRect(tx + 110, ty + 26, 12, 12);
    ctx.fillRect(tx + 240, ty + 26, 12, 12);

    // Kursi: 3 di atas meja, 3 di bawah
    [190, 300, 410].forEach((cx) => {
      drawChair(R.x + cx, R.y + 172, "up");
      drawChair(R.x + cx, R.y + 292, "down");
    });

    // Tanaman & lemari arsip
    drawPlant(R.x + 24, R.y + R.h - 130);
    const cx0 = R.x + R.w - 80, cy0 = R.y + R.h - 150;
    ctx.fillStyle = "#475569";
    ctx.fillRect(cx0, cy0, 54, 120);
    metalTex(ctx, cx0, cy0, 54, 120);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(cx0, cy0, 4, 120);
    ctx.fillStyle = "#334155";
    for (let i = 0; i < 3; i++) ctx.fillRect(cx0 + 6, cy0 + 10 + i * 36, 42, 26);
  }

  function drawChair(x, y, facing) {
    ctx.fillStyle = "#4a5568";
    ctx.fillRect(x - 18, y, 36, 14);
    ctx.fillStyle = "#3a4556";
    if (facing === "up") ctx.fillRect(x - 18, y - 10, 36, 12);
    else ctx.fillRect(x - 18, y + 14, 36, 12);
    // Tekstur kain pada dudukan
    fabricTex(ctx, x - 18, y, 36, 14);
    ctx.fillStyle = "#2d3748";
    ctx.fillRect(x - 16, y + 14, 6, 12);
    ctx.fillRect(x + 10, y + 14, 6, 12);
  }

  // ---------- PANTRY ----------
  function drawPantryProps() {
    const R = ROOMS.pantry;

    // Meja panjang (counter) di dinding. DIPENDEKKAN (380, bukan selebar
    // ruangan) dan digeser ke bawah supaya ada lajur kosong di sisi kanan —
    // lajur itu dipakai jalur grid (lihat buildSolids), tanpa itu agent di
    // Pantry akan macet permanen.
    const cx = R.x + 20, cy = R.y + 260, cw = 380;
    // Badan counter — volume (sisi gelap) + serat kayu
    ctx.fillStyle = "#5c4033";
    ctx.fillRect(cx, cy + 20, cw, 46);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(cx, cy + 61, cw, 5);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(cx, cy + 20, 4, 46);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(cx + cw - 4, cy + 20, 4, 46);
    // Permukaan counter (kilau batu/kayu)
    ctx.fillStyle = "#6d5636";
    ctx.fillRect(cx, cy, cw, 20);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(cx, cy + 17, cw, 3);
    woodGrain(ctx, cx, cy, cw, 20, 4);
    woodGrain(ctx, cx, cy + 20, cw, 46, 5);

    // Mesin kopi
    ctx.fillStyle = "#374151";
    ctx.fillRect(cx + 70, cy - 46, 54, 46);
    ctx.fillStyle = "#4b5563";
    ctx.fillRect(cx + 76, cy - 40, 42, 14);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(cx + 82, cy - 36, 6, 6);
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(cx + 94, cy - 36, 6, 6);
    const smoke = (frame * 0.05) % 4;
    ctx.fillStyle = "rgba(226,232,240,0.32)";
    ctx.fillRect(cx + 88, cy - 54 - smoke * 5, 4, 6);
    ctx.fillRect(cx + 94, cy - 60 - smoke * 5, 4, 6);

    // Rak camilan
    for (let i = 0; i < 2; i++) {
      const sy = cy - 34 + i * 22;
      ctx.fillStyle = "#8b7355";
      ctx.fillRect(cx + 180, sy, 120, 5);
      const cols = ["#f59e0b", "#ef4444", "#10b981", "#3b82f6"];
      for (let j = 0; j < 6; j++) {
        ctx.fillStyle = cols[(i * 6 + j) % cols.length];
        ctx.fillRect(cx + 186 + j * 18, sy - 14, 12, 14);
      }
    }

    // Kulkas — koordinat sama dengan solid di buildSolids
    const fx = R.x + R.w - 110, fy = R.y + 130;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(fx, fy, 74, 116);
    metalTex(ctx, fx, fy, 74, 116);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(fx + 6, fy + 6, 8, 104);
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(fx + 4, fy + 66, 66, 5);
    ctx.fillStyle = "#475569";
    ctx.fillRect(fx + 60, fy + 30, 6, 22);
    ctx.fillRect(fx + 60, fy + 72, 6, 22);

    // Meja tinggi + kursi bar
    const hx = R.x + 220, hy = R.y + 360;
    ctx.fillStyle = "#a08454";
    roundRect(ctx, hx, hy, 200, 20, 6);
    ctx.fill();
    ctx.fillStyle = "#6d5636";
    ctx.fillRect(hx + 16, hy + 20, 12, 50);
    ctx.fillRect(hx + 172, hy + 20, 12, 50);
    [hx + 30, hx + 96, hx + 162].forEach((sx) => drawStool(sx, hy + 34));
    // Camilan di meja
    ctx.fillStyle = "#d4a574";
    ctx.fillRect(hx + 40, hy - 12, 14, 12);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(hx + 100, hy - 10, 16, 10);

    drawPlant(R.x + 26, R.y + R.h - 130);
  }

  function drawStool(x, y) {
    ctx.fillStyle = "#4a5568";
    roundRect(ctx, x - 14, y, 28, 12, 5);
    ctx.fill();
    ctx.fillStyle = "#374151";
    ctx.fillRect(x - 3, y + 12, 6, 30);
    ctx.fillRect(x - 12, y + 40, 24, 6);
  }

  // ---------- TAMAN ----------
  function drawGardenProps() {
    const R = ROOMS.garden;

    // Jalur batu
    ctx.fillStyle = "#4b5563";
    for (let i = 0; i < 7; i++) {
      const px = R.x + 60 + i * 58;
      const py = R.y + R.h - 120 + Math.sin(i * 1.3) * 26;
      roundRect(ctx, px, py, 44, 22, 8);
      ctx.fill();
    }

    // Pohon
    drawTree(R.x + 90, R.y + 230);
    drawTree(R.x + R.w - 110, R.y + 300);
    drawTree(R.x + R.w - 60, R.y + R.h - 250);

    // Bangku
    drawBench(R.x + 110, R.y + 290);
    drawBench(R.x + 300, R.y + 290);

    // Air mancur
    drawFountain(R.x + 200, R.y + 460);

    // Petak bunga
    drawFlowerBed(R.x + 30, R.y + 180, 120, 40);
    drawFlowerBed(R.x + R.w - 170, R.y + 180, 130, 40);

    // Semak
    ctx.fillStyle = "#2f6b45";
    for (let i = 0; i < 8; i++) {
      const bx = R.x + 40 + i * 56;
      const by = R.y + R.h - 40;
      ctx.beginPath();
      ctx.arc(bx, by, 15, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTree(x, y) {
    // Bayangan
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(x, y + 74, 34, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Batang
    ctx.fillStyle = "#6b4a2f";
    ctx.fillRect(x - 9, y + 30, 18, 46);
    // Daun (berlapis)
    const sway = Math.sin(frame * 0.02 + x) * 2;
    ctx.fillStyle = "#2d6a4f";
    ctx.beginPath();
    ctx.arc(x + sway, y + 10, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3d8b63";
    ctx.beginPath();
    ctx.arc(x - 18 + sway, y + 24, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 18 + sway, y + 24, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4ade80";
    ctx.beginPath();
    ctx.arc(x + 8 + sway, y - 2, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBench(x, y) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x - 8, y + 34, 116, 8);
    // Dudukan
    ctx.fillStyle = "#8b6f47";
    ctx.fillRect(x, y + 10, 100, 14);
    // Sandaran
    ctx.fillStyle = "#a08454";
    ctx.fillRect(x, y - 12, 100, 12);
    // Kaki besi
    ctx.fillStyle = "#4b5563";
    ctx.fillRect(x + 6, y + 24, 8, 14);
    ctx.fillRect(x + 86, y + 24, 8, 14);
  }

  function drawFountain(x, y) {
    // Kolam
    ctx.fillStyle = "#475569";
    ctx.beginPath();
    ctx.ellipse(x, y, 66, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1e3a5f";
    ctx.beginPath();
    ctx.ellipse(x, y, 56, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(56,189,248,0.45)";
    ctx.beginPath();
    ctx.ellipse(x, y, 44, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tiang & air
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(x - 7, y - 44, 14, 44);
    ctx.fillStyle = "#e0f2fe";
    ctx.beginPath();
    ctx.arc(x, y - 48, 11, 0, Math.PI * 2);
    ctx.fill();
    // Pancuran beranimasi
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + frame * 0.03;
      const t = ((frame * 0.05) % 20) / 20;
      ctx.fillStyle = "rgba(125,211,252,0.75)";
      ctx.fillRect(
        x + Math.cos(a) * (10 + t * 26),
        y - 46 + Math.sin(a) * 8 + t * 30, 4, 4);
    }
  }

  function drawFlowerBed(x, y, w, h) {
    ctx.fillStyle = "#3f3222";
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();
    const cols = ["#f472b6", "#fbbf24", "#a78bfa", "#f87171", "#60a5fa"];
    for (let i = 0; i < Math.floor(w / 22); i++) {
      const fx = x + 12 + i * 22;
      const fy = y + 12 + (i % 2) * 14;
      ctx.fillStyle = "#2f6b45";
      ctx.fillRect(fx, fy + 6, 3, 8);
      ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath();
      ctx.arc(fx + 1, fy + 4, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- AGENT ----------
  function drawAgents() {
    // Urutkan berdasarkan y supaya tumpang tindih benar
    const list = [...sims.values()]
      .filter((s) => s.agent && s.agent.state !== "offline")
      .sort((a, b) => a.y - b.y);

    for (const sim of list) drawAgentSprite(sim);
  }

  function drawAgentSprite(sim) {
    const agent = sim.agent;
    const color = agent.avatar_color || "#4ade80";
    const x = sim.x;
    const walking = sim.mode !== "work" && sim.mode !== "loungeIdle" && !sim.chatId;
    const bob = walking ? Math.abs(Math.sin(sim.walkBob)) * 3 : 0;
    const breathe = sim.mode === "work" ? Math.sin(frame * 0.06) * 1.2 : Math.sin(frame * 0.04) * 0.8;
    const y = sim.y - bob;

    // Bayangan lembut (gradien radial) — lebih natural daripada ellipse rata,
    // memberi kesan agent "berdiri di atas" lantai.
    const sh = ctx.createRadialGradient(x, sim.y + 16, 2, x, sim.y + 16, 20);
    sh.addColorStop(0, "rgba(0,0,0,0.45)");
    sh.addColorStop(0.55, "rgba(0,0,0,0.2)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(x, sim.y + 16, 20, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ring seleksi
    if (selectedAgentId === agent.id) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.ellipse(x, sim.y + 16, 26, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const f = sim.facing;

    // --------------------------------------------------------------
    // DUDUK: agent berada di tempat duduk (kursi rapat, sofa, bangku,
    // meja tinggi) atau sedang bekerja di mejanya. Animasi berjalan
    // dihentikan dan diganti pose duduk — ini juga yang mencegah agent
    // terlihat "jalan di tempat" saat sudah sampai.
    // --------------------------------------------------------------
    const spot = currentSpot(sim);
    const seated = !sim.chatId && (
      sim.mode === "work" ||
      (sim.mode === "loungeIdle" && !!spot && spot.sit === true)
    );
    sim.seated = seated;

    const ay = y + breathe + (seated ? 5 : 0);

    // Kaki
    ctx.fillStyle = "#1f2937";
    if (seated) {
      // Paha mendatar ke depan, betis turun ke bawah (pose duduk)
      ctx.fillRect(x - 10, ay + 7, 20, 7);
      ctx.fillRect(x - 10, ay + 13, 7, 9);
      ctx.fillRect(x + 3, ay + 13, 7, 9);
    } else if (walking) {
      const swing = Math.sin(sim.walkBob) * 5;
      ctx.fillRect(x - 9 + swing, ay + 12, 7, 12);
      ctx.fillRect(x + 2 - swing, ay + 12, 7, 12);
    } else {
      ctx.fillRect(x - 9, ay + 12, 7, 12);
      ctx.fillRect(x + 2, ay + 12, 7, 12);
    }

    // --------------------------------------------------------------
    // Kursi: sandaran digambar DI BELAKANG badan supaya pose duduk
    // terlihat jelas (kaki sering tertutup meja).
    // --------------------------------------------------------------
    if (seated) {
      ctx.fillStyle = "#334155";
      roundRect(ctx, x - 16, ay - 24, 32, 32, 5);
      ctx.fill();
      ctx.fillStyle = "#475569";
      roundRect(ctx, x - 16, ay - 24, 32, 9, 5);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x - 16, ay - 15, 32, 2);
    }

    // Badan — gradien halus kiri→kanan supaya terasa bulat (bukan warna rata)
    const bg = ctx.createLinearGradient(x - 13, 0, x + 13, 0);
    bg.addColorStop(0, shade(color, 1.24));
    bg.addColorStop(0.45, color);
    bg.addColorStop(1, shade(color, 0.76));
    ctx.fillStyle = bg;
    roundRect(ctx, x - 13, ay - 18, 26, 32, 5);
    ctx.fill();

    // Rim light — cahaya tepi dari kiri atas supaya agen terasa 3D
    ctx.fillStyle = "rgba(255,255,255,0.11)";
    ctx.fillRect(x - 12, ay - 17, 3, 29);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x - 12, ay - 17, 7, 3);

    // Kerah
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x - 13, ay - 18, 26, 6);

    // Menghadap komputer → tampak dari belakang (tidak menghadap kamera)
    const facingUp = sim.mode === "work" && !sim.chatId;

    if (facingUp) {
      // ---- TAMPILAN BELAKANG: sedang menatap layar ----
      const t = Math.sin(frame * 0.16) * 2.5;

      // Lengan menjangkau ke depan (ke arah keyboard)
      ctx.fillStyle = color;
      ctx.fillRect(x - 19, ay - 16, 7, 15);
      ctx.fillRect(x + 12, ay - 16, 7, 15);
      ctx.fillRect(x - 25, ay - 31 + t, 7, 16);
      ctx.fillRect(x + 18, ay - 31 - t, 7, 16);

      // Tangan di atas keyboard
      ctx.fillStyle = shade(color, 0.72);
      ctx.fillRect(x - 25, ay - 35 + t, 7, 5);
      ctx.fillRect(x + 18, ay - 35 - t, 7, 5);

      // Kepala dari belakang — rambut menutupi seluruh kepala (tanpa wajah)
      ctx.fillStyle = shade(color, 0.6);
      roundRect(ctx, x - 12, ay - 40, 24, 24, 7);
      ctx.fill();

      // Kilau rambut
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      roundRect(ctx, x - 10, ay - 38, 8, 20, 4);
      ctx.fill();

      // Leher
      ctx.fillStyle = shade(color, 0.48);
      ctx.fillRect(x - 4, ay - 18, 8, 5);

      // Headset — penanda sedang fokus di depan komputer
      ctx.strokeStyle = "rgba(15,23,42,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, ay - 28, 15, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(x - 20, ay - 31, 6, 11);
      ctx.fillRect(x + 14, ay - 31, 6, 11);
    } else {
      // ---- TAMPILAN SAMPING / DEPAN ----
      // Lengan
      ctx.fillStyle = color;
      if (sim.chatId) {
        const g = Math.sin(frame * 0.09) * 2;
        ctx.fillRect(x - 19, ay - 14 + g, 7, 16);
        ctx.fillRect(x + 12, ay - 14 - g, 7, 16);
      } else {
        const s = walking ? Math.sin(sim.walkBob) * 4 : 0;
        ctx.fillRect(x - 19, ay - 12 + s, 7, 16);
        ctx.fillRect(x + 12, ay - 12 - s, 7, 16);
      }

      // Kepala — gradien lembut + highlight supaya terasa bulat
      const hg = ctx.createLinearGradient(x - 12, 0, x + 12, 0);
      hg.addColorStop(0, shade(color, 1.2));
      hg.addColorStop(0.5, color);
      hg.addColorStop(1, shade(color, 0.8));
      ctx.fillStyle = hg;
      roundRect(ctx, x - 12, ay - 40, 24, 24, 6);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      roundRect(ctx, x - 10, ay - 38, 9, 6, 3);
      ctx.fill();

      // Rambut
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x - 12, ay - 40, 24, 7);

      // "Bicara" = gelembung dialognya sedang tampil di atas kepala
      const speaking = !!(sim.bubble && sim.bubble.kind === "chat");

      // Mata (kedip) — mata tertutup juga dipakai saat tertawa
      const emo = String(sim.emotion || "").toLowerCase();
      const blinking = sim.blink < 0 || emo === "tertawa";
      ctx.fillStyle = "#0b1020";
      if (blinking) {
        ctx.fillRect(x - 7, ay - 29, 5, 2);
        ctx.fillRect(x + 2, ay - 29, 5, 2);
      } else {
        const look = f === "left" ? -1.5 : 1.5;
        ctx.fillRect(x - 7 + look, ay - 31, 5, 6);
        ctx.fillRect(x + 2 + look, ay - 31, 5, 6);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x - 6 + look, ay - 30, 2, 2);
        ctx.fillRect(x + 3 + look, ay - 30, 2, 2);
      }

      // Mulut mengikuti EMOSI (marah, senang, tertawa, sedih, kesal, ...)
      ctx.fillStyle = "#0b1020";
      if (emo === "tertawa") {
        const open = 4 + Math.abs(Math.sin(frame * 0.3)) * 3;
        ctx.fillRect(x - 5, ay - 23, 10, open);
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(x - 5, ay - 23, 10, 1.5);       // gigi atas
      } else if (emo === "sedih" || emo === "cemas") {
        ctx.fillRect(x - 4, ay - 21, 8, 1.5);       // mulut melengkung ke bawah
        ctx.fillRect(x - 6, ay - 22, 2, 1.5);
        ctx.fillRect(x + 4, ay - 22, 2, 1.5);
      } else if (emo === "marah" || emo === "kesal") {
        ctx.fillRect(x - 4, ay - 21, 8, 2.5);       // mulut tegang
      } else if (emo === "senang" || emo === "bangga" || emo === "kagum") {
        ctx.fillRect(x - 4, ay - 22, 8, 1.5);       // senyum tipis
        ctx.fillRect(x - 5, ay - 23, 1.5, 1.5);
        ctx.fillRect(x + 3.5, ay - 23, 1.5, 1.5);
      } else if (speaking) {
        // ANIMASI BICARA: bibir atas & bawah membuka-tutup seperti orang
        // sedang bicara, mengikuti gelembung dialog yang tampil.
        const ph = Math.sin(frame * 0.9);           // fase suara
        const open = 1.5 + Math.abs(ph) * 5;        // tinggi rongga mulut
        const jaw = Math.abs(ph) * 1.5;             // rahang turun sedikit
        ctx.fillStyle = "#0b1020";
        ctx.fillRect(x - 4, ay - 22, 8, open);      // rongga mulut
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(x - 4, ay - 22, 8, 1.2);       // gigi atas
        ctx.fillStyle = "#0b1020";
        ctx.fillRect(x - 4, ay - 22 + open + jaw, 8, 1.5);   // bibir bawah
      } else {
        // Tidak ada dialog → mulut tertutup
        ctx.fillRect(x - 3, ay - 22, 6, 1);
      }
    }
  }

  // ---------- LAYER TEKS (TAJAM) ----------
  function drawBubbles() {
    for (const sim of sims.values()) {
      if (!sim.agent || sim.agent.state === "offline") continue;
      const head = w2s(sim.x, sim.y - 62);
      if (head.x < -260 || head.x > W + 260 || head.y < -200 || head.y > H + 200) continue;

      // 1) Bubble dialog — hanya satu agent yang berbicara
      if (sim.bubble && sim.bubble.kind === "chat") {
        drawSpeechBubble(head.x, head.y, sim.bubble.text, sim.agent.avatar_color,
                         14, sim.bubble.speaker, sim.bubble.emotion);
        continue;
      }
      // Yang mendengarkan hanya menampilkan tanda menunggu (…)
      if (sim.bubble && sim.bubble.kind === "waiting") {
        drawWaitingBubble(head.x + (sim.bubble.dx || 0), head.y + 10);
        continue;
      }

      // Kartu nama + label dihitung dulu (selalu tampil agar agent mudah dikenali)
      const taskText = sim.agent.current_task;
      const aiAct = (sim.mode === "work" || sim.mode === "loungeIdle")
        ? sim.aiActivity : null;
      const idleMind = (sim.agent.state === "idle" || sim.agent.state === "offline")
        ? sim.thought : null;
      const label = taskText || idleMind || aiAct || sim.activity;
      const isReal = !!taskText;
      const card = () => drawHeadLabel(head.x, head.y, sim.agent.name, label,
                                       sim.agent.state, sim.agent.avatar_color,
                                       isReal, sim.emotion);

      // 1) MENGobrol → gelembung PUTIH, teks tebal & jelas.
      //    Saat mengobrol, gelembung "bicara sendiri" TIDAK ditampilkan.
      if (sim.bubble && sim.bubble.kind === "chat") {
        card();
        drawSpeechBubble(head.x, head.y - 56, sim.bubble.text,
                         sim.agent.avatar_color, 15, sim.bubble.speaker,
                         sim.bubble.emotion, "chat");
        continue;
      }
      // Yang mendengarkan hanya menampilkan tanda menunggu (…)
      if (sim.bubble && sim.bubble.kind === "waiting") {
        card();
        drawWaitingBubble(head.x + (sim.bubble.dx || 0), head.y + 12);
        continue;
      }

      // 2) TIDAK mengobrol → hanya kartu nama.
      //    Gelembung "bicara sendiri" DIHAPUS karena mengganggu; fokus penuh
      //    pada obrolan antar agent.
      card();
    }
  }

  function drawHeadLabel(cx, cy, name, label, state, color, isReal, emotion) {
    const stateColors = {
      working: "#4ade80", idle: "#facc15", reviewing: "#22d3ee",
      collaborating: "#a855f7", offline: "#64748b", unknown: "#f97316",
    };
    const sc = stateColors[state] || "#64748b";
    const emoji = emotionEmoji(emotion);

    ctx.font = "700 13px 'Segoe UI', system-ui, -apple-system, sans-serif";
    const nameW = ctx.measureText(name).width;
    ctx.font = "500 12px 'Segoe UI', system-ui, -apple-system, sans-serif";
    const labelText = label.length > 34 ? label.slice(0, 33) + "…" : label;
    const labelW = ctx.measureText(labelText).width;

    const w = Math.max(nameW, labelW, 92) + 26;
    const h = 44;
    const x = cx - w / 2;
    const y = cy - h;

    // Kartu
    ctx.fillStyle = "rgba(8,12,22,0.93)";
    roundRect(ctx, x, y, w, h, 9);
    ctx.fill();
    ctx.strokeStyle = sc;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Penanda state (garis kiri)
    ctx.fillStyle = sc;
    roundRect(ctx, x + 1, y + 1, 5, h - 2, 3);
    ctx.fill();

    // Nama
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "700 13px 'Segoe UI', system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(name, cx, y + 18);

    // Label task / aktivitas
    ctx.fillStyle = isReal ? color : "#94a3b8";
    ctx.font = "500 12px 'Segoe UI', system-ui, -apple-system, sans-serif";
    ctx.fillText(labelText, cx, y + 35);

    // Emoji dihapus: emosi cukup tersampaikan lewat kata-kata obrolan.

    // Ekor
    ctx.fillStyle = "rgba(8,12,22,0.93)";
    ctx.beginPath();
    ctx.moveTo(cx - 7, y + h);
    ctx.lineTo(cx + 7, y + h);
    ctx.lineTo(cx, y + h + 9);
    ctx.closePath();
    ctx.fill();

    ctx.textAlign = "left";
  }

  /**
   * Gelembung di atas kepala agent.
   *
   * variant "chat" = sedang MENGobrol: latar putih, teks tebal & gelap (jelas).
   * variant "self" = sedang BICARA SENDIRI: latar abu, teks tipis (redup).
   *
   * Teks tidak pernah dipotong — bubble melebar dan membungkus baris
   * sebanyak yang diperlukan, lalu dijepit agar tetap di dalam layar.
   */
  function drawSpeechBubble(cx, cy, text, color, fontSize, speakerName, emotion, variant) {
    const isChat = variant !== "self";
    const maxW = isChat ? 360 : 300;
    const textFont = isChat
      ? `700 ${fontSize}px 'Segoe UI', system-ui, -apple-system, sans-serif`
      : `400 ${fontSize - 1}px 'Segoe UI', system-ui, -apple-system, sans-serif`;
    const nameFont = "700 11px 'Segoe UI', system-ui, -apple-system, sans-serif";

    // Word wrap (tanpa memotong teks)
    ctx.font = textFont;
    const words = String(text).split(" ");
    const lines = [];
    let line = "";
    for (const wd of words) {
      const test = line ? line + " " + wd : wd;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = wd;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const lineH = fontSize + 7;
    const padX = 14, padY = 11;
    const nameH = speakerName ? 15 : 0;
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.font = nameFont;
    const nameW = speakerName ? ctx.measureText(speakerName).width : 0;

    const w = Math.max(textW, nameW) + padX * 2;
    const h = lines.length * lineH + padY * 2 + nameH;
    const x = clamp(cx - w / 2, 8, Math.max(8, W - w - 8));
    const y = clamp(cy - h, 8, Math.max(8, H - h - 26));

    // Kotak bubble — putih untuk obrolan, abu untuk bicara sendiri
    ctx.fillStyle = isChat ? "rgba(248,250,252,0.98)" : "rgba(100,116,139,0.90)";
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = isChat
      ? (emotion ? emotionColor(emotion) : "#0f172a")
      : "rgba(203,213,225,0.55)";
    ctx.lineWidth = isChat ? 2.5 : 1.5;
    ctx.stroke();

    // Nama pembicara (supaya jelas siapa yang bicara)
    if (speakerName) {
      ctx.fillStyle = isChat ? "#0f172a" : "#e2e8f0";
      ctx.font = nameFont;
      ctx.textAlign = "left";
      ctx.fillText(speakerName, x + padX, y + padY + 9);
    }

    // Teks
    ctx.fillStyle = isChat ? "#0b1020" : "#e8edf5";
    ctx.font = textFont;
    ctx.textAlign = "left";
    lines.forEach((l, i) => {
      ctx.fillText(l, x + padX, y + padY + nameH + fontSize + i * lineH);
    });

    // Catatan: emoji TIDAK ditampilkan di gelembung (dianggap mengganggu).
    // Emosi disampaikan lewat pilihan kata dalam obrolan itu sendiri.

    // Ekor menunjuk ke kepala agent
    const tailX = clamp(cx, x + 16, x + w - 16);
    ctx.fillStyle = "rgba(8,12,22,0.97)";
    ctx.beginPath();
    ctx.moveTo(tailX - 8, y + h - 1);
    ctx.lineTo(tailX + 8, y + h - 1);
    ctx.lineTo(tailX, y + h + 11);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(tailX - 8, y + h - 1);
    ctx.lineTo(tailX, y + h + 11);
    ctx.lineTo(tailX + 8, y + h - 1);
    ctx.stroke();
  }

  /** Tanda menunggu (…) — kecil dan redup, tidak bersaing dengan pembicara. */
  function drawWaitingBubble(cx, cy) {
    const w = 46, h = 26;
    const x = clamp(cx - w / 2, 6, Math.max(6, W - w - 6));
    const y = clamp(cy - h, 6, Math.max(6, H - h - 6));

    ctx.fillStyle = "rgba(8,12,22,0.78)";
    roundRect(ctx, x, y, w, h, 13);
    ctx.fill();
    ctx.strokeStyle = "rgba(148,163,184,0.55)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Tiga titik beranimasi
    ctx.textAlign = "center";
    ctx.font = "700 16px 'Segoe UI', system-ui, -apple-system, sans-serif";
    for (let i = 0; i < 3; i++) {
      const on = Math.floor(frame / 16) % 3 === i;
      ctx.globalAlpha = on ? 1 : 0.3;
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText("•", x + 12 + i * 11, y + 18);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function drawHud() {
    // Zoom indicator
    ctx.font = "600 12px 'Segoe UI', system-ui, -apple-system, sans-serif";
    const zt = `Zoom ${Math.round(camera.zoom * 100)}%`;
    const w = ctx.measureText(zt).width + 22;
    ctx.fillStyle = "rgba(8,12,22,0.85)";
    roundRect(ctx, W - w - 12, H - 38, w, 26, 7);
    ctx.fill();
    ctx.strokeStyle = "#2a3550";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(zt, W - w - 1, H - 20);

    // Jumlah agent per ruangan (semua ruangan)
    const counts = {};
    for (const s of sims.values()) {
      if (!s.agent || s.agent.state === "offline") continue;
      const r = roomAt(s.x, s.y);
      counts[r] = (counts[r] || 0) + 1;
    }
    for (const id of ROOM_ORDER) {
      drawRoomBadge(ROOMS[id], ROOMS[id].name, counts[id] || 0);
    }
  }

  function drawRoomBadge(room, name, count) {
    // Jangan tampilkan badge kalau ruangan sama sekali tidak terlihat di layar
    const tl = w2s(room.x, room.y);
    const br = w2s(room.x + room.w, room.y + room.h);
    const visible = br.x > 0 && tl.x < W && br.y > 0 && tl.y < H;
    if (!visible) return;

    const p = w2s(room.x + 16, room.y + 16);
    const sx = clamp(p.x, 6, Math.max(6, W - 210));
    const sy = clamp(p.y, 6, Math.max(6, H - 60));
    const w = 190, h = 46;

    ctx.fillStyle = "rgba(8,12,22,0.9)";
    roundRect(ctx, sx, sy, w, h, 9);
    ctx.fill();
    ctx.strokeStyle = "#2a3550";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#4ade80";
    ctx.font = "700 14px 'Segoe UI', system-ui, -apple-system, sans-serif";
    ctx.fillText("◢ " + name, sx + 12, sy + 20);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 12px 'Segoe UI', system-ui, -apple-system, sans-serif";
    ctx.fillText(`${count} agent di ruangan ini`, sx + 12, sy + 37);
  }

  // ============================================
  // API PUBLIK
  // ============================================
  return {
    init,
    resize,
    setData,
    setRoom,
    setSelectedAgent,
    setFollow,
    getFollow,
    getZoom,
    getCamera,
    zoomBy,
    resetCamera,
    /** Diagnostik (untuk pengujian & pemantauan): snapshot kondisi simulasi. */
    getDebugState: () => ({
      camera: { ...camera },
      canvas: { w: W, h: H, dpr },
      frames: frame,
      flyToPending: !!flyTo,
      chats: chats.length,
      mouthMoving: [...sims.values()].filter((s) => s.bubble && s.bubble.kind === "chat").length,
      chatDetail: chats.map((c) => ({
        room: c.room,
        phase: c.phase,
        sub: c.sub,
        idx: c.idx,
        source: c.source,
        model: c.model || null,
        lines: c.lines ? c.lines.map((l) => l.speaker + ":" + l.text) : [],
      })),
      dataTasks: dataTasks.length,
      dataSummary: dataSummary,
      rooms: ROOM_ORDER.slice(),
      deskCount: DESKS.length,
      hallY: HALL.cy,
      pathCalls: pathCalls,
      pathCacheSize: pathCache.size,
      poolSize: dialoguePool.length,
      instantChats: instantChats,
      agents: [...sims.values()].map((s) => ({
        id: s.id,
        name: s.agent ? s.agent.name : "?",
        state: s.state,
        x: Math.round(s.x),
        y: Math.round(s.y),
        room: roomAt(s.x, s.y),
        hangout: s.hangout || null,
        insideSolid: hitsSolid(s.x, s.y),
        thought: s.thought || null,
        mood: s.mood || null,
        emotion: s.emotion || null,
        seated: !!s.seated,
        walking: s.mode !== "work" && s.mode !== "loungeIdle" && !s.chatId &&
                 !(s.giveUpWait > 0),
        bubbleKind: s.bubble ? s.bubble.kind : null,
        bubbleEmotion: s.bubble ? (s.bubble.emotion || null) : null,
        memoryCount: (s.memory || []).length,
        mode: s.mode,
        facing: s.facing,
        facingUp: s.mode === "work" && !s.chatId,
        activity: s.activity,
        aiActivity: s.aiActivity || null,
        chatId: s.chatId,
        bubble: s.bubble ? s.bubble.kind + ":" + s.bubble.text : null,
        bubbleKind: s.bubble ? s.bubble.kind : null,
        bubbleSpeaker: s.bubble ? s.bubble.speaker : null,
      })),
    }),
    getCurrentRoom: () => null,

    /**
     * Tampilkan gelembung di atas kepala satu agen (dipakai menu chat).
     *
     * Inilah jembatan antara chat dan kantor 2D: ketika pengguna memanggil
     * nama agen, agen itu yang menjawab, dan jawabannya muncul sebagai
     * gelembung seperti biasa. Mengembalikan true bila agen ditemukan dan
     * gelembung terpasang, false bila id tidak dikenal.
     */
    say: (agentId, text, emotion, durationSec) => {
      let target = null;
      for (const sim of sims.values()) {
        if (sim.id === agentId) { target = sim; break; }
      }
      if (!target) return false;
      const clean = String(text == null ? "" : text).trim();
      if (!clean) return false;
      const emo = emotion || target.emotion || null;
      // Durasi mengikuti panjang kalimat, seperti gelembung obrolan biasa.
      const dur = Math.max(3.5, durationSec ||
        Math.min(16, Math.max(3.5, clean.length / 14)));
      target.bubble = {
        kind: "chat",
        text: clean,
        speaker: target.agent ? target.agent.name : "",
        emotion: emo,
        ttl: dur,
      };
      if (emo) target.emotion = emo;
      target.activity = "Menjawab pengguna";
      return true;
    },

    /** Daftar id agen yang sedang hidup di kantor (untuk validasi chat). */
    agentIds: () => [...sims.values()].map((s) => s.id),

    /**Nama agen berdasarkan id, atau null. */
    agentName: (agentId) => {
      for (const sim of sims.values()) {
        if (sim.id === agentId) return sim.agent ? sim.agent.name : "?";
      }
      return null;
    },
  };
})();
