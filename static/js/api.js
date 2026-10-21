/**
 * API Client — Mission Control 2D
 * Wrapper untuk semua endpoint REST API backend.
 */
const API = (() => {
  // Base URL: secara default RELATIVE (/api) supaya jalan lokal maupun saat
  // frontend dan backend satu domain. Saat frontend di-deploy terpisah
  // (mis. Vercel) dengan backend di platform lain (mis. Railway), set
  // window.__API_BASE__ ke URL backend, atau pakai rewrite di vercel.json.
  const BASE = (typeof window !== "undefined" && window.__API_BASE__) || "/api";

  async function request(path, options = {}) {
    const url = BASE + path;
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || "Unknown error");
    }
    return data.data;
  }

  return {
    // Dashboard
    getDashboard: () => request("/dashboard"),

    // Agents
    getAgents: () => request("/agents"),
    getAgent: (id) => request(`/agents/${id}`),
    updateAgentState: (id, state, room) =>
      request(`/agents/${id}/state`, {
        method: "POST",
        body: JSON.stringify({ state, room }),
      }),

    // Tasks
    getTasks: (status) => request("/tasks" + (status ? `?status=${status}` : "")),
    createTask: (task) =>
      request("/tasks", { method: "POST", body: JSON.stringify(task) }),
    updateTask: (id, updates) =>
      request(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(updates) }),
    deleteTask: (id) => request(`/tasks/${id}`, { method: "DELETE" }),

    // Activities
    getActivities: (limit = 50) => request(`/activities?limit=${limit}`),

    // Calendar
    getCalendar: () => request("/calendar"),

    // Memory
    getMemory: () => request("/memory"),
    createMemory: (entry) =>
      request("/memory", { method: "POST", body: JSON.stringify(entry) }),
    deleteMemory: (id) => request(`/memory/${id}`, { method: "DELETE" }),

    // Channels
    getChannels: () => request("/channels"),

    // Office
    getOfficeState: () => request("/office"),

    // Statistik mesin AI
    getAiStats: () => request("/office/ai-stats"),

    // ------------------------------------------------------------------
    // CHAT — menu chat agen + CLI EXELYN AGENT AI
    // ------------------------------------------------------------------
    // getChatStatus mengembalikan kemampuan nyata (Hermes ada/tidak, model
    // apa saja yang disediakan rantai AI), bukan janji kosong.
    getChatStatus: () => request("/chat/status"),

    /**
     * Kirim pesan ke menu chat.
     * Bila pesan menyebut nama agen, agen itu yang menjawab (mode "agent").
     * Bila prefer_cli dipakai, seluruh kemampuan CLI dijalankan (mode "cli").
     */
    sendChat: (message, opts = {}) =>
      request("/chat/send", {
        method: "POST",
        body: JSON.stringify({
          message,
          agent_id: opts.agentId || null,
          prefer_cli: !!opts.preferCli,
          workdir: opts.workdir || null,
        }),
      }),

    // ------------------------------------------------------------------
    // MICROSOFT 365 — dokumen nyata + OneDrive
    // ------------------------------------------------------------------
    getMs365Status: () => request("/ms365/status"),
    getMs365Files: () => request("/ms365/files"),
    createMs365Document: (spec, upload = true) =>
      request("/ms365/create", {
        method: "POST",
        body: JSON.stringify({ spec, upload }),
      }),
  };
})();
