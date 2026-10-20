/**
 * DIAGNOSTIK "JALAN DI TEMPAT"
 * Menghitung berapa frame agent berada dalam mode berjalan tetapi posisinya
 * tidak berpindah — inilah gejala yang dikeluhkan pengguna.
 */
const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync(__dirname + "/../static/js/office.js", "utf8");

function mkCtx() {
  return { canvas: null, globalAlpha: 1, font: "", textAlign: "left", fillStyle: "",
    strokeStyle: "", lineWidth: 1, setTransform() {}, save() {}, restore() {},
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {}, fill() {}, stroke() {},
    setLineDash() {}, measureText: (t) => ({ width: String(t).length * 6 }), fillText() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }) };
}
function syncThenable(v) {
  return { then(f) { const r = f(v); return (r && typeof r.then === "function") ? r : syncThenable(r); }, catch() { return this; } };
}
const ctx = mkCtx();
const wrap = { _w: 0, _h: 0, get clientWidth() { return this._w; }, get clientHeight() { return this._h; },
  getBoundingClientRect() { return { width: this._w, height: this._h, left: 0, top: 0 }; } };
const canvas = { width: 0, height: 0, style: {}, parentElement: wrap, getContext: () => ctx,
  addEventListener() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; } };
ctx.canvas = canvas;

let raf = null, now = 0;
const sandbox = { console, Math, JSON,
  fetch: () => syncThenable({ json: () => syncThenable({ data: { lines: [], source: "none" } }) }),
  performance: { now: () => now }, requestAnimationFrame: (cb) => { raf = cb; return 1; },
  cancelAnimationFrame() {}, devicePixelRatio: 1, window: { addEventListener() {} },
  document: { body: {}, addEventListener() {}, querySelector: () => null }, ResizeObserver: undefined };
sandbox.globalThis = sandbox;
vm.runInNewContext(code + "\n;globalThis.__O__ = OfficeRenderer;", sandbox, { filename: "office.js" });
const O = sandbox.__O__;
O.init(canvas, () => {});
wrap._w = 980; wrap._h = 600; O.resize();

const agents = [
  { id: "agent-lead", name: "Aria", role: "Lead", avatar_color: "#f59e0b", state: "working", current_task: "A" },
  { id: "agent-eng", name: "Reza", role: "Eng", avatar_color: "#3b82f6", state: "working", current_task: "B" },
  { id: "agent-coder-1", name: "Nova", role: "FE", avatar_color: "#a855f7", state: "working", current_task: "C" },
  { id: "agent-coder-2", name: "Pixel", role: "BE", avatar_color: "#10b981", state: "idle", current_task: null },
  { id: "agent-researcher", name: "Sage", role: "Res", avatar_color: "#ec4899", state: "idle", current_task: null },
  { id: "agent-reviewer", name: "Vera", role: "Rev", avatar_color: "#06b6d4", state: "reviewing", current_task: "D" },
];
O.setData({ agents, rooms: [], recent_activities: [] });

function frame(dt) { now += dt * 1000; if (raf) { const cb = raf; raf = null; cb(now); } }

let stuckFrames = 0, insideSolidFrames = 0, maxJump = 0;
let stuckSample = null, solidSample = null;
const prev = new Map();
for (let i = 0; i < 60 * 180; i++) {
  frame(1 / 60);
  const s = O.getDebugState();
  for (const a of s.agents) {
    if (a.insideSolid) {
      insideSolidFrames++;
      if (!solidSample) solidSample = `${a.name} (${a.x},${a.y}) mode=${a.mode}`;
    }
    const p = prev.get(a.id);
    if (p && i > 60) {
      const step = Math.hypot(a.x - p.x, a.y - p.y);
      if (step > maxJump) maxJump = step;
      if (a.walking && step < 0.4) {
        stuckFrames++;
        if (!stuckSample) stuckSample = `${a.name} mode=${a.mode} (${a.x},${a.y})`;
      }
    }
    prev.set(a.id, { x: a.x, y: a.y });
  }
}
console.log("=== DIAGNOSTIK GERAK (3 menit, 60 fps, 6 agent) ===");
console.log(`  Frame "jalan di tempat"   : ${stuckFrames}  ${stuckSample ? "contoh: " + stuckSample : ""}`);
console.log(`  Frame di dalam dekorasi   : ${insideSolidFrames}  ${solidSample ? "contoh: " + solidSample : ""}`);
console.log(`  Lompatan terbesar         : ${maxJump.toFixed(2)} px`);
console.log("");
console.log("  Ambang lulus tes: jalan-di-tempat < 180 frame, dekorasi = 0, lompatan < 12 px");
