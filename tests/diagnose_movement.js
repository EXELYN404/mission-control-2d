/**
 * DIAGNOSTIK KESTABILAN GERAK
 * Mengukur: langkah per frame, lompatan, pembalikan arah, dan waktu tenang.
 * Tujuan: memastikan gerak agent stabil (tidak "blink"/tidak cepat tak beraturan).
 */
const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync(__dirname + "/../static/js/office.js", "utf8");

function mkCtx() {
  return {
    canvas: null, globalAlpha: 1, font: "", textAlign: "left",
    fillStyle: "", strokeStyle: "", lineWidth: 1,
    setTransform() {}, save() {}, restore() {}, clearRect() {},
    fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {},
    fill() {}, stroke() {}, setLineDash() {},
    measureText: (t) => ({ width: String(t).length * 6 }),
    fillText() {}, createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
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
const sandbox = {
  console, Math, JSON,
  fetch: () => syncThenable({ json: () => syncThenable({ data: { lines: [], source: "none" } }) }),
  performance: { now: () => now },
  requestAnimationFrame: (cb) => { raf = cb; return 1; },
  cancelAnimationFrame() {}, devicePixelRatio: 1,
  window: { addEventListener() {} },
  document: { body: {}, addEventListener() {}, querySelector: () => null },
  ResizeObserver: undefined,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(code + "\n;globalThis.__O__ = OfficeRenderer;", sandbox, { filename: "office.js" });
const O = sandbox.__O__;

O.init(canvas, () => {});
wrap._w = 980; wrap._h = 600;
O.resize();

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

const stats = new Map();
for (const a of agents) stats.set(a.id, { maxStep: 0, jumps: 0, reversals: 0, lastDx: 0, lastDy: 0, moved: 0, frames: 0, still: 0 });
const prev = new Map();

for (let i = 0; i < 60 * 180; i++) {          // 3 menit
  frame(1 / 60);
  const s = O.getDebugState();
  for (const a of s.agents) {
    const st = stats.get(a.id);
    const p = prev.get(a.id);
    if (p && i > 30) {
      const dx = a.x - p.x, dy = a.y - p.y;
      const step = Math.hypot(dx, dy);
      st.frames++;
      if (step > st.maxStep) st.maxStep = step;
      if (step > 6) st.jumps++;
      if (step < 0.05) st.still++;
      // pembalikan arah: arah gerak berbalik > 120 derajat
      if (step > 0.3 && st.lastStep > 0.3) {
        const dot = (dx * st.lastDx + dy * st.lastDy) / (step * st.lastStep);
        if (dot < -0.5) st.reversals++;
      }
      if (step > 0.3) { st.lastDx = dx; st.lastDy = dy; st.lastStep = step; }
      st.moved += step;
    }
    prev.set(a.id, { x: a.x, y: a.y });
  }
}

console.log("=== KESTABILAN GERAK (3 menit simulasi, 60 fps) ===");
console.log("  nama       langkah-maks  lompatan(>6px)  pembalikan  jarak-total  diam%");
let worstStep = 0, totalJumps = 0;
for (const [id, st] of stats) {
  const name = (agents.find((a) => a.id === id) || {}).name || id;
  worstStep = Math.max(worstStep, st.maxStep);
  totalJumps += st.jumps;
  const stillPct = st.frames ? (100 * st.still / st.frames).toFixed(0) : "0";
  console.log(`  ${name.padEnd(10)} ${st.maxStep.toFixed(2).padStart(9)}px ${String(st.jumps).padStart(13)} ${String(st.reversals).padStart(11)} ${st.moved.toFixed(0).padStart(11)}px ${stillPct.padStart(5)}%`);
}
console.log("");
console.log(`  Langkah terbesar keseluruhan : ${worstStep.toFixed(2)} px/frame`);
console.log(`  Total lompatan > 6px         : ${totalJumps}`);
console.log("  (Kecepatan normal 58-66 px/s → ~1 px/frame. >6px berarti tidak stabil.)");
