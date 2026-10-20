/**
 * API Client — Mission Control 2D
 * Wrapper untuk semua endpoint REST API backend.
 */
const API = (() => {
  const BASE = "/api";

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
  };
})();
