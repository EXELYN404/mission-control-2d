/**
 * Mission Control 2D — Main Application Logic
 * =============================================
 * SPA (Single Page Application) dengan sidebar navigation.
 * Semua data di-fetch dari backend Python.
 */

// ==========================================
// APP STATE
// ==========================================
const state = {
  currentPage: "dashboard",
  dashboard: null,
  agents: [],
  tasks: [],
  activities: [],
  calendar: [],
  memory: [],
  channels: [],
  office: null,
  officeRoom: "workspace",
  officeRoomApplied: null,   // ruangan yang sudah diterapkan ke kamera
  selectedAgent: null,
};

// ==========================================
// UTILITY
// ==========================================
function $(sel) {
  return document.querySelector(sel);
}

function $$(sel) {
  return document.querySelectorAll(sel);
}

function esc(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso || "--:--";
  }
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr || "--";
  }
}

function formatDateShort(dateStr) {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  } catch {
    return dateStr || "--";
  }
}

function toast(message, type = "info") {
  const container = $("#toast-container");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ==========================================
// CLOCK
// ==========================================
function updateClock() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  $("#date-text").textContent = now.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ==========================================
// NAVIGATION
// ==========================================
function initNavigation() {
  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (!page) return;

      // Update active states
      $$(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      $$(".page").forEach((p) => p.classList.remove("active"));
      $(`.page[data-page="${page}"]`).classList.add("active");

      state.currentPage = page;

      // Canvas 2D perlu diukur ulang saat halaman ditampilkan
      if (page === "office" && typeof OfficeRenderer !== "undefined") {
        requestAnimationFrame(() => OfficeRenderer.resize());
      }

      loadPage(page);
    });
  });
}

function loadPage(page) {
  switch (page) {
    case "dashboard":
      loadDashboard();
      break;
    case "agents":
      loadAgents();
      break;
    case "tasks":
      // Task Board dihapus: pekerjaan datang otomatis dari perubahan nyata
      break;
    case "calendar":
      loadCalendar();
      break;
    case "activity":
      loadActivities();
      break;
    case "memory":
      loadMemory();
      break;
    case "office":
      loadOffice();
      break;
  }
}

// ==========================================
// DASHBOARD
// ==========================================
async function loadDashboard() {
  try {
    const data = await API.getDashboard();
    state.dashboard = data;

    const s = data.summary;
    $("#m-agents").textContent = s.total_agents;
    $("#m-active").textContent = s.in_progress_tasks + s.review_tasks;
    $("#m-progress").textContent = `${s.progress_pct}% selesai`;
    $("#m-working").textContent = data.state_distribution.find(
      (d) => d.state === "working"
    )?.c || 0;
    $("#m-idle").textContent = data.state_distribution.find(
      (d) => d.state === "idle"
    )?.c || 0;
    $("#m-memory").textContent = s.memory_count;
    $("#m-events").textContent = s.event_count;

    // Badges
    $("#badge-agents").textContent = s.total_agents;
    const bt = $("#badge-tasks"); if (bt) bt.textContent = s.in_progress_tasks;

    // State distribution bars
    const stateColors = {
      working: "#4ade80",
      idle: "#facc15",
      reviewing: "#22d3ee",
      collaborating: "#a855f7",
      offline: "#64748b",
      unknown: "#f97316",
    };
    const maxCount = Math.max(
      ...data.state_distribution.map((d) => d.c),
      1
    );
    const barsHtml = data.state_distribution
      .map((d) => {
        const pct = (d.c / maxCount) * 100;
        const color = stateColors[d.state] || "#64748b";
        return `
          <div class="state-bar-row">
            <div class="state-bar-label">
              <span class="dot" style="background:${color}"></span>
              ${esc(d.state)}
            </div>
            <div class="state-bar-track">
              <div class="state-bar-fill" style="width:${pct}%; background:${color}"></div>
            </div>
            <div class="state-bar-count">${d.c}</div>
          </div>`;
      })
      .join("");
    $("#state-bars").innerHTML = barsHtml || '<div class="empty-mini">Tidak ada data</div>';

    // Upcoming tasks
    const tasksHtml = data.upcoming_tasks.length
      ? data.upcoming_tasks
          .map(
            (t) => `
          <div class="task-mini-item">
            <span class="priority-dot priority-${esc(t.priority)}"></span>
            <span class="task-title">${esc(t.title)}</span>
            ${t.assignee_name ? `<span style="color:var(--text-muted);font-size:11px">→ ${esc(t.assignee_name)}</span>` : ""}
          </div>`
          )
          .join("")
      : '<div class="empty-mini">Tidak ada task aktif</div>';
    const ut = $("#upcoming-tasks"); if (ut) ut.innerHTML = tasksHtml;

    // Recent activities
    renderActivityFeed($("#recent-activities"), data.recent_activities);
  } catch (err) {
    console.error("Dashboard error:", err);
    toast("Gagal memuat dashboard: " + err.message, "error");
  }
}

// ==========================================
// HASIL AI AGENT
// ==========================================
// Keputusan AI (mood, emosi, pikiran, aktivitas, model) disimpan backend di
// tabel agent_mind dan dilampirkan ke tiap agent sebagai `mind`. Tanpa
// penampilan ini, hasil AI tidak terlihat sama sekali di UI.

function aiHasData(m) {
  return !!(
    m &&
    ((m.thought || "").toString().trim() ||
      (m.activity || "").toString().trim() ||
      (m.mood || "").toString().trim())
  );
}

function aiSourceLabel(m) {
  if (!m || !m.source) return "";
  return m.source === "ai" ? "AI" : String(m.source);
}

/** Blok hasil AI untuk kartu agent di halaman Agents. */
function aiCardBlock(a) {
  const m = a.mind;
  if (!aiHasData(m)) {
    return `
      <div class="agent-ai agent-ai-empty">
        <span class="ai-dot"></span>
        <span>Belum ada data AI</span>
      </div>`;
  }
  const mood = (m.mood || "").toString().trim();
  const thought = (m.thought || "").toString().trim();
  const activity = (m.activity || "").toString().trim();
  const src = aiSourceLabel(m);
  return `
    <div class="agent-ai">
      <div class="agent-ai-head">
        ${mood ? `<span class="ai-mood">${esc(mood)}</span>` : ""}
        ${src ? `<span class="ai-src">${esc(src)}</span>` : ""}
      </div>
      ${thought ? `<div class="agent-ai-thought">${esc(thought)}</div>` : ""}
      ${activity ? `<div class="agent-ai-act">${esc(activity)}</div>` : ""}
    </div>`;
}

/** Panel hasil AI untuk modal detail agent. */
function renderAgentAi(m) {
  const box = $("#modal-ai");
  if (!box) return;

  if (!aiHasData(m)) {
    box.innerHTML = `
      <div class="empty-mini">
        Belum ada hasil AI untuk agent ini.<br>
        <span class="hint">Data muncul setelah agent mengambil keputusan
        (otak AI berjalan otomatis di latar belakang).</span>
      </div>`;
    return;
  }

  const rows = [
    ["Mood", (m.mood || "").toString().trim()],
    ["Emosi", (m.emotion || "").toString().trim()],
    ["Sedang Memikirkan", (m.thought || "").toString().trim()],
    ["Aktivitas (AI)", (m.activity || "").toString().trim()],
    ["Aksi", (m.action || "").toString().trim()],
    ["Alasan", (m.reason || "").toString().trim()],
    ["Model AI", (m.model || "").toString().trim()],
    ["Sumber", aiSourceLabel(m)],
  ].filter(([, v]) => v);

  const memory = ((m.memory || "").toString().split("\u2028").filter(Boolean)).slice(-5);

  box.innerHTML = `
    <div class="ai-grid">
      ${rows.map(([k, v]) => `
        <div class="ai-row">
          <span class="ai-key">${esc(k)}</span>
          <span class="ai-val">${esc(v)}</span>
        </div>`).join("")}
    </div>
    ${m.updated_at ? `<div class="ai-updated">Diperbarui ${esc(m.updated_at)}</div>` : ""}
    ${memory.length ? `
      <div class="ai-memory">
        <div class="ai-memory-title">Ingatan terakhir</div>
        <ul>${memory.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      </div>` : ""}
  `;
}

// ==========================================
// AGENTS
// ==========================================
async function loadAgents() {
  try {
    const agents = await API.getAgents();
    state.agents = agents;

    const grid = $("#agents-grid");
    if (!agents.length) {
      grid.innerHTML = '<div class="empty-mini">Tidak ada agent terdaftar</div>';
      return;
    }

    grid.innerHTML = agents
      .map((a) => {
        const stateLabel = a.state.charAt(0).toUpperCase() + a.state.slice(1);
        return `
          <div class="agent-card" data-agent-id="${esc(a.id)}">
            <div class="agent-card-header">
              <div class="agent-avatar" style="background:${esc(a.avatar_color)}">
                ${esc(a.name.charAt(0))}
              </div>
              <div class="agent-info">
                <h3>${esc(a.name)}</h3>
                <div class="role">${esc(a.role)}</div>
              </div>
            </div>
            <div class="agent-state-badge ${esc(a.state)}">
              <span class="dot dot-${stateColorName(a.state)}"></span>
              ${esc(stateLabel)}
            </div>
            ${a.current_task ? `
              <div class="agent-task">
                <div class="agent-task-label">Tugas</div>
                ${esc(a.current_task)}
              </div>
            ` : ""}
            ${aiCardBlock(a)}
          </div>`;
      })
      .join("");

    // Click handlers
    $$(".agent-card").forEach((card) => {
      card.addEventListener("click", () => {
        openAgentModal(card.dataset.agentId);
      });
    });
  } catch (err) {
    console.error("Agents error:", err);
    toast("Gagal memuat agents: " + err.message, "error");
  }
}

// ==========================================
// CHAT — panel komunikasi mengambang (kiri bawah)
// ==========================================
// Gelembung yang belum bisa dipasang (kantor belum hidup) disimpan dulu.
const pendingBubbles = [];

const chatState = {
  agents: [],
  selectedAgentId: null,
  mode: "agent",          // "agent" | "cli"
  busy: false,
  open: false,
  history: [],
};

/** Muat daftar agen + status kemampuan nyata (Hermes, model, MS 365). */
async function loadChat() {
  try {
    const [agents, status, ms] = await Promise.all([
      API.getAgents().catch(() => []),
      API.getChatStatus().catch(() => null),
      API.getMs365Status().catch(() => null),
    ]);
    chatState.agents = agents;
    window.__chatStatus = status;
    renderChatConn(status);
    renderAgentPop();
    renderMs365Panel(ms);
    flushPendingBubbles();
  } catch (err) {
    console.error("Chat error:", err);
  }
}

/** Panel mengambang: buka / tutup dengan animasi pendek. */
function openChat() {
  const panel = $("#chat-panel");
  const launcher = $("#chat-launcher");
  if (!panel) return;
  panel.hidden = false;
  panel.classList.remove("closing");
  if (launcher) launcher.setAttribute("aria-expanded", "true");
  chatState.open = true;
  loadChat();
  const input = $("#chat-input");
  if (input) input.focus();
}

function closeChat() {
  const panel = $("#chat-panel");
  const launcher = $("#chat-launcher");
  if (!panel) return;
  panel.classList.remove("opening", "closing");
  panel.hidden = true;
  if (launcher) launcher.setAttribute("aria-expanded", "false");
  chatState.open = false;
}

/** Indikator koneksi mencerminkan kondisi backend yang sebenarnya. */
function renderChatConn(status) {
  const dot = $("#chat-conn-dot");
  const txt = $("#chat-conn-text");
  const badge = $("#chat-launcher-badge");
  const cliBtn = $("#chat-mode-cli");
  if (!dot || !txt) return;

  const h = status && status.hermes;
  const ok = !!(h && h.available);

  dot.className = "conn-dot " + (ok ? "on" : "off");
  txt.textContent = ok ? "TERHUBUNG" : "CLI TIDAK ADA";

  if (badge) {
    badge.textContent = ok ? "AI" : "—";
    badge.classList.toggle("off", !ok);
  }

  // Mode CLI dinonaktifkan dengan alasan yang jelas bila Hermes tidak ada.
  if (cliBtn) {
    cliBtn.disabled = !ok;
    cliBtn.title = ok ? "Jalankan CLI EXELYN AGENT AI"
                      : "Hermes tidak terdeteksi di server ini";
  }
  if (!ok && chatState.mode === "cli") setChatMode("agent");
}

function setChatMode(mode) {
  chatState.mode = mode;
  const agentBtn = $("#chat-mode-agent");
  const cliBtn = $("#chat-mode-cli");
  if (agentBtn) {
    agentBtn.classList.toggle("active", mode === "agent");
    agentBtn.setAttribute("aria-selected", String(mode === "agent"));
  }
  if (cliBtn) {
    cliBtn.classList.toggle("active", mode === "cli");
    cliBtn.setAttribute("aria-selected", String(mode === "cli"));
  }
  const foot = $("#chat-foot");
  if (foot) {
    foot.textContent = mode === "cli"
      ? "CLI penuh EXELYN AGENT AI — AI, skills, dan tools dijalankan sungguhan."
      : "Sebut nama agen dan agen itu yang menjawab lewat gelembung di kantor.";
  }
}

/** Popover pemilih agen: enam agen dengan avatar & bidang keahlian. */
function renderAgentPop() {
  const pop = $("#chat-agentpop");
  const label = $("#chat-pick-label");
  if (!pop) return;

  pop.innerHTML = chatState.agents
    .map(
      (a) => `
      <button class="chat-agentopt ${chatState.selectedAgentId === a.id ? "active" : ""}"
              data-agent-id="${esc(a.id)}">
        <span class="chat-agentopt-ava" style="background:${esc(a.avatar_color || "#3b82f6")}">
          ${esc((a.name || "?").charAt(0))}
        </span>
        <span class="chat-agentopt-meta">
          <span class="chat-agentopt-name">${esc(a.name)}</span>
          <span class="chat-agentopt-role">${esc(a.role || "")}</span>
        </span>
        <span class="chat-agentopt-check">${chatState.selectedAgentId === a.id ? "●" : ""}</span>
      </button>`
    )
    .join("");

  $$("#chat-agentpop .chat-agentopt").forEach((btn) => {
    btn.addEventListener("click", () => {
      chatState.selectedAgentId = btn.dataset.agentId;
      renderAgentPop();
      const a = chatState.agents.find((x) => x.id === chatState.selectedAgentId);
      if (label && a) label.textContent = a.name.toUpperCase();
      toggleAgentPop(false);
      const input = $("#chat-input");
      if (input) input.focus();
    });
  });
}

function toggleAgentPop(force) {
  const pop = $("#chat-agentpop");
  const pick = $("#chat-pick");
  if (!pop) return;
  const show = typeof force === "boolean" ? force : pop.hidden;
  pop.hidden = !show;
  if (pick) pick.setAttribute("aria-expanded", String(show));
}

function renderMs365Panel(ms) {
  const box = $("#chat-ms365-body");
  const state = $("#chat-ms365-state");
  if (!box) return;

  if (!ms) {
    if (state) { state.textContent = "tidak terbaca"; state.style.color = "var(--c-idle)"; }
    box.innerHTML = '<div class="empty-mini">Status Microsoft 365 tidak terbaca.</div>';
    return;
  }

  const ok = ms.rclone === "TERSEDIA";
  if (state) {
    state.textContent = ok ? "OneDrive siap" : "OneDrive belum siap";
    state.style.color = ok ? "var(--c-working)" : "var(--c-idle)";
  }

  const deps = Object.entries(ms.deps || {}).map(([k, v]) => `${k}: ${v}`).join(" · ");

  box.innerHTML = `
    <div class="chat-ms365-row"><span class="k">OneDrive</span><span class="v">${esc(ms.remote || "-")}</span></div>
    <div class="chat-ms365-row"><span class="k">Folder</span><span class="v">${esc(ms.folder || "-")}</span></div>
    <div class="chat-ms365-row"><span class="k">Pustaka</span><span class="v">${esc(deps)}</span></div>
    <div class="chat-ms365-actions">
      <button data-ms365="xlsx">Excel</button>
      <button data-ms365="docx">Word</button>
      <button data-ms365="pptx">PPT</button>
      <button data-ms365="pdf">PDF</button>
    </div>
    <div class="chat-ms365-files" id="chat-ms365-files">
      <div class="empty-mini">Memuat berkas OneDrive…</div>
    </div>
  `;

  $$("#chat-ms365-body [data-ms365]").forEach((btn) => {
    btn.addEventListener("click", () => makeSampleDoc(btn.dataset.ms365, btn));
  });

  loadMs365Files();
}

async function loadMs365Files() {
  const box = $("#chat-ms365-files");
  if (!box) return;
  try {
    const d = await API.getMs365Files();
    const files = d.files || [];
    box.innerHTML = files.length
      ? files.map((f) => `<div>• ${esc(f)}</div>`).join("")
      : '<div class="empty-mini">Belum ada berkas di OneDrive.</div>';
  } catch (err) {
    box.innerHTML = `<div class="empty-mini">OneDrive tidak dapat dibaca.</div>`;
  }
}

async function makeSampleDoc(fmt, btn) {
  if (!btn) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const r = await API.createMs365Document(sampleSpec(fmt), true);
    addChatMessage("system", null,
      `${r.document.filename} (${r.document.size} byte) dibuat` +
      (r.uploaded ? ` · terunggah & terverifikasi` : ""));
    loadMs365Files();
  } catch (err) {
    addChatMessage("system", null, `Gagal membuat dokumen: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function sampleSpec(fmt) {
  const title = "Laporan Agen Mission Control";
  const headers = ["Agen", "Peran", "Status"];
  const rows = chatState.agents.map((a) => [a.name, a.role, a.state]);
  const base = { title, subtitle: "Dokumen contoh dari Microsoft 365 Specialist" };
  if (fmt === "pptx") {
    return { ...base, format: "pptx", slides: [
      { title: "Tim Mission Control",
        bullets: chatState.agents.map((a) => `${a.name} — ${a.role}`) },
      { title: "Catatan",
        bullets: ["Dokumen ini dihasilkan nyata oleh mesin MS 365."] },
    ] };
  }
  if (fmt === "csv") return { ...base, format: "csv", table: { headers, rows } };
  if (fmt === "pdf") {
    return { ...base, format: "pdf",
             paragraphs: [`Tim beranggotakan ${rows.length} agen yang sedang bertugas.`],
             table: { headers, rows } };
  }
  if (fmt === "docx") {
    return { ...base, format: "docx",
             paragraphs: [`Berikut keadaan ${rows.length} agen saat ini.`],
             table: { headers, rows } };
  }
  return { ...base, format: "xlsx", sheets: [{ name: "Agen", headers, rows }] };
}

function addChatMessage(kind, who, text, meta, pending) {
  const box = $("#chat-conv");
  if (!box) return null;
  const empty = box.querySelector(".empty-mini");
  if (empty) empty.remove();

  const el = document.createElement("div");
  el.className = `chat-msg ${kind}${pending ? " pending" : ""}`;
  el.innerHTML =
    (who ? `<span class="who">${esc(who)}</span>` : "") +
    `<span class="txt">${esc(text)}</span>` +
    (meta ? `<span class="meta">${esc(meta)}</span>` : "");
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function addTyping() {
  const el = addChatMessage("agent", null, "", null, true);
  if (el) {
    el.innerHTML = `<span class="chat-typing" aria-label="sedang mengetik"><i></i><i></i><i></i></span>`;
  }
  return el;
}

async function sendChatMessage() {
  const input = $("#chat-input");
  const btn = $("#chat-send");
  if (!input || !btn || chatState.busy) return;

  const message = input.value.trim();
  if (!message) return;                      // jangan kirim pesan kosong

  chatState.busy = true;
  btn.disabled = true;
  btn.classList.add("busy");
  input.value = "";
  autoGrow();

  addChatMessage("user", "Anda", message, null, false);
  const typing = addTyping();

  try {
    const data = await API.sendChat(message, {
      agentId: chatState.selectedAgentId,
      preferCli: chatState.mode === "cli",
    });
    chatState.history.push({ q: message, a: data });

    if (typing) typing.remove();

    if (data.mode === "agent") {
      const meta = data.source === "ai"
        ? `${data.model} · ${data.latency}s`
        : (data.reply.error || "model tidak tersedia");
      addChatMessage("agent", data.agent_name, data.reply.text, meta, false);
      if (data.bubble && data.agent_id) {
        showAgentBubble(data.agent_id, data.bubble, data.emotion);
      }
    } else {
      addChatMessage("agent", "Hermes CLI", (data.reply.text || "").slice(0, 4000),
        `CLI penuh · ${data.latency}s${data.workdir ? " · " + data.workdir : ""}`, false);
    }
  } catch (err) {
    if (typing) typing.remove();
    addChatMessage("system", null, err.message, null, false);
  } finally {
    chatState.busy = false;
    if (btn) { btn.disabled = false; btn.classList.remove("busy"); }
    if (input) input.focus();
  }
}

/** Tinggi textarea mengikuti isi, tanpa melebihi batas. */
function autoGrow() {
  const input = $("#chat-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 88) + "px";
}

/** Pasang gelembung di atas kepala agen — lewat API renderer kantor. */
function showAgentBubble(agentId, text, emotion) {
  const name = OfficeRenderer.agentName ? OfficeRenderer.agentName(agentId) : agentId;
  const ok = !!(OfficeRenderer.say && OfficeRenderer.say(agentId, text, emotion));
  if (!ok) pendingBubbles.push({ agentId, text, emotion });
}

function flushPendingBubbles() {
  if (!pendingBubbles.length) return;
  const rest = [];
  for (const b of pendingBubbles) {
    if (!(OfficeRenderer.say && OfficeRenderer.say(b.agentId, b.text, b.emotion))) rest.push(b);
  }
  pendingBubbles.length = 0;
  pendingBubbles.push(...rest);
}

/** Dipanggil dari loadOffice() agar gelembung chat ikut muncul di kantor. */
function onOfficeReady() {
  flushPendingBubbles();
}

function initChat() {
  const launcher = $("#chat-launcher");
  const min = $("#chat-min");
  const input = $("#chat-input");
  const btn = $("#chat-send");
  const pick = $("#chat-pick");
  const agentBtn = $("#chat-mode-agent");
  const cliBtn = $("#chat-mode-cli");

  if (launcher) {
    launcher.addEventListener("click", () => {
      if (chatState.open) closeChat(); else openChat();
    });
  }
  if (min) min.addEventListener("click", closeChat);

  if (input) {
    input.addEventListener("input", autoGrow);
    input.addEventListener("keydown", (e) => {
      // Enter mengirim, Shift+Enter membuat baris baru.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }
  if (btn) btn.addEventListener("click", sendChatMessage);

  if (pick) {
    pick.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAgentPop();
    });
  }
  if (agentBtn) {
    agentBtn.addEventListener("click", () => setChatMode("agent"));
  }
  if (cliBtn) {
    cliBtn.addEventListener("click", () => setChatMode("cli"));
  }

  // Tutup popover bila mengklik di luarnya.
  document.addEventListener("click", (e) => {
    const pop = $("#chat-agentpop");
    if (pop && !pop.hidden && !pop.contains(e.target) && e.target !== pick) {
      toggleAgentPop(false);
    }
  });

  setChatMode("agent");
}

function stateColorName(state) {
  const map = {
    working: "green",
    idle: "yellow",
    reviewing: "cyan",
    collaborating: "purple",
    offline: "gray",
    unknown: "orange",
  };
  return map[state] || "orange";
}

// ==========================================
// AGENT MODAL
// ==========================================
async function openAgentModal(agentId) {
  try {
    const data = await API.getAgent(agentId);
    state.selectedAgent = data;

    const agent = data.agent;
    $("#modal-avatar").textContent = agent.name.charAt(0);
    $("#modal-avatar").style.background = agent.avatar_color;
    $("#modal-name").textContent = agent.name;
    $("#modal-role").textContent = agent.role;
    $("#modal-state").innerHTML = `<span class="agent-state-badge ${esc(agent.state)}">
      <span class="dot dot-${stateColorName(agent.state)}"></span>
      ${esc(agent.state)}
    </span>`;
    $("#modal-room").textContent = agent.current_room || "unknown";
    $("#modal-task").textContent = agent.current_task || "Tidak ada tugas";
    $("#modal-desc").textContent = agent.description || "-";

    // Hasil AI agent (mood, emosi, pikiran, aktivitas, model)
    renderAgentAi(data.mind);

    // State buttons
    $$("#state-buttons .state-btn").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await API.updateAgentState(agent.id, btn.dataset.state);
          toast(`State ${agent.name} → ${btn.dataset.state}`, "success");
          openAgentModal(agent.id); // refresh
          // Refresh office if active
          if (state.currentPage === "office") {
            loadOffice();
          }
        } catch (err) {
          toast("Gagal update state: " + err.message, "error");
        }
      };
    });

    // Activities
    renderActivityFeed($("#modal-activities"), data.activities);

    // Tasks
    $("#modal-tasks").innerHTML = data.tasks.length
      ? data.tasks
          .map(
            (t) => `
          <div class="task-mini-item">
            <span class="priority-dot priority-${esc(t.priority)}"></span>
            <span class="task-title">${esc(t.title)}</span>
            <span style="color:var(--text-muted);font-size:11px">${esc(t.status)}</span>
          </div>`
          )
          .join("")
      : '<div class="empty-mini">Tidak ada task</div>';

    $("#agent-modal").hidden = false;
  } catch (err) {
    toast("Gagal memuat detail agent: " + err.message, "error");
  }
}

// ==========================================
// TASKS (KANBAN)
// ==========================================
const KANBAN_COLUMNS = [
  { id: "todo", title: "To Do", statusClass: "todo" },
  { id: "in_progress", title: "In Progress", statusClass: "in_progress" },
  { id: "review", title: "Review", statusClass: "review" },
  { id: "done", title: "Done", statusClass: "done" },
];

async function loadTasks() {
  try {
    const tasks = await API.getTasks();
    state.tasks = tasks;

    const board = $("#kanban-board");
    if (!board) return;                 // Task Board sudah dihapus
    board.innerHTML = "";

    for (const col of KANBAN_COLUMNS) {
      const colTasks = tasks.filter((t) => t.status === col.id);
      const colEl = document.createElement("div");
      colEl.className = `kanban-col status-${col.statusClass}`;
      colEl.innerHTML = `
        <div class="kanban-col-header">
          <span class="kanban-col-title">${col.title}</span>
          <span class="kanban-col-count">${colTasks.length}</span>
        </div>
        <div class="kanban-body">
          ${colTasks.length
            ? colTasks.map((t) => renderKanbanCard(t)).join("")
            : '<div class="empty-mini" style="padding:12px">Kosong</div>'}
        </div>`;
      board.appendChild(colEl);
    }

    // Card action handlers
    $$(".kanban-card").forEach((card) => {
      const taskId = card.dataset.taskId;
      const task = tasks.find((t) => t.id === taskId);

      // Status change buttons
      card.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          try {
            if (action === "advance") {
              const nextStatus = getNextStatus(task.status);
              await API.updateTask(taskId, { status: nextStatus });
              toast(`Task dipindah ke ${nextStatus}`, "success");
            } else if (action === "delete") {
              if (confirm("Hapus task ini?")) {
                await API.deleteTask(taskId);
                toast("Task dihapus", "success");
              }
            } else if (action === "edit") {
              openTaskModal(task);
              return;
            }
            // Task Board dihapus: pekerjaan datang otomatis dari perubahan nyata
          } catch (err) {
            toast("Error: " + err.message, "error");
          }
        });
      });
    });
  } catch (err) {
    console.error("Tasks error:", err);
    toast("Gagal memuat tasks: " + err.message, "error");
  }
}

function getNextStatus(current) {
  const order = ["todo", "in_progress", "review", "done"];
  const idx = order.indexOf(current);
    return order[Math.min(idx + 1, order.length - 1)];
}

function renderKanbanCard(task) {
  return `
    <div class="kanban-card" data-task-id="${esc(task.id)}">
      <div class="kanban-card-title">${esc(task.title)}</div>
      ${task.description ? `<div class="kanban-card-desc">${esc(task.description)}</div>` : ""}
      <div class="kanban-card-footer">
        <div class="kanban-card-assignee">
          ${task.assignee_name
            ? `<span class="assignee-dot" style="background:${esc(task.avatar_color || "#64748b")}"></span>
               <span>${esc(task.assignee_name)}</span>`
            : '<span style="color:var(--text-muted)">Unassigned</span>'}
        </div>
        <div class="kanban-card-actions">
          <button class="icon-btn" data-action="edit" title="Edit">✎</button>
          ${task.status !== "done" ? `<button class="icon-btn" data-action="advance" title="Majukan">→</button>` : ""}
          <button class="icon-btn" data-action="delete" title="Hapus">🗑</button>
        </div>
      </div>
    </div>`;
}

// ==========================================
// TASK MODAL
// ==========================================
function openTaskModal(task = null) {
  const form = $("#task-form");
  form.reset();

  // Populate assignee dropdown
  const select = $("#task-assignee");
  select.innerHTML =
    '<option value="">— Unassigned —</option>' +
    state.agents
      .map(
        (a) =>
          `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.role)})</option>`
      )
      .join("");

  if (task) {
    form.elements.title.value = task.title || "";
    form.elements.description.value = task.description || "";
    form.elements.status.value = task.status || "todo";
    form.elements.priority.value = task.priority || "medium";
    form.elements.assignee_id.value = task.assignee_id || "";
  }

  $("#task-modal").hidden = false;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    data.priority = data.priority || "medium";

    try {
      if (task) {
        await API.updateTask(task.id, data);
        toast("Task diperbarui", "success");
      } else {
        await API.createTask(data);
        toast("Task dibuat", "success");
      }
      $("#task-modal").hidden = true;
      // Task Board dihapus: pekerjaan datang otomatis dari perubahan nyata
    } catch (err) {
      toast("Gagal menyimpan task: " + err.message, "error");
    }
  };
}

// ==========================================
// CALENDAR
// ==========================================
async function loadCalendar() {
  try {
    const events = await API.getCalendar();
    state.calendar = events;

    const list = $("#calendar-list");
    if (!events.length) {
      list.innerHTML = '<div class="empty-mini">Tidak ada event terjadwal</div>';
      return;
    }

    list.innerHTML = events
      .map((e) => {
        const d = new Date(e.event_date + "T00:00:00");
        const day = d.getDate();
        const month = d.toLocaleDateString("id-ID", { month: "short" });
        return `
          <div class="calendar-item">
            <div class="calendar-date">
              <div class="calendar-day">${day}</div>
              <div class="calendar-month">${month}</div>
            </div>
            <div class="calendar-info">
              <div class="calendar-title">${esc(e.title)}</div>
              <div class="calendar-desc">${esc(e.description || "")}</div>
            </div>
            <span class="calendar-type ${esc(e.event_type)}">${esc(e.event_type)}</span>
          </div>`;
      })
      .join("");
  } catch (err) {
    console.error("Calendar error:", err);
    toast("Gagal memuat kalender: " + err.message, "error");
  }
}

// ==========================================
// ACTIVITY
// ==========================================
function renderActivityFeed(container, activities) {
  if (!activities || !activities.length) {
    container.innerHTML = '<div class="empty-mini">Tidak ada aktivitas</div>';
    return;
  }

  const typeColors = {
    system: "#64748b",
    state_change: "#fbbf24",
    task_completed: "#4ade80",
    task_started: "#3b82f6",
    task_created: "#a855f7",
    task_status_changed: "#22d3ee",
    task_deleted: "#f87171",
    review_started: "#ec4899",
    status_changed: "#facc15",
    broadcast: "#f97316",
    memory_added: "#10b981",
  };

  container.innerHTML = activities
    .map((a) => {
      const color = typeColors[a.type] || "#64748b";
      const agentName = a.agent_name || "Sistem";
      return `
        <div class="activity-item">
          <span class="activity-dot" style="background:${color}"></span>
          <span class="activity-msg">
            <strong>${esc(agentName)}</strong> — ${esc(a.message)}
          </span>
          <span class="activity-time">${formatTime(a.created_at)}</span>
        </div>`;
    })
    .join("");
}

async function loadActivities() {
  try {
    const activities = await API.getActivities(100);
    state.activities = activities;
    renderActivityFeed($("#all-activities"), activities);
  } catch (err) {
    console.error("Activities error:", err);
    toast("Gagal memuat aktivitas: " + err.message, "error");
  }
}

// ==========================================
// MEMORY
// ==========================================
async function loadMemory() {
  try {
    const entries = await API.getMemory();
    state.memory = entries;

    const grid = $("#memory-grid");
    if (!entries.length) {
      grid.innerHTML = '<div class="empty-mini">Tidak ada catatan</div>';
      return;
    }

    grid.innerHTML = entries
      .map((m) => `
        <div class="memory-card">
          <div class="memory-card-header">
            <h3>${esc(m.title)}</h3>
            <span class="memory-category">${esc(m.category)}</span>
          </div>
          <div class="memory-content">${esc(m.content)}</div>
          ${m.tags
            ? `<div class="memory-tags">${m.tags.split(",").map((t) => `<span class="memory-tag">${esc(t.trim())}</span>`).join("")}</div>`
            : ""}
        </div>`)
      .join("");
  } catch (err) {
    console.error("Memory error:", err);
    toast("Gagal memuat memory: " + err.message, "error");
  }
}

// ==========================================
// 2D OFFICE
// ==========================================
async function loadOffice() {
  try {
    const data = await API.getOfficeState();
    state.office = data;

    OfficeRenderer.setData(data);
    if (typeof onOfficeReady === "function") onOfficeReady();

    // Terapkan ruangan hanya saat benar-benar berubah, supaya kamera tidak
    // "terbang" ulang setiap kali data di-refresh (tiap 30 detik).
    if (state.officeRoom !== state.officeRoomApplied) {
      OfficeRenderer.setRoom(state.officeRoom);
      state.officeRoomApplied = state.officeRoom;
    }

    // Update room info
    if (state.officeRoom === "all") {
      $("#room-name").textContent = "Semua Ruangan";
      $("#room-desc").textContent =
        "Tampilan keseluruhan: Workspace di kiri, Lounge di kanan, dihubungkan koridor.";
    } else {
      const room = data.rooms.find((r) => r.id === state.officeRoom);
      if (room) {
        $("#room-name").textContent = room.name;
        $("#room-desc").textContent = room.description;
      }
    }

    // Update room tabs
    $$(".room-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.room === state.officeRoom);
    });

    // Crew summary
    const counts = {};
    for (const a of data.agents) {
      counts[a.state] = (counts[a.state] || 0) + 1;
    }
    const summaryEl = $("#crew-summary");
    const stateOrder = ["working", "idle", "reviewing", "collaborating", "offline", "unknown"];
    const stateColors = {
      working: "#4ade80",
      idle: "#facc15",
      reviewing: "#22d3ee",
      collaborating: "#a855f7",
      offline: "#64748b",
      unknown: "#f97316",
    };

    let summaryHtml = "";
    for (const s of stateOrder) {
      const c = counts[s] || 0;
      if (c === 0 && s !== "working" && s !== "idle") continue;
      summaryHtml += `
        <div class="crew-row">
          <span class="crew-label">
            <span class="dot" style="background:${stateColors[s]}"></span>
            ${s.charAt(0).toUpperCase() + s.slice(1)}
          </span>
          <span class="crew-count" style="color:${stateColors[s]}">${c}</span>
        </div>`;
    }
    summaryEl.innerHTML = summaryHtml || '<div class="empty-mini">Tidak ada data</div>';

    // Badge
    const workingCount = counts["working"] || 0;
    $("#badge-office").textContent = workingCount;

    // Office activity
    renderActivityFeed($("#office-activity"), data.recent_activities);

    // Channels
    try {
      const channels = await API.getChannels();
      state.channels = channels;

      const chList = $("#channel-list");
      chList.innerHTML = channels
        .map((c) => {
          const statusLabel =
            c.status === "connected"
              ? `Connected • ${c.active_sessions} sesi`
              : c.status === "disconnected"
                ? "Disconnected"
                : "Not Available";
          return `
            <div class="channel-item">
              <span class="channel-dot ${esc(c.status)}"></span>
              <div class="channel-info">
                <div class="channel-name">${esc(c.name)}</div>
                <div class="channel-status">${statusLabel}</div>
              </div>
            </div>`;
        })
        .join("");
    } catch (err) {
      $("#channel-list").innerHTML =
        '<div class="empty-mini">Tidak ada channel</div>';
    }

    // Hide overlay
    $("#canvas-overlay").classList.add("hidden");
  } catch (err) {
    console.error("Office error:", err);
    toast("Gagal memuat office: " + err.message, "error");
  }
}

function initOffice() {
  const canvas = $("#office-canvas");
  OfficeRenderer.init(canvas, (agent) => {
    OfficeRenderer.setSelectedAgent(agent.id);
    openAgentModal(agent.id);
  });

  // Navigasi ruangan (termasuk "Semua Ruangan")
  $$(".room-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.officeRoom = tab.dataset.room;
      OfficeRenderer.setRoom(tab.dataset.room);
      state.officeRoomApplied = tab.dataset.room;

      // Info ruangan
      if (state.officeRoom === "all") {
        $("#room-name").textContent = "Semua Ruangan";
        $("#room-desc").textContent = "Tampilan keseluruhan: Workspace di kiri, Lounge di kanan, dihubungkan koridor.";
      } else if (state.office) {
        const room = state.office.rooms.find((r) => r.id === state.officeRoom);
        if (room) {
          $("#room-name").textContent = room.name;
          $("#room-desc").textContent = room.description;
        }
      }

      $$(".room-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
    });
  });

  // Kontrol kamera
  const followBtn = $("#cam-follow");
  $("#cam-zoom-in").addEventListener("click", () => OfficeRenderer.zoomBy(1.2));
  $("#cam-zoom-out").addEventListener("click", () => OfficeRenderer.zoomBy(0.83));
  $("#cam-reset").addEventListener("click", () => {
    OfficeRenderer.resetCamera();
    followBtn.classList.remove("active");
  });
  followBtn.addEventListener("click", () => {
    if (OfficeRenderer.getFollow()) {
      OfficeRenderer.setFollow(null);
      followBtn.classList.remove("active");
      toast("Kamera bebas", "info");
    } else if (state.selectedAgent && state.selectedAgent.agent) {
      OfficeRenderer.setFollow(state.selectedAgent.agent.id);
      followBtn.classList.add("active");
      toast(`Kamera mengikuti ${state.selectedAgent.agent.name}`, "info");
    } else {
      toast("Pilih agent dulu (klik karakternya)", "info");
    }
  });
}

// ==========================================
// MEMORY FORM
// ==========================================
function initMemoryForm() {
  const form = $("#memory-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    try {
      await API.createMemory(data);
      toast("Catatan tersimpan", "success");
      $("#memory-modal").hidden = true;
      loadMemory();
    } catch (err) {
      toast("Gagal menyimpan: " + err.message, "error");
    }
  };
}

// ==========================================
// MODAL HELPERS
// ==========================================
function initModals() {
  // Close buttons
  $$(".modal-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = btn.closest(".modal");
      if (modal) modal.hidden = true;
    });
  });

  // Data-close buttons
  $$("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = document.getElementById(btn.dataset.close);
      if (modal) modal.hidden = true;
    });
  });

  // Click outside modal to close
  $$(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.hidden = true;
    });
  });
}

// ==========================================
// INITIALIZATION
// ==========================================
async function init() {
  updateClock();
  setInterval(updateClock, 1000);

  initNavigation();
  initModals();
  initOffice();
  initMemoryForm();
  initChat();
  loadChat();          // panel mengambang: siapkan agen & status sejak awal

  // New task button
  const bnt = $("#btn-new-task");
  if (bnt) bnt.addEventListener("click", () => openTaskModal());

  // New memory button
  $("#btn-new-memory").addEventListener("click", () => {
    $("#memory-form").reset();
    $("#memory-modal").hidden = false;
  });

  // Deep-link: mis. /?page=office&room=lounge langsung membuka halaman & ruangan
  const params = new URLSearchParams(location.search);
  const VALID_PAGES = ["dashboard", "agents", "tasks", "calendar", "activity", "memory", "office"];
  const VALID_ROOMS = ["workspace", "lounge", "meeting", "pantry", "garden", "all"];
  const wanted = params.get("page");
  const wantedRoom = params.get("room");

  if (wanted && VALID_PAGES.includes(wanted)) {
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === wanted));
    $$(".page").forEach((p) => p.classList.toggle("active", p.dataset.page === wanted));
    state.currentPage = wanted;
    if (wanted === "office") {
      if (wantedRoom && VALID_ROOMS.includes(wantedRoom)) state.officeRoom = wantedRoom;
      requestAnimationFrame(() => OfficeRenderer.resize());
    }
    loadPage(wanted);
  } else {
    loadPage("dashboard");
  }

  // Mode debug: /?debug=1 menulis status kamera, canvas, dan agent ke judul
  // halaman (berguna untuk diagnosis tanpa DevTools, termasuk saat headless).
  if (params.get("debug")) {
    setInterval(() => {
      try {
        const d = OfficeRenderer.getDebugState();
        const c = d.camera;
        const seated = d.agents.filter((a) => a.seated).length;
        const walkStuck = d.agents.filter((a) => a.walking).length;
        const emo = d.agents.filter((a) => a.emotion)
          .map((a) => `${a.name}=${a.emotion}`).join(",");
        const minds = d.agents.filter((a) => a.thought).length;
        document.title =
          `DBG cam=${Math.round(c.x)},${Math.round(c.y)},z${c.zoom.toFixed(2)}` +
          ` canvas=${d.canvas.w}x${d.canvas.h} room=${state.officeRoom}` +
          ` agents=${d.agents.length} chats=${d.chats}` +
          ` seated=${seated} walking=${walkStuck} minds=${minds} emo=[${emo}]`;
      } catch (e) {
        document.title = "DBG error: " + e.message;
      }
    }, 400);
  }

  // Auto-refresh data tiap 30 detik
  setInterval(() => {
    if (state.currentPage === "office") {
      loadOffice();
    } else if (state.currentPage === "dashboard") {
      loadDashboard();
    } else if (state.currentPage === "agents") {
      loadAgents();
    }
  }, 30000);

  console.log("Mission Control 2D initialized");
}

// Start app
document.addEventListener("DOMContentLoaded", init);
