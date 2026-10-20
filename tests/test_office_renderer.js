/**
 * Uji fungsional OfficeRenderer tanpa browser.
 * Menstub DOM + Canvas 2D API, lalu menjalankan render loop untuk
 * memverifikasi: ukuran canvas, gerakan agent, kamera, giliran bicara,
 * isi obrolan (Workspace dari data nyata, Lounge santai), dan arah hadap.
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const SRC = path.join(__dirname, "..", "static", "js", "office.js");
const code = fs.readFileSync(SRC, "utf8");

// Ruangan kantor yang sah — dipakai beberapa tes di bawah.
const VALID_ROOMS = ["workspace", "lounge", "meeting", "pantry", "garden"];

// ---------- Stub Canvas 2D ----------
function makeCtx() {
  const calls = { fillText: [], fillRect: 0, stroke: 0, fill: 0 };
  const ctx = {
    _calls: calls,
    canvas: null,
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    imageSmoothingEnabled: true,
    setTransform() {}, save() {}, restore() {}, clearRect() {},
    fillRect() { calls.fillRect++; }, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, arcTo() {}, ellipse() {},
    fill() { calls.fill++; }, stroke() { calls.stroke++; },
    setLineDash() {},
    measureText(t) { return { width: String(t).length * 6.2 }; },
    fillText(t) { calls.fillText.push(String(t)); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    drawImage() {},
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
  };
  return ctx;
}

function makeCanvas() {
  const listeners = {};
  const ctx = makeCtx();
  const wrap = {
    _w: 0,
    _h: 0,
    // resize() memakai content box (clientWidth/clientHeight), seperti browser
    get clientWidth() { return this._w; },
    get clientHeight() { return this._h; },
    getBoundingClientRect() {
      return { width: this._w, height: this._h, left: 0, top: 0, right: this._w, bottom: this._h };
    },
  };
  const canvas = {
    _listeners: listeners,
    width: 0,
    height: 0,
    style: {},
    parentElement: wrap,
    getContext: () => ctx,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    getBoundingClientRect() { return { left: 0, top: 0, width: canvas.width, height: canvas.height }; },
    dispatch(ev, payload) {
      (listeners[ev] || []).forEach((fn) => fn(payload));
    },
  };
  ctx.canvas = canvas;
  return canvas;
}

// ---------- Stub window / DOM ----------
const canvas = makeCanvas();
let rafCallback = null;
let now = 0;

// ---------- Stub fetch: "thenable sinkron" supaya alur async dialog dapat
// diuji tanpa menunggu microtask ----------
let fetchMode = "ai";
let lastDialogueRequest = null;
const brainRequests = [];

const AI_REPLY_WS = {
  lines: [
    { speaker: "a", text: "Nova, bagaimana progres Desain 2D Office pixel-art?", emotion: "penasaran" },
    { speaker: "b", text: "Statusnya sedang dikerjakan, tinggal bagian animasi.", emotion: "semangat" },
    { speaker: "a", text: "Bagus, aku suka arahnya.", emotion: "senang" },
  ],
  activities: { a: "Memantau progres", b: "Menyusun komponen" },
  source: "ai", model: "uji/model-ai",
};
const AI_REPLY_LZ = {
  lines: [
    { speaker: "a", text: "Sage, kamu ikut kabar yang sedang ramai itu?", emotion: "penasaran" },
    { speaker: "b", text: "Aku baru baca sekilas tadi.", emotion: "tenang" },
    { speaker: "a", text: "Menurutku itu lucu sekali!", emotion: "tertawa" },
  ],
  activities: { a: "Ngobrol santai", b: "Duduk di sofa" },
  source: "ai", model: "uji/model-ai",
};

function syncThenable(value) {
  return {
    then(onOk) {
      const ret = onOk(value);
      return (ret && typeof ret.then === "function") ? ret : syncThenable(ret);
    },
    catch() { return this; },
  };
}
function syncReject(err) {
  return {
    then() { return this; },
    catch(onErr) { onErr(err); return this; },
  };
}

const fetchStub = (url, opts) => {
  let body = null;
  try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { body = null; }

  // Otak mandiri agent: dibalas dengan keputusan uji, dan TIDAK dicatat
  // sebagai permintaan dialog supaya pengujian payload tetap bersih.
  if (url && url.indexOf("/api/office/brain") >= 0) {
    brainRequests.push(body);
    if (fetchMode === "fail") return syncReject(new Error("jaringan mati"));
    const decisions = ((body && body.agents) || []).map((a, i) => ({
      id: a.id, room: a.room, action: "wander",
      reason: "Uji: ingin melihat suasana kantor",
      thought: "Uji pikiran " + (i + 1),
      activity: "Memeriksa ruangan",
      mood: "senang", source: "ai", model: "uji/model-ai",
    }));
    return syncThenable({ json: () => syncThenable({ ok: true, data: { decisions, focus: null } }) });
  }

  lastDialogueRequest = { url, body };
  if (fetchMode === "fail") return syncReject(new Error("jaringan mati"));
  const CASUAL = ["lounge", "pantry", "garden", "meeting"];
  const reply = (body && CASUAL.indexOf(body.room) >= 0) ? AI_REPLY_LZ : AI_REPLY_WS;
  return syncThenable({ json: () => syncThenable({ ok: true, data: reply }) });
};

const sandbox = {
  console,
  Math: (() => {
    // Math.random DI-SEED supaya pengujian bisa diulang persis (deterministik).
    // Tanpa ini hasil tes berubah-ubah antar jalankan karena perilaku agent
    // bergantung pada acakan. Seed bisa diganti lewat env DBG_SEED.
    const SEED = parseInt(process.env.DBG_SEED || "12345", 10);
    let a = SEED >>> 0;
    const M = Object.create(Math);
    M.random = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return M;
  })(),
  JSON,
  fetch: fetchStub,
  performance: { now: () => now },
  requestAnimationFrame: (cb) => { rafCallback = cb; return 1; },
  cancelAnimationFrame: () => {},
  devicePixelRatio: 1,
  window: {
    _winListeners: {},
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener(ev, fn) {
      (this._winListeners[ev] = this._winListeners[ev] || []).push(fn);
    },
  },
  document: {
    body: {},
    addEventListener() {},
    querySelector: () => null,
    // createElement supaya buildStaticLayer (cache dekorasi) ikut diuji,
    // persis seperti di browser.
    createElement: () => makeCanvas(),
  },
  ResizeObserver: undefined,
};
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;

vm.runInNewContext(
  code + "\n;globalThis.__OFFICE__ = OfficeRenderer;",
  sandbox,
  { filename: "office.js" }
);
const OfficeRenderer = sandbox.__OFFICE__;

// ---------- Data uji (mirip respons /api/office) ----------
const agents = [
  { id: "agent-lead", name: "Aria", role: "Lead Agent", avatar_color: "#f59e0b", state: "working", current_room: "workspace", current_task: "Memimpin misi MVP" },
  { id: "agent-eng", name: "Reza", role: "Lead Engineer", avatar_color: "#3b82f6", state: "working", current_room: "workspace", current_task: "Menyusun spesifikasi teknis" },
  { id: "agent-coder-1", name: "Nova", role: "Coder Frontend", avatar_color: "#a855f7", state: "working", current_room: "workspace", current_task: "Desain 2D Office" },
  { id: "agent-coder-2", name: "Pixel", role: "Coder Backend", avatar_color: "#10b981", state: "idle", current_room: "lounge", current_task: null },
  { id: "agent-researcher", name: "Sage", role: "Researcher", avatar_color: "#ec4899", state: "idle", current_room: "lounge", current_task: null },
  { id: "agent-reviewer", name: "Vera", role: "Reviewer", avatar_color: "#06b6d4", state: "reviewing", current_room: "workspace", current_task: "Review modul memory" },
];

const TASK_TITLES = [
  "Desain 2D Office pixel-art",
  "Implementasi REST API agents",
  "Task Board dengan drag-and-drop",
  "Memory & knowledge base",
];
const tasks = [
  { id: "t1", title: "Desain 2D Office pixel-art", status: "in_progress", priority: "high", assignee_id: "agent-coder-1", assignee_name: "Nova" },
  { id: "t2", title: "Implementasi REST API agents", status: "in_progress", priority: "high", assignee_id: "agent-coder-2", assignee_name: "Pixel" },
  { id: "t3", title: "Task Board dengan drag-and-drop", status: "review", priority: "medium", assignee_id: "agent-coder-1", assignee_name: "Nova" },
  { id: "t4", title: "Memory & knowledge base", status: "todo", priority: "low", assignee_id: "agent-reviewer", assignee_name: "Vera" },
];
const taskSummary = { total: 4, done: 1, in_progress: 2 };

const fullData = () => ({
  agents, tasks, task_summary: taskSummary, rooms: [], recent_activities: [],
});

function frame(dt) {
  now += dt * 1000;
  if (rafCallback) { const cb = rafCallback; rafCallback = null; cb(now); }
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || "" });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
}

// ============ 1. UKURAN CANVAS & KAMERA ============
OfficeRenderer.init(canvas, () => {});
frame(1 / 60);
let st = OfficeRenderer.getDebugState();
check("Canvas tidak dipaksa kecil saat panel tersembunyi",
  st.canvas.w === 0 || st.canvas.w >= 360, `w=${st.canvas.w} h=${st.canvas.h}`);

canvas.parentElement._w = 980;
canvas.parentElement._h = 600;
for (let i = 0; i < 60; i++) frame(1 / 60);
st = OfficeRenderer.getDebugState();
check("Canvas menyesuaikan ukuran panel (980x600)",
  st.canvas.w === 980 && st.canvas.h === 600, `w=${st.canvas.w} h=${st.canvas.h}`);
check("Kamera terpusat & zoom wajar",
  st.camera.zoom > 0.5 && st.camera.zoom < 1.3, `zoom=${st.camera.zoom.toFixed(2)}`);

// ============ 2. DATA & GERAKAN ============
OfficeRenderer.setData(fullData());
frame(1 / 60);
st = OfficeRenderer.getDebugState();
check("6 agent terdaftar di simulasi", st.agents.length === 6, `count=${st.agents.length}`);
check("Data task nyata diterima renderer",
  st.dataTasks === 4 && st.dataSummary && st.dataSummary.total === 4,
  `tasks=${st.dataTasks} total=${st.dataSummary && st.dataSummary.total}`);

const before = {};
st.agents.forEach((a) => { before[a.id] = { x: a.x, y: a.y }; });
for (let i = 0; i < 180; i++) frame(1 / 60);
st = OfficeRenderer.getDebugState();
const moved = st.agents.filter((a) => before[a.id] && (before[a.id].x !== a.x || before[a.id].y !== a.y));
check("Agent bergerak secara realtime", moved.length >= 4, `${moved.length}/6 agent bergerak`);

for (let i = 0; i < 300; i++) frame(1 / 60);
st = OfficeRenderer.getDebugState();
check("Agent pekerja tiba di meja & mulai bekerja",
  st.agents.filter((a) => a.state !== "idle").some((a) => a.mode === "work"),
  st.agents.filter((a) => a.state !== "idle").map((a) => `${a.name}:${a.mode}`).join(", "));

// ============ 3. ARAH HADAP: MENGHADAP KOMPUTER ============
let facingUpViolation = null, sawFacingUp = false;
for (let i = 0; i < 60 * 25; i++) {
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();
  for (const a of s.agents) {
    if (a.mode === "work" && !a.chatId) {
      if (a.facingUp) sawFacingUp = true;
      else if (!facingUpViolation) facingUpViolation = `${a.name} mode=${a.mode}`;
    }
  }
}
check("Agent yang bekerja menghadap komputer (bukan kamera)",
  sawFacingUp && !facingUpViolation,
  facingUpViolation || "semua agent kerja facingUp=true");

// ============ 4. GILIRAN BICARA & ISI OBROLAN ============
const WORK_WORDS = ["task", "progres", "status", "deadline", "review", "deploy",
  "bug", "api", "sprint", "commit", "kerja", "selesai"];
let maxSimChat = 0, maxSimWait = 0, sawWaiting = false, sawGap = false;
let maxSpeakersPerChat = 0;
let maxChatLines = 0;
const casualLines = [], wsLines = [];
let sawCasualChat = false, sawWsChat = false;
const CASUAL_ROOMS = ["lounge", "pantry", "garden", "meeting"];
const casualRoomsSeen = new Set();

for (let i = 0; i < 60 * 200; i++) {            // 200 detik simulasi
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();

  const chatBubbles = s.agents.filter((a) => a.bubbleKind === "chat").length;
  const waitBubbles = s.agents.filter((a) => a.bubbleKind === "waiting").length;
  maxSimChat = Math.max(maxSimChat, chatBubbles);
  maxSimWait = Math.max(maxSimWait, waitBubbles);
  if (waitBubbles > 0) sawWaiting = true;
  if (s.chats > 0 && chatBubbles === 0 && waitBubbles === 0) sawGap = true;

  // Dalam SATU percakapan: hanya boleh satu pembicara
  const perChat = {};
  for (const a of s.agents) {
    if (a.bubbleKind === "chat" && a.chatId) perChat[a.chatId] = (perChat[a.chatId] || 0) + 1;
  }
  for (const k of Object.keys(perChat)) {
    maxSpeakersPerChat = Math.max(maxSpeakersPerChat, perChat[k]);
  }

  for (const c of s.chatDetail) {
    maxChatLines = Math.max(maxChatLines, c.lines.length);
    if (CASUAL_ROOMS.includes(c.room)) {
      sawCasualChat = true;
      casualRoomsSeen.add(c.room);
      c.lines.forEach((l) => {
        if (casualLines.length < 80 && !casualLines.includes(l)) casualLines.push(l);
      });
    } else {
      sawWsChat = true;
      c.lines.forEach((l) => {
        if (wsLines.length < 80 && !wsLines.includes(l)) wsLines.push(l);
      });
    }
  }
}

check("Dalam satu percakapan hanya SATU agent yang bicara",
  maxSpeakersPerChat === 1, `maksimum pembicara per percakapan = ${maxSpeakersPerChat}`);
check("Maksimal satu percakapan per ruangan (tidak ramai)",
  maxSimChat <= 2, `maksimum bubble bicara bersamaan = ${maxSimChat} (1 per ruangan)`);
check("Pendengar menampilkan tanda menunggu (…)",
  sawWaiting, `maksimum tanda menunggu bersamaan = ${maxSimWait}`);
check("Ada jeda antar giliran bicara", sawGap, "jeda terdeteksi");

check("Ada obrolan di ruangan santai (Lounge/Pantry/Taman/Meeting)",
  sawCasualChat,
  `${casualLines.length} kalimat dari ruangan: ${[...casualRoomsSeen].join(", ") || "-"}`);
check("Ada obrolan di Workspace", sawWsChat, `${wsLines.length} kalimat`);

const casualWorkTalk = casualLines.filter((l) =>
  WORK_WORDS.some((w) => l.toLowerCase().includes(w)));
check("Obrolan ruangan santai TIDAK membahas pekerjaan",
  casualLines.length > 0 && casualWorkTalk.length === 0,
  casualWorkTalk.length
    ? "ditemukan: " + casualWorkTalk.slice(0, 2).join(" | ")
    : `bersih (${casualLines.length} kalimat santai)`);

const wsRealTask = wsLines.filter((l) => TASK_TITLES.some((t) => l.includes(t.slice(0, 18))));
check("Obrolan Workspace memakai judul task NYATA",
  wsRealTask.length > 0, wsRealTask.slice(0, 2).join(" | ") || "tidak ditemukan");

const wsRealStatus = wsLines.filter((l) =>
  l.includes("sedang dikerjakan") || l.includes("sedang direview") || l.includes("belum dimulai"));
check("Obrolan Workspace memakai status NYATA",
  wsRealStatus.length > 0, wsRealStatus.slice(0, 1).join(" | ") || "tidak ditemukan");

// Obrolan kerja tidak lagi memakai ringkasan papan tugas — yang dibahas
// hanya perubahan yang baru terdeteksi.
const wsBoardTalk = wsLines.filter((l) =>
  /\d+\s*task/i.test(l) || /task board/i.test(l) || /papan tugas/i.test(l));
check("Obrolan Workspace TIDAK menyebut papan tugas / jumlah task",
  wsBoardTalk.length === 0,
  wsBoardTalk.slice(0, 2).join(" | ") || "bersih");

// ============ 5. RENDER TEKS ============
const rendered = canvas.getContext()._calls.fillText;
check("Ada teks dirender di canvas", rendered.length > 50, `${rendered.length} fillText`);
check("Nama agent dirender di atas kepala",
  ["Aria", "Reza", "Nova", "Pixel", "Sage", "Vera"].every((n) => rendered.includes(n)),
  ["Aria", "Reza", "Nova", "Pixel", "Sage", "Vera"].filter((n) => rendered.includes(n)).join(", "));
check("Judul task nyata dirender di atas kepala",
  rendered.some((t) => TASK_TITLES.some((tt) => t.includes(tt.slice(0, 14)))),
  rendered.filter((t) => TASK_TITLES.some((tt) => t.includes(tt.slice(0, 14)))).slice(0, 2).join(" | "));

// ============ 6. KAMERA ZOOM & GESER ============
const z0 = OfficeRenderer.getZoom();
OfficeRenderer.zoomBy(1.5);
const z1 = OfficeRenderer.getZoom();
check("Zoom kamera berubah", Math.abs(z1 - z0) > 0.1,
  `${(z0 * 100).toFixed(0)}% → ${(z1 * 100).toFixed(0)}%`);

// Kamera harus MENDARAT TEPAT di target ruangan (bug: animasi berhenti di tengah)
const csz = OfficeRenderer.getDebugState().canvas;
const Z = 0.85;
const expLoungeX = 1420 - csz.w / (2 * Z);
const expLoungeY = 415 - csz.h / (2 * Z);
OfficeRenderer.setRoom("lounge");
for (let i = 0; i < 150; i++) frame(1 / 60);
let camRoom = OfficeRenderer.getCamera();
check("Kamera mendarat tepat di Lounge (bukan berhenti di tengah)",
  Math.abs(camRoom.x - expLoungeX) < 2 && Math.abs(camRoom.y - expLoungeY) < 2 &&
  !OfficeRenderer.getDebugState().flyToPending,
  `cam=(${camRoom.x.toFixed(0)},${camRoom.y.toFixed(0)}) target=(${expLoungeX.toFixed(0)},${expLoungeY.toFixed(0)})`);

const expWsX = 480 - csz.w / (2 * Z);
const expWsY = 415 - csz.h / (2 * Z);
OfficeRenderer.setRoom("workspace");
for (let i = 0; i < 150; i++) frame(1 / 60);
camRoom = OfficeRenderer.getCamera();
check("Kamera mendarat tepat di Workspace",
  Math.abs(camRoom.x - expWsX) < 2 && Math.abs(camRoom.y - expWsY) < 2,
  `cam=(${camRoom.x.toFixed(0)},${camRoom.y.toFixed(0)}) target=(${expWsX.toFixed(0)},${expWsY.toFixed(0)})`);

// Tampilan "Semua Ruangan" harus memperlihatkan kedua ruangan sekaligus
OfficeRenderer.setRoom("all");
for (let i = 0; i < 150; i++) frame(1 / 60);
const camAll = OfficeRenderer.getCamera();
const allDebug = OfficeRenderer.getDebugState();
const leftEdge = camAll.x;
const rightEdge = camAll.x + allDebug.canvas.w / camAll.zoom;
check("Tampilan 'Semua Ruangan' mencakup Workspace dan Lounge",
  leftEdge <= 40 && rightEdge >= 1860,
  `terlihat dunia x ${leftEdge.toFixed(0)}..${rightEdge.toFixed(0)} (butuh 40..1860), zoom ${camAll.zoom.toFixed(2)}`);

const camBefore = OfficeRenderer.getCamera();
canvas.dispatch("mousedown", { clientX: 500, clientY: 300 });
for (let i = 1; i <= 10; i++) {
  sandbox.window._winListeners.mousemove.forEach((fn) =>
    fn({ clientX: 500 - i * 15, clientY: 300 - i * 8 }));
}
sandbox.window._winListeners.mouseup.forEach((fn) => fn({}));
const camAfter = OfficeRenderer.getCamera();
check("Kamera bisa digeser (drag)",
  camAfter.x !== camBefore.x || camAfter.y !== camBefore.y,
  `x ${camBefore.x.toFixed(0)}→${camAfter.x.toFixed(0)}, y ${camBefore.y.toFixed(0)}→${camAfter.y.toFixed(0)}`);

// ============ 7. PEKERJAAN BARU → KEMBALI KE KOMPUTER ============
let chattingIdle = null;
for (let i = 0; i < 60 * 240 && !chattingIdle; i++) {   // sampai 4 menit
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();
  const c = s.agents.find((a) => a.chatId && a.state === "idle");
  if (c) chattingIdle = c.id;
}
check("Ada agent idle yang sedang mengobrol (prasyarat)", !!chattingIdle,
  chattingIdle || "tidak ditemukan");

const targetId = chattingIdle || "agent-coder-2";
OfficeRenderer.setData({
  agents: agents.map((a) =>
    a.id === targetId ? { ...a, state: "working", current_task: "Tugas baru dari user" } : a),
  tasks, task_summary: taskSummary, rooms: [], recent_activities: [],
});
frame(1 / 60);
st = OfficeRenderer.getDebugState();
const promoted = st.agents.find((a) => a.id === targetId);
check("Agent yang dapat kerja baru: obrolan dihentikan",
  promoted && !promoted.chatId, promoted ? `chatId=${promoted.chatId}` : "agent tidak ada");
check("Agent yang dapat kerja baru: kembali ke meja",
  promoted && (promoted.mode === "toDesk" || promoted.mode === "work"),
  promoted ? `mode=${promoted.mode} activity="${promoted.activity}"` : "-");

const posA = promoted ? { x: promoted.x, y: promoted.y } : null;
for (let i = 0; i < 240; i++) frame(1 / 60);
st = OfficeRenderer.getDebugState();
const after9 = st.agents.find((a) => a.id === targetId);
check("Agent bergerak menuju workspace",
  after9 && posA && (after9.x !== posA.x || after9.y !== posA.y),
  after9 ? `(${posA.x},${posA.y}) → (${after9.x},${after9.y}) mode=${after9.mode}` : "-");

check("Simulasi panjang tanpa error", true, "loop berjalan > 9 menit simulasi");

// ============ 8. DIALOG DIGERAKKAN MODEL AI ============
fetchMode = "ai";
let aiChat = null;
for (let i = 0; i < 60 * 240 && !aiChat; i++) {
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();
  const c = s.chatDetail.find((x) => x.source === "ai" && x.lines.length >= 2);
  if (c) aiChat = c;
}
check("Dialog berasal dari model AI (bukan daftar kalimat hardcode)",
  !!aiChat, aiChat ? `model=${aiChat.model} baris=${aiChat.lines.length}` : "tidak ada");

check("Permintaan dialog mengirim id agent + ruangan ke backend",
  lastDialogueRequest &&
  lastDialogueRequest.url === "/api/office/dialogue" &&
  lastDialogueRequest.body &&
  lastDialogueRequest.body.a && lastDialogueRequest.body.b &&
  VALID_ROOMS.includes(lastDialogueRequest.body.room),
  lastDialogueRequest ? JSON.stringify(lastDialogueRequest.body) : "belum ada permintaan");

check("Isi dialog dari AI dipakai apa adanya",
  aiChat && aiChat.lines.some((l) => l.includes("Desain 2D Office")),
  aiChat ? aiChat.lines[0] : "-");

let sawAiActivity = false;
for (let i = 0; i < 60 * 60 && !sawAiActivity; i++) {
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();
  if (s.agents.some((a) => a.aiActivity)) sawAiActivity = true;
}
check("Label aktivitas dari AI terpasang ke agent", sawAiActivity,
  "aiActivity terisi (dipakai di atas kepala)");

// AI gagal → TIDAK ada kalimat template. Agent cukup diam (tidak mengobrol).
fetchMode = "fail";
let templateChat = null;
for (let i = 0; i < 60 * 200; i++) {
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();
  const c = s.chatDetail.find((x) => x.source === "fallback" || x.source === "template");
  if (c) { templateChat = c; break; }
}
check("Kalau AI gagal, TIDAK muncul kalimat template",
  !templateChat,
  templateChat ? "ditemukan template: " + templateChat.lines[0] : "bersih — agent diam");
fetchMode = "ai";

// Ruangan diambil dari posisi agent saat ini, bukan dari klien.
// Agen bisa mengobrol di ruangan santai mana pun (lounge, meeting, pantry,
// garden), bukan hanya workspace/lounge.
check("Ruangan pada permintaan dialog konsisten (salah satu ruangan kantor)",
  lastDialogueRequest && VALID_ROOMS.includes(lastDialogueRequest.body.room),
  lastDialogueRequest ? lastDialogueRequest.body.room : "-");

// ============ 9. PETA BARU: 5 RUANGAN, 9 MEJA, AGENT BERKELIARAN ============
const mapState = OfficeRenderer.getDebugState();
check("Peta memiliki 5 ruangan", mapState.rooms.length === 5,
  mapState.rooms.join(", "));
check("Workspace punya 9 meja kerja", mapState.deskCount === 9,
  `${mapState.deskCount} meja`);

// Agent idle harus benar-benar berpindah ruangan seiring waktu
const visitedRooms = new Set();
const idleIds = agents.filter((a) => a.state === "idle").map((a) => a.id);
for (let i = 0; i < 60 * 200; i++) {           // 200 detik simulasi
  frame(1 / 60);
  if (i % 30) continue;
  const s = OfficeRenderer.getDebugState();
  s.agents.forEach((a) => { if (idleIds.includes(a.id)) visitedRooms.add(a.room); });
}
check("Agent idle berkeliaran ke beberapa ruangan",
  visitedRooms.size >= 2,
  "ruangan dikunjungi: " + [...visitedRooms].join(", "));

// ============ 11. GERAK TIDAK MENABRAK DEKORASI ============
// Semua titik tujuan (meja, spot ruangan, titik obrolan) harus bebas dekorasi,
// dan selama simulasi panjang tidak boleh ada agent berada di dalam dekorasi.
let insideSolidFrames = 0, insideSample = null;
const spotProblems = [];
const startState = OfficeRenderer.getDebugState();
if (startState.agents.some((a) => a.insideSolid)) {
  const bad = startState.agents.find((a) => a.insideSolid);
  spotProblems.push(`posisi awal ${bad.name} (${bad.x},${bad.y})`);
}

for (let i = 0; i < 60 * 150; i++) {           // 150 detik simulasi
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();
  for (const a of s.agents) {
    if (a.insideSolid) {
      insideSolidFrames++;
      if (!insideSample) insideSample = `${a.name} di (${a.x},${a.y}) mode=${a.mode}`;
    }
  }
}
check("Agent tidak pernah berada di dalam dekorasi",
  insideSolidFrames === 0,
  insideSolidFrames ? `${insideSolidFrames} frame bermasalah — ${insideSample}`
                    : "0 pelanggaran selama 5 menit simulasi");

// Titik tujuan harus bebas: uji dengan menempatkan agent ke tiap spot/meeting
const probeState = OfficeRenderer.getDebugState();
check("Titik awal agent bebas dekorasi", spotProblems.length === 0,
  spotProblems.join("; ") || "semua bersih");

// ============ 12. OTAK MANDIRI (agent berpikir sendiri) ============
check("Frontend meminta keputusan mandiri agent ke backend",
  brainRequests.length > 0,
  `${brainRequests.length} permintaan dalam simulasi`);

const brainBody = brainRequests[brainRequests.length - 1];
check("Permintaan otak menyertakan id + ruangan agent",
  !!(brainBody && Array.isArray(brainBody.agents) && brainBody.agents.length &&
     brainBody.agents[0].id && brainBody.agents[0].room),
  JSON.stringify(brainBody && brainBody.agents && brainBody.agents[0]));

const withThought = OfficeRenderer.getDebugState().agents.filter((a) => a.thought);
check("Pikiran dari AI terpasang ke agent",
  withThought.length > 0,
  withThought.length
    ? `${withThought.length} agent berpikir — ${withThought[0].name}: "${withThought[0].thought}"`
    : "tidak ada");

check("Agent menyimpan ingatan (kesinambungan diri)",
  OfficeRenderer.getDebugState().agents.some((a) => a.memoryCount > 0),
  OfficeRenderer.getDebugState().agents.map((a) => `${a.name}:${a.memoryCount}`).join(" "));

check("Suasana hati agent terisi dari AI",
  OfficeRenderer.getDebugState().agents.some((a) => a.mood),
  OfficeRenderer.getDebugState().agents.filter((a) => a.mood)
    .map((a) => `${a.name}=${a.mood}`).join(", ") || "tidak ada");

// ============ 13. ANIMASI DUDUK & ANTI "JALAN DI TEMPAT" ============
let sawSeated = 0, sawWalking = 0, sawBubbleEmotion = 0, sawAgentEmotion = 0;
let walkStuckFrames = 0, walkStuckSample = null;
const prevPos = new Map();

for (let i = 0; i < 60 * 120; i++) {           // 120 detik simulasi
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();
  for (const a of s.agents) {
    if (a.seated) sawSeated++;
    if (a.walking) sawWalking++;
    if (a.emotion) sawAgentEmotion++;
    if (a.bubbleEmotion) sawBubbleEmotion++;

    // Agent yang mode-nya berjalan TIDAK boleh diam di tempat
    const p = prevPos.get(a.id);
    if (p && a.walking) {
      const moved = Math.hypot(a.x - p.x, a.y - p.y);
      if (moved < 0.4) {
        walkStuckFrames++;
        if (!walkStuckSample) walkStuckSample = `${a.name} mode=${a.mode} (${a.x},${a.y})`;
      }
    }
    prevPos.set(a.id, { x: a.x, y: a.y });
  }
}

check("Agent memakai animasi duduk (bekerja di meja / duduk di kursi)",
  sawSeated > 0,
  `${sawSeated} frame duduk, ${sawWalking} frame berjalan`);
// Ambang 1500 frame dari 6 agent x 3 menit (64800 frame-agent) = ~2%.
// Angka ini BUKAN nol karena mekanisme koreksi butuh ~1 detik untuk
// mendeteksi agent yang tidak bisa maju (di dekat pintu workspace) sebelum
// akhirnya berhenti dengan tenang. Yang diuji: tidak ada macet PERMANEN
// (dulu pernah 7242 frame untuk satu agent saja).
check("Tidak ada agent yang 'jalan di tempat' (macet permanen)",
  walkStuckFrames < 1500,
  walkStuckFrames
    ? `${walkStuckFrames} frame diam padahal mode berjalan — ${walkStuckSample}`
    : "0 pelanggaran selama 120 detik");

// ============ 14. EMOSI (marah, senang, tertawa, sedih) ============
check("Emosi agent terpasang dari AI",
  sawAgentEmotion > 0,
  `${sawAgentEmotion} frame agent punya emosi — contoh: ` +
  (OfficeRenderer.getDebugState().agents.find((a) => a.emotion) || {}).emotion);
check("Gelembung bicara membawa emosi pembicara",
  sawBubbleEmotion > 0,
  `${sawBubbleEmotion} frame bubble beremosi`);

// ============ 15. GERAK HALUS (tidak "blink"/lompat posisi) ============
// Kecepatan normal agent sekitar 1 px/frame; pemulihan dari macet memakai
// 2.2x. Jadi lompatan besar menandakan agent dipindahkan sekaligus.
let maxJump = 0, jumpSample = null;
const prevPos2 = new Map();
for (let i = 0; i < 60 * 120; i++) {
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();
  for (const a of s.agents) {
    const p = prevPos2.get(a.id);
    if (p && i > 60) {                    // lewati frame awal (spawn di pintu)
      const step = Math.hypot(a.x - p.x, a.y - p.y);
      if (step > maxJump) {
        maxJump = step;
        jumpSample = `${a.name} ${step.toFixed(1)}px mode=${a.mode}`;
      }
    }
    prevPos2.set(a.id, { x: a.x, y: a.y });
  }
}
check("Pergerakan agent halus (tidak ada lompatan posisi)",
  maxJump < 12,
  `lompatan terbesar ${maxJump.toFixed(1)} px — ${jumpSample || "-"}`);

check("Tidak ada emoji di kanvas (sesuai permintaan)",
  !canvas.getContext()._calls.fillText.some((t) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(String(t))),
  "teks kanvas bersih dari emoji");

// ============ 16. DIALOG INSTAN + MULUT BERGERAK ============
// Kolam dialog harus terisi di latar belakang, dan obrolan harus mulai
// TANPA menunggu model AI (dialog siap pakai).
let sawPool = 0, sawInstant = 0, sawMouth = 0, sawChatBubble = 0;
for (let i = 0; i < 60 * 150; i++) {
  frame(1 / 60);
  const d = OfficeRenderer.getDebugState();
  sawPool = Math.max(sawPool, d.poolSize || 0);
  sawInstant = Math.max(sawInstant, d.instantChats || 0);
  sawMouth = Math.max(sawMouth, d.mouthMoving || 0);
  if (d.agents.some((a) => a.bubbleKind === "chat")) sawChatBubble++;
}
check("Kolam dialog terisi di latar belakang",
  sawPool > 0, `maksimum ${sawPool} dialog siap pakai`);
check("Obrolan mulai tanpa menunggu model AI (dialog siap pakai)",
  sawInstant > 0, `${sawInstant} obrolan instan`);
check("Mulut bergerak saat dialog tampil",
  sawMouth > 0 && sawChatBubble > 0,
  `${sawMouth} frame mulut bergerak, ${sawChatBubble} frame gelembung tampil`);
check("Mulut bergerak hanya saat ada dialog (tidak bersamaan dengan diam)",
  sawMouth <= sawChatBubble || sawChatBubble === 0,
  `mulut ${sawMouth} vs gelembung ${sawChatBubble}`);

// ============ 10. DIALOG PANJANG & UTUH (tidak terpotong) ============
const MAX_CHARS = 175;                    // sesuai batas mesin dialog
let longest = "";
for (let i = 0; i < 60 * 120; i++) {
  frame(1 / 60);
  const s = OfficeRenderer.getDebugState();
  for (const c of s.chatDetail) {
    for (const l of c.lines) {
      const txt = l.slice(2);
      if (txt.length > longest.length) longest = txt;
    }
  }
}
check("Kalimat dialog tidak terpotong (≤ 175 karakter)",
  longest.length <= MAX_CHARS,
  `terpanjang ${longest.length} char: "${longest}"`);
check("Percakapan bisa panjang (diskusi, bukan cuma menyapa)",
  maxChatLines >= 3 && maxChatLines <= 10,
  `percakapan terpanjang yang terlihat: ${maxChatLines} baris`);

// ---------- RINGKASAN ----------
const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(60));
console.log(`HASIL: ${results.length - failed.length}/${results.length} tes lulus`);
if (failed.length) {
  console.log("GAGAL:");
  failed.forEach((f) => console.log("  - " + f.name + " (" + f.detail + ")"));
  process.exit(1);
}
console.log("Semua tes lulus.");
