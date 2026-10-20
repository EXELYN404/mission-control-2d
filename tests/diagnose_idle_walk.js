/**
 * DIAGNOSTIK: mengapa agent idle tidak pernah sampai tujuan / mengobrol?
 * Menjalankan simulasi dan mencetak mode + posisi agent idle berkala.
 */
const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync(__dirname + "/../static/js/office.js", "utf8");

function makeCtx() {
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

function syncThenable(value) {
  return {
    then(onOk) {
      const ret = onOk(value);
      return (ret && typeof ret.then === "function") ? ret : syncThenable(ret);
    },
    catch() { return this; },
  };
}

const ctx = makeCtx();
const wrap = {
  _w: 0, _h: 0,
  get clientWidth() { return this._w; },
  get clientHeight() { return this._h; },
  getBoundingClientRect() { return { width: this._w, height: this._h, left: 0, top: 0 }; },
};
const canvas = {
  width: 0, height: 0, style: {}, parentElement: wrap,
  getContext: () => ctx,
  addEventListener() {},
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
};
ctx.canvas = canvas;

let raf = null, now = 0;
const REPLY = {
  lines: [{ speaker: "a", text: "halo" }, { speaker: "b", text: "hai" }],
  activities: {}, source: "ai",
};
const sandbox = {
  console, Math, JSON,
  fetch: () => syncThenable({ json: () => syncThenable({ data: REPLY }) }),
  performance: { now: () => now },
  requestAnimationFrame: (cb) => { raf = cb; return 1; },
  cancelAnimationFrame() {},
  devicePixelRatio: 1,
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

function frame(dt) {
  now += dt * 1000;
  if (raf) { const cb = raf; raf = null; cb(now); }
}

let stuckCount = 0;
let prev = {};
for (let i = 0; i < 60 * 400; i++) {
  frame(1 / 60);
  const s = O.getDebugState();
  for (const a of s.agents) {
    if (a.state !== "idle") continue;
    const p = prev[a.id];
    if (p && p.x === a.x && p.y === a.y && a.mode !== "loungeIdle") stuckCount++;
    prev[a.id] = { x: a.x, y: a.y };
  }
  if (i % (60 * 20) === 0) {
    const idle = s.agents.filter((a) => a.state === "idle");
    console.log(`t=${(i / 60) | 0}s chats=${s.chats} ` +
      idle.map((a) => `${a.name}:${a.mode}@${a.room}(${a.x},${a.y})${a.insideSolid ? " [DALAM-DEKOR]" : ""}`).join(" | "));
  }
}
const fin = O.getDebugState();
console.log("\nframe diam saat berjalan (idle):", stuckCount);
console.log("mode akhir idle:", fin.agents.filter((a) => a.state === "idle").map((a) => `${a.name}:${a.mode}`).join(", "));
console.log("jumlah chat aktif:", fin.chats);
