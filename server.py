#!/usr/bin/env python3
"""
Mission Control 2D - Backend Server
====================================
HTTP server berbasis Python stdlib (zero external dependencies)
yang menyediakan:
- Static file serving
- REST API untuk agents, tasks, activities, calendar, memory
- SQLite database untuk persistence

Jalankan: python3 server.py
Akses: http://localhost:8080
"""

import json
import os
import sqlite3
import time
import uuid
import mimetypes
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import ai_dialogue
import cli_bridge


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT_DIR, "static")
TEMPLATES_DIR = os.path.join(ROOT_DIR, "templates")
DATA_DIR = os.path.join(ROOT_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "mission.db")

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")


# ====================================================================
# DATABASE SETUP
# ====================================================================
def get_db():
    """
    Membuat koneksi database baru untuk setiap request.

    PENTING: server ini multi-thread (ThreadingHTTPServer) dan jembatan CLI
    menulis dari thread lain. Tanpa WAL + busy_timeout, penulisan bersamaan
    menghasilkan "database is locked" dan endpoint gagal (HTTP 500).
    """
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")      # baca & tulis bisa bersamaan
    conn.execute("PRAGMA busy_timeout = 15000")    # tunggu, jangan langsung gagal
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def db_write(fn, attempts=5, delay=0.35):
    """
    Jalankan penulisan database dengan percobaan ulang.

    Server ini multi-thread dan jembatan CLI menulis dari thread lain. Dengan
    WAL, pembaca tidak lagi terhalang, tetapi DUA penulis tetap bisa bentrok
    ("database is locked"). Percobaan ulang singkat menyelesaikannya.
    """
    last = None
    for i in range(attempts):
        try:
            return fn()
        except sqlite3.OperationalError as e:
            last = e
            if "locked" not in str(e) and "busy" not in str(e):
                raise
            try:
                conn_rollback = getattr(fn, "__self__", None)
                if conn_rollback is not None:
                    conn_rollback.rollback()
            except Exception:
                pass
            time.sleep(delay * (i + 1))
    raise last


def init_db():
    """Inisialisasi skema database dan seed data awal."""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = get_db()
    cur = conn.cursor()

    # Agents table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#4ade80',
            state TEXT DEFAULT 'unknown',
            current_room TEXT DEFAULT 'lounge',
            current_task TEXT,
            desk_x INTEGER DEFAULT 0,
            desk_y INTEGER DEFAULT 0,
            description TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Tasks table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'todo',
            priority TEXT DEFAULT 'medium',
            assignee_id TEXT,
            tags TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assignee_id) REFERENCES agents(id) ON DELETE SET NULL
        )
    """)

    # Activities table (log event)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS activities (
            id TEXT PRIMARY KEY,
            agent_id TEXT,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
        )
    """)

    # Calendar events
    cur.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            event_date TEXT NOT NULL,
            event_type TEXT DEFAULT 'task',
            agent_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
        )
    """)

    # Memory / Knowledge entries
    cur.execute("""
        CREATE TABLE IF NOT EXISTS memory_entries (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            tags TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Connected channels
    cur.execute("""
        CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            channel_type TEXT DEFAULT 'telegram',
            status TEXT DEFAULT 'disconnected',
            active_sessions INTEGER DEFAULT 0,
            details TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Ingatan & pikiran tiap agent (membuat mereka punya kesinambungan diri)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS agent_mind (
            agent_id TEXT PRIMARY KEY,
            mood TEXT,
            emotion TEXT,
            thought TEXT,
            action TEXT,
            target TEXT,
            reason TEXT,
            activity TEXT,
            memory TEXT,
            source TEXT,
            model TEXT,
            latency REAL,
            updated_at TEXT
        )
    """)

    # Migrasi: database lama dibuat sebelum kolom hasil AI lengkap ada.
    # Tanpa ini, INSERT dengan kolom baru gagal "no column named emotion".
    _mind_cols = {r["name"] for r in cur.execute("PRAGMA table_info(agent_mind)")}
    for _col, _typ in (("emotion", "TEXT"), ("target", "TEXT"), ("activity", "TEXT"),
                       ("source", "TEXT"), ("model", "TEXT"), ("latency", "REAL")):
        if _col not in _mind_cols:
            cur.execute(f"ALTER TABLE agent_mind ADD COLUMN {_col} {_typ}")

    # Migrasi peran: Vera menjadi Microsoft 365 Specialist. Tim tetap enam
    # orang — tidak ada karakter ketujuh — tetapi satu peran berubah jadi
    # spesialis dokumen (Word/Excel/PowerPoint/PDF + OneDrive).
    cur.execute("""
        UPDATE agents
        SET role = 'Microsoft 365 Specialist',
            specialty = 'ms365',
            description = 'Menyiapkan dokumen Word, Excel, PowerPoint, dan PDF yang rapi, mengelola berkas, serta mengunggahnya ke OneDrive.',
            updated_at = ?
        WHERE id = 'agent-reviewer'
    """, (datetime.now().isoformat(),))

    # Seed data awal (hanya jika database kosong)
    cur.execute("SELECT COUNT(*) AS c FROM agents")
    if cur.fetchone()["c"] == 0:
        seed_data(cur)

    conn.commit()
    conn.close()


def seed_data(cur):
    """Isi data awal: agent tim, tasks, activities, memory, channels."""
    # Agents (tim)
    agents = [
        ("agent-lead", "Aria", "Lead Agent", "#f59e0b", "working",
         "workspace", 110, 220, "Memimpin misi dan mengkoordinasikan seluruh tim."),
        ("agent-eng", "Reza", "Lead Engineer", "#3b82f6", "working",
         "workspace", 250, 220, "Mengubah spesifikasi menjadi task implementasi."),
        ("agent-coder-1", "Nova", "Coder - Frontend", "#a855f7", "working",
         "workspace", 390, 220, "Membangun antarmuka 2D dan komponen UI."),
        ("agent-coder-2", "Pixel", "Coder - Backend", "#10b981", "idle",
         "lounge", 0, 0, "Menulis API server dan database schema."),
        ("agent-researcher", "Sage", "Researcher", "#ec4899", "idle",
         "lounge", 0, 0, "Mengumpulkan informasi dan analisis."),
        ("agent-reviewer", "Vera", "Microsoft 365 Specialist", "#06b6d4", "working",
         "workspace", 530, 220,
         "Menyiapkan dokumen Word, Excel, PowerPoint, dan PDF yang rapi, "
         "mengelola berkas, serta mengunggahnya ke OneDrive."),
    ]
    for a in agents:
        cur.execute("""
            INSERT INTO agents (id, name, role, avatar_color, state,
                                current_room, desk_x, desk_y, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, a)

    # Tasks
    tasks = [
        ("task-1", "Setup dashboard Mission Control",
         "Bangun shell aplikasi, navigasi sidebar, dan layout utama.",
         "done", "high", "agent-eng"),
        ("task-2", "Desain 2D Office pixel-art",
         "Rancang workspace dan lounge dengan sprite pixel-art.",
         "in_progress", "high", "agent-coder-1"),
        ("task-3", "Implementasi REST API agents",
         "Endpoint CRUD agents dengan state mapping ke room.",
         "todo", "high", "agent-coder-2"),
        ("task-4", "Task Board dengan drag-and-drop",
         "Board Kanban: To Do, In Progress, Review, Done.",
         "in_progress", "medium", "agent-coder-1"),
        ("task-5", "Activity feed realtime",
         "Panel log aktivitas yang update otomatis.",
         "todo", "medium", "agent-coder-2"),
        ("task-6", "Memory & knowledge base",
         "Halaman untuk menyimpan catatan dan referensi.",
         "review", "low", "agent-reviewer"),
        ("task-7", "Kalender event terpadu",
         "Jadwal meeting, deadline, dan milestone.",
         "todo", "low", "agent-eng"),
        ("task-8", "Channel status (Telegram)",
         "Tampilkan status koneksi channel messaging.",
         "todo", "medium", "agent-researcher"),
    ]
    for t in tasks:
        cur.execute("""
            INSERT INTO tasks (id, title, description, status, priority, assignee_id)
            VALUES (?, ?, ?, ?, ?, ?)
        """, t)

    # Activities (log)
    now = datetime.now()
    activities = [
        (None, "system", "Mission Control dijalankan di localhost:3000", now - timedelta(minutes=2)),
        ("agent-lead", "state_change", "Aria mulai menerima misi baru", now - timedelta(minutes=5)),
        ("agent-eng", "task_completed", "Reza menyelesaikan task: Setup dashboard", now - timedelta(minutes=8)),
        ("agent-coder-1", "task_started", "Nova mulai: Desain 2D Office pixel-art", now - timedelta(minutes=12)),
        ("agent-reviewer", "review_started", "Vera mereview Memory & knowledge base", now - timedelta(minutes=18)),
        ("agent-coder-2", "status_changed", "Pixel idle, menunggu task berikutnya", now - timedelta(minutes=22)),
        ("agent-researcher", "status_changed", "Sage idle, standby di lounge", now - timedelta(minutes=25)),
        ("agent-lead", "broadcast", "Aria: Tim, fokus ke MVP dulu ya", now - timedelta(minutes=30)),
    ]
    for a in activities:
        aid, atype, msg, ts = a
        cur.execute("""
            INSERT INTO activities (id, agent_id, type, message, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (str(uuid.uuid4()), aid, atype, msg, ts.isoformat()))

    # Memory entries
    memories = [
        ("Konvensi Kode", "Gunakan Python stdlib untuk backend, Vanilla JS untuk frontend. Hindari framework berat untuk MVP.",
         "engineering", "python,javascript,stdlib"),
        ("Style Pixel-Art", "Skala 4x, palet 16 warna, garis tegas, hindari gradient.",
         "design", "pixel-art,ui"),
        ("State Agent", "Working → Workspace, Idle → Lounge, Reviewing → Workspace, Offline → sembunyikan.",
         "engineering", "agents,state"),
        ("Roadmap MVP", "1. Shell 2. Dashboard 3. Agents 4. Task Board 5. Calendar 6. Activity 7. Memory 8. Visual Office",
         "planning", "mvp,roadmap"),
        ("Batasan Demo", "Tidak membuat data palsu. Gunakan Unknown/Not Available bila tidak bisa ditentukan.",
         "policy", "data,integrity"),
    ]
    for m in memories:
        cur.execute("""
            INSERT INTO memory_entries (id, title, content, category, tags)
            VALUES (?, ?, ?, ?, ?)
        """, (str(uuid.uuid4()), *m))

    # Calendar events
    today = datetime.now().date()
    events = [
        ("Standup tim", "Daily standup semua agent", str(today), "meeting", "agent-lead"),
        ("Review MVP", "Review hasil implementasi MVP", str(today + timedelta(days=1)), "review", "agent-reviewer"),
        ("Demo Visual Office", "Demo 2D office kepada user", str(today + timedelta(days=3)), "milestone", "agent-lead"),
        ("Planning iterasi 2", "Diskusi fitur lanjutan", str(today + timedelta(days=7)), "meeting", "agent-eng"),
    ]
    for e in events:
        cur.execute("""
            INSERT INTO events (id, title, description, event_date, event_type, agent_id)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (str(uuid.uuid4()), *e))

    # Channels
    channels = [
        ("ch-telegram", "Telegram Bot", "telegram", "connected", 2,
         "Bot EXELYN-MC aktif di 2 sesi."),
        ("ch-discord", "Discord Webhook", "discord", "disconnected", 0,
         "Belum dikonfigurasi."),
        ("ch-slack", "Slack Workspace", "slack", "not_available", 0,
         "Tidak ada integrasi Slack."),
    ]
    for c in channels:
        cur.execute("""
            INSERT INTO channels (id, name, channel_type, status, active_sessions, details)
            VALUES (?, ?, ?, ?, ?, ?)
        """, c)


# ====================================================================
# HELPER FUNCTIONS
# ====================================================================
def row_to_dict(row):
    """Convert sqlite Row to dict."""
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def rows_to_list(rows):
    """Convert list of sqlite Row to list of dict."""
    return [row_to_dict(r) for r in rows]


def json_response(handler, data, status=200):
    """Kirim response JSON."""
    body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


def read_body(handler):
    """Baca body request sebagai JSON."""
    length = int(handler.headers.get("Content-Length", 0) or 0)
    if length == 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def log_activity(conn, agent_id, activity_type, message):
    """Catat aktivitas ke tabel activities."""
    conn.execute("""
        INSERT INTO activities (id, agent_id, type, message, created_at)
        VALUES (?, ?, ?, ?, ?)
    """, (str(uuid.uuid4()), agent_id, activity_type,
          message, datetime.now().isoformat()))


# ====================================================================
# ROUTE HANDLERS (API)
# ====================================================================
def api_dashboard(handler):
    """Ringkasan metrik untuk halaman Dashboard."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM agents")
    total_agents = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM tasks")
    total_tasks = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM tasks WHERE status='done'")
    done_tasks = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM tasks WHERE status='in_progress'")
    in_progress_tasks = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM tasks WHERE status='todo'")
    todo_tasks = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM tasks WHERE status='review'")
    review_tasks = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM memory_entries")
    memory_count = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM events")
    event_count = cur.fetchone()["c"]

    cur.execute("""
        SELECT state, COUNT(*) AS c FROM agents GROUP BY state
    """)
    state_distribution = rows_to_list(cur.fetchall())

    cur.execute("""
        SELECT a.*, ag.name AS agent_name, ag.avatar_color
        FROM activities a LEFT JOIN agents ag ON a.agent_id = ag.id
        ORDER BY a.created_at DESC LIMIT 8
    """)
    recent_activities = rows_to_list(cur.fetchall())

    cur.execute("""
        SELECT t.*, a.name AS assignee_name, a.avatar_color
        FROM tasks t LEFT JOIN agents a ON t.assignee_id = a.id
        WHERE t.status != 'done'
        ORDER BY
            CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
            t.updated_at DESC
        LIMIT 5
    """)
    upcoming_tasks = rows_to_list(cur.fetchall())

    conn.close()

    progress_pct = round((done_tasks / total_tasks * 100) if total_tasks else 0, 1)
    json_response(handler, {
        "ok": True,
        "data": {
            "summary": {
                "total_agents": total_agents,
                "total_tasks": total_tasks,
                "done_tasks": done_tasks,
                "in_progress_tasks": in_progress_tasks,
                "todo_tasks": todo_tasks,
                "review_tasks": review_tasks,
                "memory_count": memory_count,
                "event_count": event_count,
                "progress_pct": progress_pct,
            },
            "state_distribution": state_distribution,
            "recent_activities": recent_activities,
            "upcoming_tasks": upcoming_tasks,
        }
    })


def attach_mind(agents, cur=None):
    """Lampirkan hasil AI (tabel `agent_mind`) ke daftar agent.

    Keputusan AI — mood, emosi, pikiran, aktivitas, alasan, serta model yang
    memutuskan — disimpan terpisah di `agent_mind`. Tanpa pelampiran ini UI
    tidak punya akses ke apa yang sedang dipikirkan/dirasakan agent, sehingga
    "hasil AI" tampak tidak ada sama sekali.

    `cur` boleh dilewatkan bila pemanggil sudah memegang koneksi sendiri
    (lebih hemat satu koneksi per request).
    """
    own = cur is None
    conn = None
    if own:
        conn = get_db()
        cur = conn.cursor()
    try:
        for a in agents:
            row = cur.execute(
                "SELECT * FROM agent_mind WHERE agent_id = ?", (a.get("id"),)
            ).fetchone()
            a["mind"] = row_to_dict(row) if row else None
    finally:
        if own and conn is not None:
            conn.close()
    return agents


def api_agents_list(handler):
    """List semua agents."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM agents ORDER BY name")
    agents = rows_to_list(cur.fetchall())
    attach_mind(agents, cur)
    conn.close()
    json_response(handler, {"ok": True, "data": agents})


def api_agent_detail(handler, agent_id):
    """Detail satu agent + recent activities."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
    agent = row_to_dict(cur.fetchone())
    if not agent:
        conn.close()
        return json_response(handler, {"ok": False, "error": "Agent tidak ditemukan"}, 404)

    cur.execute("""
        SELECT * FROM activities WHERE agent_id = ?
        ORDER BY created_at DESC LIMIT 10
    """, (agent_id,))
    activities = rows_to_list(cur.fetchall())

    cur.execute("""
        SELECT * FROM tasks WHERE assignee_id = ?
        ORDER BY
            CASE status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1
                        WHEN 'todo' THEN 2 ELSE 3 END,
            updated_at DESC
    """, (agent_id,))
    tasks = rows_to_list(cur.fetchall())
    attach_mind([agent], cur)
    conn.close()
    json_response(handler, {
        "ok": True,
        "data": {"agent": agent, "mind": agent.get("mind"),
                 "activities": activities, "tasks": tasks}
    })


def api_agent_update_state(handler, agent_id):
    """Update state & room agent."""
    body = read_body(handler)
    new_state = body.get("state")
    new_room = body.get("room")
    current_task = body.get("current_task")

    if new_state not in ("working", "idle", "reviewing",
                         "collaborating", "offline", "unknown"):
        return json_response(handler, {"ok": False, "error": "State tidak valid"}, 400)

    # State → room mapping default
    if new_room is None:
        if new_state in ("working", "reviewing", "collaborating"):
            new_room = "workspace"
        elif new_state == "idle":
            new_room = "lounge"
        elif new_state == "offline":
            new_room = "hidden"
        else:
            new_room = "lounge"

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT name FROM agents WHERE id = ?", (agent_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return json_response(handler, {"ok": False, "error": "Agent tidak ditemukan"}, 404)

    # Akhiri transaksi baca sebelum menulis (lihat catatan di api_office_brain)
    conn.commit()

    def _do_update():
        cur.execute("""
            UPDATE agents SET state = ?, current_room = ?, current_task = ?,
                              updated_at = ? WHERE id = ?
        """, (new_state, new_room, current_task, datetime.now().isoformat(), agent_id))
        return True
    db_write(_do_update)

    db_write(lambda: (log_activity(conn, agent_id, "state_change",
                 f"{row['name']} berubah ke state '{new_state}' di {new_room}"), True)[1])
    db_write(conn.commit)
    conn.close()
    json_response(handler, {"ok": True, "data": {"state": new_state, "room": new_room}})


def api_tasks_list(handler):
    """List semua tasks, bisa filter ?status="""""
    qs = parse_qs(urlparse(handler.path).query)
    status_filter = qs.get("status", [None])[0]
    conn = get_db()
    cur = conn.cursor()
    if status_filter:
        cur.execute("""
            SELECT t.*, a.name AS assignee_name, a.avatar_color
            FROM tasks t LEFT JOIN agents a ON t.assignee_id = a.id
            WHERE t.status = ?
            ORDER BY
                CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                t.updated_at DESC
        """, (status_filter,))
    else:
        cur.execute("""
            SELECT t.*, a.name AS assignee_name, a.avatar_color
            FROM tasks t LEFT JOIN agents a ON t.assignee_id = a.id
            ORDER BY
                CASE t.status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1
                              WHEN 'todo' THEN 2 ELSE 3 END,
                CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                t.updated_at DESC
        """)
    tasks = rows_to_list(cur.fetchall())
    conn.close()
    json_response(handler, {"ok": True, "data": tasks})


def api_task_create(handler):
    """Buat task baru."""
    body = read_body(handler)
    title = (body.get("title") or "").strip()
    if not title:
        return json_response(handler, {"ok": False, "error": "Judul task wajib"}, 400)

    task_id = "task-" + str(uuid.uuid4())[:8]
    status = body.get("status", "todo")
    priority = body.get("priority", "medium")
    description = body.get("description", "")
    assignee_id = body.get("assignee_id")
    tags = body.get("tags", "")

    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO tasks (id, title, description, status, priority,
                          assignee_id, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (task_id, title, description, status, priority, assignee_id, tags))

    log_activity(conn, assignee_id, "task_created",
                 f"Task baru: {title}")
    conn.commit()
    conn.close()
    json_response(handler, {"ok": True, "data": {"id": task_id}})


def api_task_update(handler, task_id):
    """Update task (status / priority / fields)."""
    body = read_body(handler)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
    existing = row_to_dict(cur.fetchone())
    if not existing:
        conn.close()
        return json_response(handler, {"ok": False, "error": "Task tidak ditemukan"}, 404)

    fields = []
    values = []
    for k in ("title", "description", "status", "priority", "assignee_id", "tags"):
        if k in body:
            fields.append(f"{k} = ?")
            values.append(body[k])
    fields.append("updated_at = ?")
    values.append(datetime.now().isoformat())
    values.append(task_id)

    cur.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", values)

    # Activity log untuk perubahan penting
    if "status" in body and body["status"] != existing["status"]:
        log_activity(conn, existing["assignee_id"], "task_status_changed",
                     f"Task '{existing['title']}' → {body['status']}")
    conn.commit()
    conn.close()
    json_response(handler, {"ok": True})


def api_task_delete(handler, task_id):
    """Hapus task."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT title, assignee_id FROM tasks WHERE id = ?", (task_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return json_response(handler, {"ok": False, "error": "Task tidak ditemukan"}, 404)
    cur.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    log_activity(conn, row["assignee_id"], "task_deleted",
                 f"Task dihapus: {row['title']}")
    conn.commit()
    conn.close()
    json_response(handler, {"ok": True})


def api_activities_list(handler):
    """List activities (paginated sederhana)."""
    qs = parse_qs(urlparse(handler.path).query)
    limit = int(qs.get("limit", ["50"])[0])
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT a.*, ag.name AS agent_name, ag.avatar_color
        FROM activities a LEFT JOIN agents ag ON a.agent_id = ag.id
        ORDER BY a.created_at DESC LIMIT ?
    """, (limit,))
    activities = rows_to_list(cur.fetchall())
    conn.close()
    json_response(handler, {"ok": True, "data": activities})


def api_calendar_list(handler):
    """List calendar events."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT e.*, a.name AS agent_name, a.avatar_color
        FROM events e LEFT JOIN agents a ON e.agent_id = a.id
        ORDER BY e.event_date ASC
    """)
    events = rows_to_list(cur.fetchall())
    conn.close()
    json_response(handler, {"ok": True, "data": events})


def api_memory_list(handler):
    """List memory / knowledge entries."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM memory_entries ORDER BY updated_at DESC")
    entries = rows_to_list(cur.fetchall())
    conn.close()
    json_response(handler, {"ok": True, "data": entries})


def api_memory_create(handler):
    """Tambah entry memory baru."""
    body = read_body(handler)
    title = (body.get("title") or "").strip()
    content = (body.get("content") or "").strip()
    if not title or not content:
        return json_response(handler, {"ok": False, "error": "Title & content wajib"}, 400)
    category = body.get("category", "general")
    tags = body.get("tags", "")

    entry_id = "mem-" + str(uuid.uuid4())[:8]
    conn = get_db()
    conn.execute("""
        INSERT INTO memory_entries (id, title, content, category, tags)
        VALUES (?, ?, ?, ?, ?)
    """, (entry_id, title, content, category, tags))
    log_activity(conn, None, "memory_added", f"Memory baru: {title}")
    conn.commit()
    conn.close()
    json_response(handler, {"ok": True, "data": {"id": entry_id}})


def api_memory_delete(handler, entry_id):
    """Hapus memory entry."""
    conn = get_db()
    conn.execute("DELETE FROM memory_entries WHERE id = ?", (entry_id,))
    conn.commit()
    conn.close()
    json_response(handler, {"ok": True})


def api_channels_list(handler):
    """List connected channels."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM channels ORDER BY name")
    channels = rows_to_list(cur.fetchall())
    conn.close()
    json_response(handler, {"ok": True, "data": channels})


def api_office_state(handler):
    """Data untuk 2D office: agent + task nyata + ruangan."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, name, role, avatar_color, state, current_room,
               current_task, description
        FROM agents
        WHERE state != 'offline'
        ORDER BY name
    """)
    agents = rows_to_list(cur.fetchall())
    attach_mind(agents, cur)

    # Lengkapi current_task dari tabel tasks (data nyata, bukan simulasi)
    for a in agents:
        if a.get("current_task"):
            continue
        cur.execute("""
            SELECT title, status FROM tasks
            WHERE assignee_id = ? AND status IN ('in_progress', 'review')
            ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END
            LIMIT 1
        """, (a["id"],))
        row = cur.fetchone()
        if row:
            a["current_task"] = row["title"]
            a["current_task_status"] = row["status"]

    cur.execute("""
        SELECT a.*, ag.name AS agent_name, ag.avatar_color
        FROM activities a LEFT JOIN agents ag ON a.agent_id = ag.id
        ORDER BY a.created_at DESC LIMIT 6
    """)
    recent = rows_to_list(cur.fetchall())

    # Data task nyata — dipakai sebagai bahan obrolan agent di Workspace
    cur.execute("""
        SELECT t.id, t.title, t.status, t.priority, t.assignee_id,
               ag.name AS assignee_name
        FROM tasks t LEFT JOIN agents ag ON t.assignee_id = ag.id
        ORDER BY
            CASE t.status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1
                          WHEN 'todo' THEN 2 ELSE 3 END,
            CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
    """)
    tasks = rows_to_list(cur.fetchall())

    cur.execute("SELECT COUNT(*) AS c FROM tasks")
    total_tasks = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM tasks WHERE status='done'")
    done_tasks = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM tasks WHERE status='in_progress'")
    in_progress_tasks = cur.fetchone()["c"]

    conn.close()
    json_response(handler, {
        "ok": True,
        "data": {
            "agents": agents,
            "tasks": tasks,
            "task_summary": {
                "total": total_tasks,
                "done": done_tasks,
                "in_progress": in_progress_tasks,
            },
            "rooms": [
                {"id": "workspace", "name": "Workspace",
                 "description": "Area kerja utama. Agent yang sedang bekerja duduk di meja masing-masing."},
                {"id": "lounge", "name": "Lounge",
                 "description": "Area istirahat. Agent idle mengobrol santai, ngopi, atau bersantai di sini."},
            ],
            "recent_activities": recent,
        }
    })


def api_office_dialogue(handler):
    """
    Hasilkan dialog antar dua agent MENGGUNAKAN MODEL AI.

    Data konteks diambil dari DATABASE (bukan dari klien) supaya isi obrolan
    benar-benar mencerminkan progres yang sedang berjalan.
    """
    body = read_body(handler)
    a_id = body.get("a")
    b_id = body.get("b")
    room = body.get("room", "workspace")
    kind = body.get("kind") or "chat"
    if kind not in ("chat", "greet", "invite", "work"):
        kind = "chat"
    if room not in ("workspace", "lounge", "meeting", "pantry", "garden"):
        room = "workspace"

    conn = get_db()
    cur = conn.cursor()

    def load_agent(aid):
        if not aid:
            return None
        cur.execute(
            "SELECT id, name, role, state, current_task FROM agents WHERE id = ?",
            (aid,))
        row = cur.fetchone()
        return row_to_dict(row) if row else None

    a = load_agent(a_id)
    b = load_agent(b_id)
    if not a or not b:
        conn.close()
        return json_response(
            handler, {"ok": False, "error": "Agent tidak ditemukan"}, 404)

    # Lengkapi tugas nyata tiap agent bila belum terisi
    for ag in (a, b):
        if ag.get("current_task"):
            continue
        cur.execute("""
            SELECT title FROM tasks
            WHERE assignee_id = ? AND status IN ('in_progress', 'review')
            ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END
            LIMIT 1
        """, (ag["id"],))
        row = cur.fetchone()
        if row:
            ag["current_task"] = row["title"]

    # Daftar pekerjaan: HANYA yang masih terbuka, TERBARU lebih dulu.
    # Ini yang membuat agent membahas data yang baru terdeteksi, bukan
    # pekerjaan yang sudah selesai.
    cur.execute("""
        SELECT t.title, t.status, t.created_at, ag.name AS owner
        FROM tasks t LEFT JOIN agents ag ON t.assignee_id = ag.id
        WHERE t.status IN ('in_progress', 'review', 'todo')
        ORDER BY t.created_at DESC, t.rowid DESC
        LIMIT 5
    """)
    tasks = rows_to_list(cur.fetchall())

    # Fokus utama = pekerjaan termuda yang masih berjalan
    focus = None
    if tasks:
        focus = {
            "title": tasks[0]["title"],
            "status": tasks[0]["status"],
            "owner": tasks[0].get("owner"),
        }

    # Perubahan terakhir yang benar-benar terdeteksi di kantor
    cur.execute("""
        SELECT message FROM activities
        WHERE type IN ('cli_change', 'file_change', 'task_done', 'state_sync')
        ORDER BY created_at DESC LIMIT 6
    """)
    recent_changes = [r["message"] for r in cur.fetchall()]

    # Ingatan & pikiran tiap agent (kesinambungan diri mereka)
    memory = {}
    cur.execute("SELECT agent_id, mood, thought, memory FROM agent_mind")
    for r in cur.fetchall():
        memory[r["agent_id"]] = {
            "mood": r["mood"],
            "thought": r["thought"],
            "lines": [m for m in (r["memory"] or "").split("\u2028") if m][-4:],
        }

    cur.execute("SELECT COUNT(*) AS c FROM tasks")
    total = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM tasks WHERE status = 'done'")
    done = cur.fetchone()["c"]
    cur.execute("SELECT COUNT(*) AS c FROM tasks WHERE status = 'in_progress'")
    in_progress = cur.fetchone()["c"]
    conn.close()

    def agent_ctx(ag):
        mem = memory.get(ag["id"], {})
        return {
            "name": ag["name"], "role": ag["role"], "state": ag["state"],
            "task": ag.get("current_task"),
            "specialty": ag.get("specialty"),
            "persona": ai_dialogue.persona_for(ag),
            "memory": mem.get("lines", []),
            "mood": mem.get("mood"),
        }

    ctx = {
        "room": room,
        "kind": kind,
        "a": agent_ctx(a),
        "b": agent_ctx(b),
        "tasks": tasks,
        "focus": focus,
        "recent_changes": recent_changes,
        "summary": {"total": total, "done": done, "in_progress": in_progress},
    }

    result = ai_dialogue.generate(ctx)
    result["room"] = room
    result["kind"] = kind
    result["pair"] = [a["id"], b["id"]]
    result["focus"] = focus
    json_response(handler, {"ok": True, "data": result})


def api_office_brain(handler):
    """
    Otak mandiri para agent.

    Setiap agent memutuskan SENDIRI apa yang dia lakukan dan pikirkan memakai
    model AI + data nyata terbaru (bukan aturan tetap di kode). Keputusan itu
    disimpan sebagai ingatan di tabel agent_mind, sehingga tiap agent punya
    kesinambungan diri dan tidak perlu disuruh.
    """
    body = read_body(handler)
    req_agents = body.get("agents") or []
    if not isinstance(req_agents, list) or not req_agents:
        json_response(handler, {"ok": False, "error": "Daftar agent kosong"}, 400)
        return

    conn = get_db()
    cur = conn.cursor()

    # Fokus = pekerjaan termuda yang masih terbuka (bukan yang sudah selesai)
    cur.execute("""
        SELECT t.title, t.status, ag.name AS owner
        FROM tasks t LEFT JOIN agents ag ON t.assignee_id = ag.id
        WHERE t.status IN ('in_progress', 'review', 'todo')
        ORDER BY t.created_at DESC, t.rowid DESC LIMIT 1
    """)
    row = cur.fetchone()
    focus = dict(row) if row else None

    cur.execute("""
        SELECT title FROM tasks WHERE status IN ('in_progress', 'review', 'todo')
        ORDER BY created_at DESC LIMIT 5
    """)
    open_tasks = [r["title"] for r in cur.fetchall()]

    cur.execute("""
        SELECT message FROM activities
        WHERE type IN ('cli_change', 'file_change', 'task_done')
        ORDER BY created_at DESC LIMIT 5
    """)
    recent = [r["message"] for r in cur.fetchall()]

    cur.execute("SELECT id, name, role, state, current_task, specialty FROM agents")
    all_agents = {r["id"]: dict(r) for r in cur.fetchall()}

    # Akhiri transaksi BACA sebelum menulis. Tanpa ini, SQLite menolak
    # "upgrade" kunci baca→tulis dengan SQLITE_BUSY seketika, dan busy_timeout
    # tidak berlaku untuk kasus itu (inilah sisa "database is locked").
    conn.commit()

    decisions = []
    for item in req_agents[:4]:
        aid = item.get("id") if isinstance(item, dict) else item
        ag = all_agents.get(aid)
        if not ag:
            continue
        room = (item.get("room") if isinstance(item, dict) else None) or "workspace"

        cur.execute("SELECT memory FROM agent_mind WHERE agent_id = ?", (aid,))
        m = cur.fetchone()
        mem_lines = [x for x in ((m["memory"] if m else "") or "").split("\u2028") if x][-4:]

        res = ai_dialogue.think({
            "agent": {
                "name": ag["name"], "role": ag["role"], "state": ag["state"],
                "task": ag["current_task"], "specialty": ag["specialty"],
                "persona": ai_dialogue.persona_for(ag),
            },
            "focus": focus,
            "recent_changes": recent,
            "open_tasks": open_tasks,
            "peers": [x["name"] for x in all_agents.values() if x["id"] != aid][:5],
            "peer_states": [
                {"state": x["state"], "task": x["current_task"],
                 "specialty": x.get("specialty")}
                for x in all_agents.values() if x["id"] != aid
            ][:5],
            "room": room,
        })

        if res.get("thought"):
            mem_lines = (mem_lines + [res["thought"]])[-6:]
        def _save_mind(aid=aid, res=res, mem_lines=mem_lines):
            cur.execute("""
                INSERT INTO agent_mind
                    (agent_id, mood, emotion, thought, action, target, reason,
                     activity, memory, source, model, latency, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET
                    mood = excluded.mood, emotion = excluded.emotion,
                    thought = excluded.thought, action = excluded.action,
                    target = excluded.target, reason = excluded.reason,
                    activity = excluded.activity, memory = excluded.memory,
                    source = excluded.source, model = excluded.model,
                    latency = excluded.latency, updated_at = excluded.updated_at
            """, (aid, res.get("mood"), res.get("emotion") or res.get("mood"),
                  res.get("thought"), res.get("action"), res.get("target"),
                  res.get("reason"), res.get("activity"), "\u2028".join(mem_lines),
                  res.get("source"), res.get("model"), res.get("latency"),
                  datetime.now().isoformat()))
            return True
        db_write(_save_mind)

        decisions.append({"id": aid, "room": room, **res})

    db_write(conn.commit)
    conn.close()
    json_response(handler, {"ok": True,
                            "data": {"decisions": decisions, "focus": focus}})


def api_chat_status(handler):
    """Kemampuan menu chat: mesin balasan agen + ketersediaan Hermes."""
    import agents_chat
    json_response(handler, {"ok": True, "data": agents_chat.status()})


def api_chat_send(handler):
    """
    Terima pesan dari menu chat.

    Bila pesan menyebut nama agen, agen itu menjawab dengan model AI nyata
    dan hasilnya siap ditampilkan sebagai gelembung di kantor 2D.
    Bila tidak ada nama agen dan pengguna memilih mode CLI, seluruh kemampuan
    CLI EXELYN AGENT AI dijalankan lewat `hermes -z`.
    """
    import agents_chat
    body = read_body(handler)
    message = str(body.get("message") or "").strip()
    if not message:
        json_response(handler, {"ok": False, "error": "Pesan kosong."}, 400)
        return
    if len(message) > 4000:
        json_response(handler, {"ok": False, "error": "Pesan terlalu panjang (maks 4000)."}, 400)
        return

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id, name, role, specialty, state, current_task, "
                "current_room, description FROM agents ORDER BY name")
    agents = rows_to_list(cur.fetchall())
    conn.close()

    try:
        result = agents_chat.handle_message(
            message, agents,
            selected_agent_id=body.get("agent_id"),
            workdir=body.get("workdir"),
            prefer_cli=bool(body.get("prefer_cli")),
        )
    except agents_chat.ChatError as exc:
        json_response(handler, {"ok": False, "error": str(exc), "code": exc.code,
                                "hint": exc.hint}, 400)
        return
    except Exception as exc:                                    # pragma: no cover
        json_response(handler, {"ok": False,
                                "error": f"Kesalahan internal: {exc}"}, 500)
        return

    json_response(handler, {"ok": True, "data": result})


def api_ms365_status(handler):
    """Status kapabilitas Microsoft 365 Specialist."""
    import ms365
    try:
        json_response(handler, {"ok": True, "data": ms365.status()})
    except Exception as exc:
        json_response(handler, {"ok": False, "error": str(exc)}, 500)


def api_ms365_create(handler):
    """
    Buat dokumen nyata dari spesifikasi lalu (opsional) unggah ke OneDrive.

    Tidak ada respons sukses tanpa berkas nyata yang terverifikasi.
    """
    import ms365
    body = read_body(handler)
    spec = body.get("spec") or body.get("document") or body
    if not isinstance(spec, dict) or not spec:
        json_response(handler, {"ok": False, "error": "Spec dokumen tidak valid."}, 400)
        return

    upload = body.get("upload", True)
    if isinstance(upload, str):
        upload = upload.lower() not in ("0", "false", "no")

    try:
        result = ms365.deliver(spec, upload=bool(upload))
    except ms365.Ms365Error as exc:
        json_response(handler, {"ok": False, "error": str(exc), "code": exc.code,
                                "hint": exc.hint}, 400)
        return
    except Exception as exc:                                    # pragma: no cover
        json_response(handler, {"ok": False,
                                "error": f"Kesalahan internal: {exc}"}, 500)
        return

    json_response(handler, {"ok": True, "data": result})


def api_ms365_files(handler):
    """Daftar berkas nyata di folder OneDrive (bukti, bukan karangan)."""
    import ms365
    try:
        json_response(handler, {"ok": True, "data": ms365.list_onedrive()})
    except ms365.Ms365Error as exc:
        json_response(handler, {"ok": False, "error": str(exc), "code": exc.code}, 400)


def api_ai_stats(handler):
    """Statistik mesin dialog AI (untuk pemantauan)."""
    json_response(handler, {
        "ok": True,
        "data": {
            "stats": ai_dialogue.stats,
            "models": ai_dialogue.MODEL_CHAIN,
            "recent_lines": ai_dialogue.recent_lines_snapshot(15),
            "key_available": bool(ai_dialogue._load_api_key()),
        }
    })


def api_cli_sync(handler):
    """Sinkronkan aktivitas EXELYN CLI → Task Board (dipanggil manual)."""
    conn = get_db()
    try:
        result = cli_bridge.sync(conn)
    finally:
        conn.close()
    json_response(handler, {"ok": True, "data": result})


def api_cli_status(handler):
    """Status jembatan CLI."""
    conn = get_db()
    try:
        data = cli_bridge.status(conn)
    finally:
        conn.close()
    json_response(handler, {"ok": True, "data": data})


# ====================================================================
# PEMANTAU AKTIVITAS CLI (latar belakang)
# ====================================================================
def cli_watcher(stop_event, interval=20):
    """
    Memantau aktivitas EXELYN CLI secara berkala dan menambahkannya ke
    Task Board. Berjalan di thread terpisah, hanya membaca berkas.
    """
    while not stop_event.is_set():
        # Coba beberapa kali dengan jeda singkat. Kalau penulisan lain sedang
        # memegang kunci, sinkronisasi tidak perlu menunggu satu siklus penuh
        # (20 detik) — cukup tunggu sebentar lalu coba lagi.
        #
        # Penting: koneksi di-ROLLBACK sebelum dicoba lagi. Tanpa rollback,
        # transaksi tulis yang gagal tetap terbuka dan memblokir percobaan
        # berikutnya ("database is locked" berulang sampai menyerah).
        done = False
        last_err = None
        for attempt in range(6):
            conn = get_db()
            try:
                result = cli_bridge.sync(conn)
                if result.get("created"):
                    for t in result["titles"]:
                        print(f"[cli-bridge] task baru dari CLI: {t}")
                done = True
                break
            except sqlite3.OperationalError as e:
                last_err = e
                try:
                    conn.rollback()
                except Exception:
                    pass
                if "locked" not in str(e) and "busy" not in str(e):
                    break
                stop_event.wait(1.5 * (attempt + 1))
            except Exception as e:
                last_err = e
                try:
                    conn.rollback()
                except Exception:
                    pass
                break
            finally:
                conn.close()
        if not done and last_err is not None:
            print(f"[cli-bridge] gagal sinkron: {last_err}")
        stop_event.wait(interval)


# ====================================================================
# STATIC FILE SERVING
# ====================================================================
def serve_static(handler, path):
    """Serve file statis dari folder static/ atau templates/."""
    # Normalisasi path
    path = path.lstrip("/")
    if path.startswith("static/"):
        full = os.path.join(STATIC_DIR, path[len("static/"):])
    elif path.startswith("templates/"):
        full = os.path.join(TEMPLATES_DIR, path[len("templates/"):])
    else:
        full = os.path.join(STATIC_DIR, path)

    # Security: cegah path traversal
    full = os.path.normpath(full)
    if not (full.startswith(STATIC_DIR) or full.startswith(TEMPLATES_DIR)):
        handler.send_error(403)
        return

    if not os.path.isfile(full):
        handler.send_error(404)
        return

    ctype, _ = mimetypes.guess_type(full)
    if ctype is None:
        ctype = "application/octet-stream"

    with open(full, "rb") as f:
        data = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text") else ""))
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-cache")
    handler.end_headers()
    handler.wfile.write(data)


def serve_index(handler):
    """Serve halaman index.html."""
    full = os.path.join(TEMPLATES_DIR, "index.html")
    with open(full, "rb") as f:
        data = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


# ====================================================================
# HTTP REQUEST HANDLER
# ====================================================================
class MissionControlHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        """Custom log format."""
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {fmt % args}")

    def _route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        parts = [p for p in path.split("/") if p]

        # Root → index.html
        if path == "/" or path == "":
            serve_index(self)
            return True

        # API routes
        if parts and parts[0] == "api":
            if method != "GET" and method != "POST" and method != "PUT" and method != "DELETE":
                json_response(self, {"ok": False, "error": "Method tidak diizinkan"}, 405)
                return True

            try:
                if path == "/api/dashboard":
                    api_dashboard(self)
                elif path == "/api/agents":
                    api_agents_list(self)
                elif len(parts) >= 3 and parts[1] == "agents":
                    agent_id = parts[2]
                    if method == "GET":
                        api_agent_detail(self, agent_id)
                    elif method == "POST" and len(parts) >= 4 and parts[3] == "state":
                        api_agent_update_state(self, agent_id)
                    else:
                        json_response(self, {"ok": False, "error": "Not found"}, 404)

                elif path == "/api/tasks":
                    if method == "GET":
                        api_tasks_list(self)
                    elif method == "POST":
                        api_task_create(self)
                elif len(parts) >= 3 and parts[1] == "tasks":
                    task_id = parts[2]
                    if method == "PUT":
                        api_task_update(self, task_id)
                    elif method == "DELETE":
                        api_task_delete(self, task_id)
                    else:
                        json_response(self, {"ok": False, "error": "Not found"}, 404)

                elif path == "/api/activities":
                    api_activities_list(self)
                elif path == "/api/calendar":
                    api_calendar_list(self)
                elif path == "/api/memory":
                    if method == "GET":
                        api_memory_list(self)
                    elif method == "POST":
                        api_memory_create(self)
                elif len(parts) >= 3 and parts[1] == "memory":
                    entry_id = parts[2]
                    if method == "DELETE":
                        api_memory_delete(self, entry_id)
                    else:
                        json_response(self, {"ok": False, "error": "Not found"}, 404)

                elif path == "/api/channels":
                    api_channels_list(self)
                elif path == "/api/office":
                    api_office_state(self)
                elif path == "/api/office/dialogue":
                    if method == "POST":
                        api_office_dialogue(self)
                    else:
                        json_response(self, {"ok": False, "error": "Gunakan POST"}, 405)
                elif path == "/api/office/brain":
                    if method == "POST":
                        api_office_brain(self)
                    else:
                        json_response(self, {"ok": False, "error": "Gunakan POST"}, 405)
                elif path == "/api/chat/send":
                    if method == "POST":
                        api_chat_send(self)
                    else:
                        json_response(self, {"ok": False, "error": "Gunakan POST"}, 405)
                elif path == "/api/ms365/create":
                    if method == "POST":
                        api_ms365_create(self)
                    else:
                        json_response(self, {"ok": False, "error": "Gunakan POST"}, 405)
                elif path == "/api/office/ai-stats":
                    api_ai_stats(self)
                elif path == "/api/chat/status":
                    api_chat_status(self)
                elif path == "/api/ms365/status":
                    api_ms365_status(self)
                elif path == "/api/ms365/files":
                    api_ms365_files(self)
                elif path == "/api/cli/status":
                    api_cli_status(self)
                elif path == "/api/cli/sync":
                    if method == "POST":
                        api_cli_sync(self)
                    else:
                        json_response(self, {"ok": False, "error": "Gunakan POST"}, 405)
                else:
                    json_response(self, {"ok": False, "error": "Not found"}, 404)
            except Exception as e:
                import traceback
                traceback.print_exc()
                json_response(self, {"ok": False, "error": str(e)}, 500)
            return True

        # Static files
        serve_static(self, path)
        return True

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    def do_DELETE(self):
        self._route("DELETE")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


class ThreadedServer(ThreadingHTTPServer):
    """Server yang handle multiple request secara paralel (Python 3.7+)."""
    daemon_threads = True


# ====================================================================
# MAIN
# ====================================================================
def main():
    import argparse
    # Host/port bisa dari environment variable — diperlukan oleh platform
    # hosting (Railway/Vercel menyet PORT sendiri).
    env_port = os.environ.get("PORT")
    env_host = os.environ.get("HOST")
    parser = argparse.ArgumentParser(description="Mission Control 2D - Local Server")
    parser.add_argument("--host", default=env_host or "127.0.0.1",
                        help="Host (default: env HOST atau 127.0.0.1)")
    parser.add_argument("--port", type=int,
                        default=int(env_port) if env_port else 3000,
                        help="Port (default: env PORT atau 3000)")
    args = parser.parse_args()

    init_db()

    # Jembatan CLI: sinkronkan sekali saat mulai, lalu pantau berkala.
    try:
        _conn = get_db()
        try:
            _first = cli_bridge.sync(_conn)
        finally:
            _conn.close()
        print(f"[cli-bridge] sinkron awal: {_first.get('created', 0)} task baru "
              f"dari {_first.get('scanned', 0)} aktivitas CLI")
    except Exception as _e:
        print(f"[cli-bridge] sinkron awal gagal: {_e}")

    import threading
    stop_event = threading.Event()
    watcher = threading.Thread(target=cli_watcher, args=(stop_event, 20), daemon=True)
    watcher.start()

    server = ThreadedServer((args.host, args.port), MissionControlHandler)
    print("=" * 60)
    print("  MISSION CONTROL 2D - SERVER BERJALAN")
    print("=" * 60)
    print(f"  Alamat    : http://{args.host}:{args.port}")
    print(f"  Database  : {DB_PATH}")
    print(f"  Static    : {STATIC_DIR}")
    print(f"  Templates : {TEMPLATES_DIR}")
    print("=" * 60)
    print("  Tekan CTRL+C untuk停止 server")
    print("=" * 60)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")
        server.shutdown()


if __name__ == "__main__":
    main()
