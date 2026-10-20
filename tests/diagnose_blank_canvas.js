/**
 * DIAGNOSTIK: cari penyebab canvas blank di browser.
 *
 * Stub ini MENIRU perilaku browser:
 *  - melempar IndexSizeError untuk radius negatif / NaN (arc, arcTo, ellipse,
 *    createRadialGradient)
 *  - melempar untuk setLineDash bernilai negatif
 *  - MENCATAT setiap koordinat NaN/Infinity (di browser tidak melempar,
 *    tapi gambar tidak akan muncul = canvas blank)
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const SRC = path.join(__dirname, "..", "static", "js", "office.js");
const code = fs.readFileSync(SRC, "utf8");

const bad = { nanCoords: [], negRadius: [], badDash: [], badSize: [] };
let callStack = "(luar)";

function finite(...vals) {
  return vals.every((v) => typeof v === "number" && Number.isFinite(v));
}
function track(tag, ...vals) {
  if (!finite(...vals) && bad.nanCoords.length < 25) {
    bad.nanCoords.push(`${tag}(${vals.join(", ")}) @ ${callStack}`);
  }
}
function radius(tag, ...vals) {
  for (const v of vals) {
    if (typeof v !== "number" || Number.isNaN(v) || v < 0) {
      const msg = `${tag} radius=${v} @ ${callStack}`;
      bad.negRadius.push(msg);
      throw new Error("IndexSizeError: " + msg);
    }
  }
}

function makeCtx() {
  const ctx = {
    canvas: null,
    globalAlpha: 1, font: "", textAlign: "left",
    fillStyle: "", strokeStyle: "", lineWidth: 1,
    imageSmoothingEnabled: true,
    setTransform(a, b, c, d, e, f) { track("setTransform", a, b, c, d, e, f); },
    save() {}, restore() {},
    clearRect(x, y, w, h) { track("clearRect", x, y, w, h); },
    fillRect(x, y, w, h) { track("fillRect", x, y, w, h); },
    strokeRect(x, y, w, h) { track("strokeRect", x, y, w, h); },
    beginPath() {}, closePath() {},
    moveTo(x, y) { track("moveTo", x, y); },
    lineTo(x, y) { track("lineTo", x, y); },
    arc(x, y, r, s, e) { track("arc", x, y); radius("arc", r); },
    arcTo(x1, y1, x2, y2, r) { track("arcTo", x1, y1, x2, y2); radius("arcTo", r); },
    ellipse(x, y, rx, ry) { track("ellipse", x, y); radius("ellipse", rx, ry); },
    fill() {}, stroke() {},
    setLineDash(a) {
      if (a.some((v) => v < 0 || !Number.isFinite(v))) {
        bad.badDash.push(JSON.stringify(a));
        throw new Error("IndexSizeError: setLineDash " + JSON.stringify(a));
      }
    },
    measureText(t) { return { width: String(t).length * 6.2 }; },
    fillText(t, x, y) { track("fillText", x, y); },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      track("createRadialGradient", x0, y0, x1, y1);
      radius("createRadialGradient", r0, r1);
      return { addColorStop() {} };
    },
    getImageData() { return { data: new Uint8ClampedArray(4) }; },
  };
  return ctx;
}

function makeCanvas() {
  const listeners = {};
  const ctx = makeCtx();
  const wrap = {
    _w: 0, _h: 0,
    get clientWidth() { return this._w; },
    get clientHeight() { return this._h; },
    getBoundingClientRect() {
      return { width: this._w, height: this._h, left: 0, top: 0, right: this._w, bottom: this._h };
    },
  };
  const canvas = {
    width: 0, height: 0, style: {}, parentElement: wrap,
    getContext: () => ctx,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    getBoundingClientRect() { return { left: 0, top: 0, width: canvas.width, height: canvas.height }; },
    dispatch(ev, p) { (listeners[ev] || []).forEach((fn) => fn(p)); },
  };
  ctx.canvas = canvas;
  return canvas;
}

const canvas = makeCanvas();
let rafCallback = null, now = 0;
const sandbox = {
  console, Math, JSON,
  performance: { now: () => now },
  requestAnimationFrame: (cb) => { rafCallback = cb; return 1; },
  cancelAnimationFrame: () => {},
  devicePixelRatio: 1,
  window: {
    _wl: {}, devicePixelRatio: 1, innerWidth: 1366, innerHeight: 768,
    addEventListener(ev, fn) { (this._wl[ev] = this._wl[ev] || []).push(fn); },
  },
  document: { body: {}, addEventListener() {}, querySelector: () => null },
  ResizeObserver: undefined,
};
sandbox.globalThis = sandbox;

vm.runInNewContext(code + "\n;globalThis.__O__ = OfficeRenderer;", sandbox, { filename: "office.js" });
const O = sandbox.__O__;

const agents = [
  { id: "agent-lead", name: "Aria", role: "Lead Agent", avatar_color: "#f59e0b", state: "working", current_task: "Memimpin misi MVP" },
  { id: "agent-eng", name: "Reza", role: "Lead Engineer", avatar_color: "#3b82f6", state: "working", current_task: "Menyusun spesifikasi" },
  { id: "agent-coder-1", name: "Nova", role: "Coder Frontend", avatar_color: "#a855f7", state: "working", current_task: "Desain 2D Office" },
  { id: "agent-coder-2", name: "Pixel", role: "Coder Backend", avatar_color: "#10b981", state: "idle", current_task: null },
  { id: "agent-researcher", name: "Sage", role: "Researcher", avatar_color: "#ec4899", state: "idle", current_task: null },
  { id: "agent-reviewer", name: "Vera", role: "Reviewer", avatar_color: "#06b6d4", state: "reviewing", current_task: "Review modul memory" },
];
const tasks = [
  { id: "t1", title: "Desain 2D Office pixel-art", status: "in_progress", assignee_id: "agent-coder-1", assignee_name: "Nova" },
  { id: "t2", title: "Implementasi REST API agents", status: "in_progress", assignee_id: "agent-coder-2", assignee_name: "Pixel" },
];
const data = { agents, tasks, task_summary: { total: 8, done: 1, in_progress: 2 }, rooms: [], recent_activities: [] };

function frame(dt) {
  now += dt * 1000;
  if (rafCallback) { const cb = rafCallback; rafCallback = null; cb(now); }
}

// ---- Alur persis seperti app.js ----
console.log("1) init saat panel tersembunyi (seperti DOMContentLoaded)");
O.init(canvas, () => {});
frame(1 / 60);
console.log("   canvas bitmap:", canvas.width + "x" + canvas.height);

console.log("2) panel ditampilkan 792x600 (layar 1366x768), app.js memanggil resize()");
canvas.parentElement._w = 792;
canvas.parentElement._h = 600;
O.resize();
console.log("   canvas bitmap:", canvas.width + "x" + canvas.height, "| style:", canvas.style.width, canvas.style.height);

console.log("3) setData + 60 detik simulasi (termasuk obrolan)");
O.setData(data);
let err = null;
try {
  for (let i = 0; i < 60 * 60; i++) frame(1 / 60);
} catch (e) {
  err = e;
}

const st = O.getDebugState();
console.log("\n--- HASIL ---");
console.log("error saat render   :", err ? err.message : "tidak ada");
console.log("koordinat NaN       :", bad.nanCoords.length);
bad.nanCoords.slice(0, 12).forEach((s) => console.log("   !", s));
console.log("radius negatif/NaN  :", bad.negRadius.length);
bad.negRadius.slice(0, 8).forEach((s) => console.log("   !", s));
console.log("setLineDash invalid :", bad.badDash.length);
console.log("camera              :", JSON.stringify(st.camera));
console.log("ukuran render (W,H) :", st.canvas.w + "x" + st.canvas.h);
console.log("jumlah chat aktif   :", st.chats);
console.log("jumlah agent        :", st.agents.length);

const ok = !err && bad.nanCoords.length === 0 && bad.negRadius.length === 0 && bad.badDash.length === 0;
console.log("\nVERDICT:", ok ? "Tidak ada masalah terdeteksi di jalur ini" : "DITEMUKAN MASALAH");
process.exit(ok ? 0 : 1);
