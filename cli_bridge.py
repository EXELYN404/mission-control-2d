#!/usr/bin/env python3
"""
Activity Bridge — Mission Control 2D
====================================
Menghubungkan SEMUA perubahan nyata di lingkungan EXELYN AGENT AI ke
Mission Control, sehingga Task Board dan Visual 2D Office tidak perlu diisi
manual lagi.

Sumber yang dipantau (semuanya hanya DIBACA):
  1. Riwayat permintaan CLI  — ~/.hermes/.hermes_history
  2. Perubahan berkas proyek — ~/mission-control-2d (kode, tampilan, dokumentasi)
  3. Perubahan skill         — ~/.hermes/skills
  4. Perubahan cron job      — ~/.hermes/cron

Aturan kerja:
- Setiap perubahan dicatat sebagai AKTIVITAS (agar semuanya terbaca di feed).
- Perubahan yang berarti juga dibuatkan TASK, lalu ditugaskan ke agent yang
  BIDANGNYA cocok (frontend / backend / research / review / ops / lead).
- Status agent dihitung ulang dari task nyata: agent hanya "bekerja" kalau ada
  pekerjaan di bidangnya; kalau tidak ada, dia idle dan berkeliaran.
- Idempoten: setiap perubahan dikenali lewat hash, jadi tidak pernah dobel.
"""

import hashlib
import os
import re
import time
import uuid
from datetime import datetime, timedelta

# ------------------------------------------------------------------
# SUMBER PERUBAHAN
# ------------------------------------------------------------------
HISTORY_PATH = os.path.expanduser("~/.hermes/.hermes_history")

WATCHED = [
    {
        "id": "project",
        "path": os.path.expanduser("~/mission-control-2d"),
        "exts": (".py", ".js", ".css", ".html", ".md", ".json"),
        "label": "Proyek",
        "skip_dirs": ("data", "node_modules", ".git", "__pycache__"),
    },
    {
        "id": "skills",
        "path": os.path.expanduser("~/.hermes/skills"),
        "exts": (".md",),
        "label": "Skill",
        "skip_dirs": (".git", "__pycache__"),
    },
    {
        "id": "cron",
        "path": os.path.expanduser("~/.hermes/cron"),
        "exts": (".json", ".yaml", ".yml", ".md"),
        "label": "Cron",
        "skip_dirs": (),
    },
]

# Berapa lama ke belakang perubahan dianggap "baru" saat pertama dipindai
RECENT_WINDOW_MIN = 180

# Jumlah maksimum task baru per sinkronisasi
MAX_NEW_TASKS = 6

KEEP_ACTIVE = 2

SKIP_PREFIXES = ("/", "#", "!", "$")


# ------------------------------------------------------------------
# BIDANG KEAHLIAN
# ------------------------------------------------------------------
DEFAULT_SPECIALTY = {
    "agent-lead": "lead",
    "agent-eng": "backend",
    "agent-coder-1": "frontend",
    "agent-coder-2": "backend",
    "agent-researcher": "research",
    "agent-reviewer": "review",
}

SPECIALTY_LABEL = {
    "lead": "Koordinator",
    "frontend": "Frontend / Tampilan",
    "backend": "Backend / Data",
    "research": "Riset",
    "review": "Review & Uji",
    "ops": "Operasional",
}

SPECIALTY_KEYWORDS = {
    "frontend": [
        "tampilan", "tampil", "ui", "ux", "css", "frontend", "office", "2d",
        "kamera", "ruangan", "visual", "pixel", "animasi", "dekor", "warna",
        "gerak", "obrolan", "dialog", "karakter", "bubble", "sprite", "desain",
        "meja", "lantai", "halaman", "layout", "gambar", "peta",
    ],
    "backend": [
        "api", "server", "endpoint", "database", "db", "sqlite", "python",
        "backend", "rest", "cli", "bridge", "sinkron", "json",
        "otomatis", "data", "integrasi", "jembatan", "fungsi", "logika",
    ],
    "research": [
        "riset", "research", "cari", "banding", "analisis", "prompt", "dokumen",
        "referensi", "studi", "evaluasi", "opsi", "model gratis", "cari tahu",
        "gratis", "pilih", "bandingkan", "rekomendasi", "riset kecil",
    ],
    "review": [
        "review", "uji", "test", "periksa", "bug", "error", "validasi", "qa",
        "cek", "perbaikan", "perbaiki", "salah", "rusak", "blank", "gagal",
    ],
    "ops": [
        "install", "jalankan", "port", "localhost", "deploy", "cron", "setup",
        "konfigurasi", "matikan", "jalankan project", "server aktif", "daemon",
    ],
}

SPECIALTY_BY_EXT = {
    ".css": "frontend",
    ".html": "frontend",
    ".js": "frontend",
    ".py": "backend",
    ".json": "backend",
    ".md": "research",
}


def classify(text, default="backend"):
    """Tentukan bidang keahlian yang paling cocok untuk sebuah teks."""
    low = " " + re.sub(r"\s+", " ", str(text or "").lower()) + " "
    best, best_score = default, 0
    for spec, words in SPECIALTY_KEYWORDS.items():
        score = sum(1 for w in words if w in low)
        if score > best_score:
            best, best_score = spec, score
    return best


# ------------------------------------------------------------------
# UTIL
# ------------------------------------------------------------------
def _clean(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _hash(text):
    return hashlib.sha1(_clean(text).encode("utf-8", "replace")).hexdigest()[:16]


def _make_title(text, limit=72):
    t = _clean(text)
    t = re.sub(r"^(tolong|coba|mohon|silakan|please)\s+", "", t, flags=re.I)
    t = re.sub(r"^(perbaikan|perbaiki|buat|buatkan|tambahkan|ubah)\s*[:\-]?\s*", "",
               t, flags=re.I)
    if len(t) > limit:
        cut = t[:limit]
        if " " in cut:
            cut = cut[:cut.rfind(" ")]
        t = cut.rstrip(",;:") + "…"
    return t or "Perubahan terdeteksi"


# ------------------------------------------------------------------
# SUMBER 1: RIWAYAT CLI
# ------------------------------------------------------------------
def parse_history(raw):
    entries = []
    current = None
    for line in raw.splitlines():
        if line.startswith("# "):
            if current and current["text"]:
                entries.append(current)
            current = {"ts": line[2:].strip(), "text": ""}
            continue
        if current is None:
            continue
        body = line[1:] if line.startswith("+") else line
        if body.strip():
            current["text"] = (current["text"] + " " + body).strip()
    if current and current["text"]:
        entries.append(current)

    out = []
    for e in entries:
        text = _clean(e["text"])
        if not text or text.startswith(SKIP_PREFIXES):
            continue
        out.append({"ts": e["ts"], "text": text})
    return out


def read_history():
    if not os.path.exists(HISTORY_PATH):
        return []
    try:
        with open(HISTORY_PATH, encoding="utf-8", errors="replace") as f:
            return parse_history(f.read())
    except Exception:
        return []


# ------------------------------------------------------------------
# SUMBER 2-4: PERUBAHAN BERKAS
# ------------------------------------------------------------------
def scan_files(source):
    """Kembalikan daftar berkas + sidik jari (mtime, ukuran) untuk satu sumber."""
    root = source["path"]
    if not os.path.isdir(root):
        return {}
    found = {}
    skip = set(source.get("skip_dirs", ()))
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip and not d.startswith(".")]
        for fn in filenames:
            if not fn.endswith(source["exts"]):
                continue
            full = os.path.join(dirpath, fn)
            try:
                st = os.stat(full)
            except OSError:
                continue
            rel = os.path.relpath(full, root)
            found[rel] = (int(st.st_mtime), st.st_size)
    return found


def _fingerprint(files):
    items = sorted(f"{k}:{v[0]}:{v[1]}" for k, v in files.items())
    return hashlib.sha1("\n".join(items).encode()).hexdigest()[:16]


# ------------------------------------------------------------------
# STATE (di database Mission Control)
# ------------------------------------------------------------------
def _ensure_tables(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS bridge_state (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    cur.execute("PRAGMA table_info(tasks)")
    cols = {r[1] for r in cur.fetchall()}
    if "source" not in cols:
        cur.execute("ALTER TABLE tasks ADD COLUMN source TEXT DEFAULT 'manual'")
    if "source_ref" not in cols:
        cur.execute("ALTER TABLE tasks ADD COLUMN source_ref TEXT")
    if "specialty" not in cols:
        cur.execute("ALTER TABLE tasks ADD COLUMN specialty TEXT")

    cur.execute("PRAGMA table_info(agents)")
    acols = {r[1] for r in cur.fetchall()}
    if "specialty" not in acols:
        cur.execute("ALTER TABLE agents ADD COLUMN specialty TEXT")

    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_cli_unique
        ON tasks(source, source_ref) WHERE source = 'cli'
    """)
    conn.commit()


def _get_state(conn, key):
    cur = conn.cursor()
    cur.execute("SELECT value FROM bridge_state WHERE key = ?", (key,))
    row = cur.fetchone()
    return row[0] if row else None


def _set_state(conn, key, value):
    """
    Simpan penanda jembatan dan LANGSUNG commit.

    Penting: kalau tidak di-commit sekarang, transaksi tulis tetap terbuka
    selama pemindaian ratusan berkas. Itu mengunci database dan membuat
    penulisan lain gagal ("database is locked").
    """
    conn.execute(
        "INSERT INTO bridge_state (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
    conn.commit()


def ensure_agent_specialties(conn):
    """Isi kolom specialty agent sekali (migrasi aditif)."""
    _ensure_tables(conn)
    cur = conn.cursor()
    cur.execute("SELECT id, name, role, specialty FROM agents")
    rows = cur.fetchall()
    changed = False
    for r in rows:
        if r["specialty"]:
            continue
        spec = DEFAULT_SPECIALTY.get(r["id"]) or classify(r["role"], "backend")
        cur.execute("UPDATE agents SET specialty = ? WHERE id = ?", (spec, r["id"]))
        changed = True
    if changed:
        conn.commit()


# ------------------------------------------------------------------
# PENUGASAN & STATUS AGENT
# ------------------------------------------------------------------
def _agents_by_specialty(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, name, specialty FROM agents ORDER BY id")
    out = {}
    for r in cur.fetchall():
        out.setdefault(r["specialty"] or "backend", []).append(dict(r))
    return out


def _next_assignee(conn, spec, counters):
    """Pilih agent pada bidang yang cocok, bergilir bila lebih dari satu."""
    groups = _agents_by_specialty(conn)
    pool = groups.get(spec)
    if not pool:
        pool = groups.get("lead") or [a for g in groups.values() for a in g]
    if not pool:
        return None, spec
    idx = counters.get(spec, 0)
    counters[spec] = idx + 1
    return pool[idx % len(pool)]["id"], spec


def refresh_agent_states(conn):
    """
    Hitung ulang status tiap agent dari task NYATA.

    Agent hanya bekerja kalau ada task di bidangnya; kalau tidak ada,
    dia idle (dan di kantor 2D akan berkeliaran / mengobrol).
    """
    cur = conn.cursor()
    cur.execute("SELECT id, name, specialty FROM agents ORDER BY id")
    agents = [dict(r) for r in cur.fetchall()]

    now = datetime.now().isoformat()
    summary = []
    for ag in agents:
        spec = ag["specialty"] or "backend"
        cur.execute("""
            SELECT title, status FROM tasks
            WHERE assignee_id = ?
              AND status IN ('in_progress', 'review')
              AND (specialty IS NULL OR specialty = ?)
            ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,
                     CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END
            LIMIT 1
        """, (ag["id"], spec))
        row = cur.fetchone()

        if row:
            new_state = "reviewing" if row["status"] == "review" else "working"
            new_task = row["title"]
        else:
            new_state = "idle"
            new_task = None

        cur.execute("SELECT state, current_task FROM agents WHERE id = ?", (ag["id"],))
        old = cur.fetchone()
        if old and (old["state"] != new_state or (old["current_task"] or None) != new_task):
            cur.execute(
                "UPDATE agents SET state = ?, current_task = ?, updated_at = ? WHERE id = ?",
                (new_state, new_task, now, ag["id"]))
            summary.append(f"{ag['name']} → {new_state}")

    if summary:
        conn.execute("""
            INSERT INTO activities (id, agent_id, type, message, created_at)
            VALUES (?, NULL, 'state_sync', ?, ?)
        """, (str(uuid.uuid4()),
              "Status agent disesuaikan dengan bidang: " + "; ".join(summary[:5]),
              now))
    conn.commit()
    return summary


# ------------------------------------------------------------------
# SINKRONISASI
# ------------------------------------------------------------------
def _collect_items(conn):
    """Kumpulkan semua perubahan baru dari seluruh sumber."""
    _ensure_tables(conn)
    items = []

    # --- 1. Riwayat permintaan CLI ---
    entries = read_history()
    seen_raw = _get_state(conn, "cli_seen_hashes")
    first_run = seen_raw is None
    seen = set(h for h in (seen_raw or "").split(",") if h)

    if entries:
        if first_run:
            for e in entries[:-1]:
                seen.add(_hash(e["text"]))
            fresh_entries = entries[-1:]
        else:
            fresh_entries = [e for e in entries if _hash(e["text"]) not in seen]
            fresh_entries = fresh_entries[-MAX_NEW_TASKS:]

        for e in fresh_entries:
            items.append({
                "kind": "cli",
                "key": _hash(e["text"]),
                "title": _make_title(e["text"]),
                "desc": e["text"],
                "spec": classify(e["text"]),
                "label": "Permintaan CLI",
                "ts": e["ts"],
                "ref": "cli:" + _hash(e["text"]),
            })
            seen.add(_hash(e["text"]))

    _set_state(conn, "cli_seen_hashes", ",".join(sorted(seen)[-400:]))

    # --- 2..4. Perubahan berkas ---
    for src in WATCHED:
        files = scan_files(src)
        fp = _fingerprint(files)
        old_fp = _get_state(conn, f"files_fp_{src['id']}")
        old_raw = _get_state(conn, f"files_map_{src['id']}") or ""

        old_map = {}
        for pair in old_raw.split("|"):
            if "=" in pair:
                k, v = pair.rsplit("=", 1)
                try:
                    mt, sz = v.split(",")
                    old_map[k] = (int(mt), int(sz))
                except ValueError:
                    pass

        if old_fp is None:
            # Pemindaian pertama: jadikan baseline, hanya ambil yang sangat baru
            cutoff = time.time() - RECENT_WINDOW_MIN * 60
            for rel, (mt, sz) in files.items():
                if mt >= cutoff:
                    items.append(_file_item(src, rel, "terdeteksi"))
        elif fp != old_fp:
            for rel, (mt, sz) in files.items():
                if old_map.get(rel) != (mt, sz):
                    kind = "baru" if rel not in old_map else "diperbarui"
                    items.append(_file_item(src, rel, kind))

        _set_state(conn, f"files_fp_{src['id']}", fp)
        _set_state(conn, f"files_map_{src['id']}",
                   "|".join(f"{k}={v[0]},{v[1]}" for k, v in sorted(files.items())))

    return items, first_run


def _file_item(src, rel, kind):
    ext = os.path.splitext(rel)[1].lower()
    spec = SPECIALTY_BY_EXT.get(ext, "backend")
    name = os.path.basename(rel)
    return {
        "kind": "file",
        "key": f"{src['id']}:{rel}:{kind}",
        "title": f"Tinjau perubahan {name} ({src['label']})",
        "desc": f"Berkas {rel} {kind} di {src['path']}",
        "spec": spec,
        "label": src["label"],
        "ts": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "ref": f"{src['id']}:{rel}:{int(time.time())}",
    }


COMPLETION_WORDS = (
    "selesai", "beres", "berhasil", "tuntas", "kelar", "sukses",
    "sudah jalan", "sudah bisa", "sudah lancar", "sudah tampil",
    "done", "mantap", "sempurna", "sudah oke", "sudah bagus",
)


def is_completion(text):
    """Apakah permintaan CLI ini menandakan pekerjaan sebelumnya sudah tuntas?"""
    t = " " + _clean(text).lower() + " "
    return any(w in t for w in COMPLETION_WORDS)


def _close_tasks(conn, where_sql, params, reason):
    """
    Tutup task yang masih terbuka dan catat aktivitas penyelesaiannya.

    Ini yang membuat siklus hidup pekerjaan nyata: begitu CLI bergerak ke
    pekerjaan berikutnya (atau perubahan berkas yang lebih baru datang),
    pekerjaan lama benar-benar DITUTUP, sehingga agent berhenti membahasnya.
    """
    cur = conn.cursor()
    cur.execute(f"""
        SELECT id, title FROM tasks
        WHERE status IN ('in_progress', 'review') AND ({where_sql})
    """, params)
    closed = []
    for row in cur.fetchall():
        cur.execute("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?",
                    (datetime.now().isoformat(), row["id"]))
        closed.append(row["title"])
        cur.execute("""
            INSERT INTO activities (id, agent_id, type, message, created_at)
            VALUES (?, NULL, 'task_done', ?, ?)
        """, (str(uuid.uuid4()),
              f"Selesai: {row['title']} — {reason}",
              datetime.now().isoformat()))
    return closed


def sync(conn, max_new=MAX_NEW_TASKS, verbose=False):
    """
    Sinkronkan SEMUA perubahan → aktivitas + task → status agent.

    Kembalikan ringkasan untuk API/log.
    """
    _ensure_tables(conn)
    ensure_agent_specialties(conn)

    items, first_run = _collect_items(conn)
    if not items:
        conn.commit()
        return {"created": 0, "activities": 0, "titles": [],
                "first_run": first_run, "states": []}

    # Akhiri transaksi BACA (pemindaian berkas & penanda) sebelum menulis.
    # Lihat penjelasan di server.py: upgrade kunci baca→tulis ditolak seketika
    # oleh SQLite, dan busy_timeout tidak menolong untuk kasus ini.
    conn.commit()

    cur = conn.cursor()
    counters = {}
    created, activity_count = [], 0
    closed = []

    # ------------------------------------------------------------------
    # SIKLUS HIDUP PEKERJAAN (dari CLI)
    # Satu permintaan CLI = satu sesi kerja. Begitu ada permintaan BARU,
    # pekerjaan sebelumnya dianggap SELESAI dan benar-benar ditutup,
    # sehingga agent berhenti membahas data lama dan fokus ke data terbaru.
    # ------------------------------------------------------------------
    cli_items = [it for it in items if it["kind"] == "cli"]
    newest_cli = cli_items[-1] if cli_items else None
    if newest_cli:
        reason = ("permintaan CLI menyatakan pekerjaan sebelumnya tuntas"
                  if is_completion(newest_cli["desc"])
                  else "CLI sudah lanjut ke pekerjaan berikutnya")
        closed += _close_tasks(conn, "source = 'cli' AND source_ref IS NOT ?",
                               (newest_cli["ref"],), reason)

    # Perubahan berkas: berkas yang sama berubah lagi → task lama ditutup
    for it in items:
        if it["kind"] != "file":
            continue
        prefix = it["ref"].rsplit(":", 1)[0]
        closed += _close_tasks(conn, "source = 'cli' AND source_ref LIKE ?",
                               (prefix + ":%",),
                               "ada perubahan lebih baru pada berkas yang sama")

    for it in items:
        # Setiap perubahan dicatat sebagai aktivitas (agar semuanya terbaca)
        cur.execute("""
            INSERT INTO activities (id, agent_id, type, message, created_at)
            VALUES (?, NULL, ?, ?, ?)
        """, (str(uuid.uuid4()),
              "cli_change" if it["kind"] == "cli" else "file_change",
              f"[{it['label']}] {it['title']}", datetime.now().isoformat()))
        activity_count += 1

        # Perubahan yang berarti dibuatkan task (kecuali sudah mencapai batas)
        if len(created) >= max_new:
            continue

        assignee, spec = _next_assignee(conn, it["spec"], counters)
        task_id = "auto-" + _hash(it["key"]) + "-" + str(uuid.uuid4())[:4]
        ref = it.get("ref") or it["ts"]
        cur.execute("""
            INSERT OR IGNORE INTO tasks
                (id, title, description, status, priority, assignee_id, tags,
                 source, source_ref, specialty)
            VALUES (?, ?, ?, 'in_progress', ?, ?, ?, 'cli', ?, ?)
        """, (task_id, it["title"], it["desc"],
              "high" if it["kind"] == "cli" else "medium",
              assignee, it["label"].lower(), ref, spec))
        if cur.rowcount:
            created.append(it["title"])

    # Task otomatis lama ditandai selesai agar pembahasan terus bergerak
    cur.execute("""
        SELECT id FROM tasks WHERE source = 'cli' AND status = 'in_progress'
        ORDER BY created_at DESC, rowid DESC
    """)
    active = [r[0] for r in cur.fetchall()]
    for old_id in active[KEEP_ACTIVE:]:
        cur.execute("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?",
                    (datetime.now().isoformat(), old_id))

    states = refresh_agent_states(conn)
    _set_state(conn, "cli_last_sync", datetime.now().isoformat())
    conn.commit()

    if verbose:
        for t in created:
            print("  + task:", t)

    return {"created": len(created), "activities": activity_count,
            "titles": created, "first_run": first_run, "states": states,
            "closed": closed}


def status(conn):
    """Ringkasan keadaan jembatan."""
    _ensure_tables(conn)
    ensure_agent_specialties(conn)
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM tasks WHERE source = 'cli'")
    total = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM tasks WHERE source = 'cli' AND status = 'in_progress'")
    active = cur.fetchone()[0]

    cur.execute("SELECT name, specialty, state, current_task FROM agents ORDER BY name")
    agents = [dict(r) for r in cur.fetchall()]

    sources = []
    for src in WATCHED:
        files = scan_files(src)
        sources.append({
            "id": src["id"], "path": src["path"], "files": len(files),
            "available": os.path.isdir(src["path"]),
        })

    return {
        "history_path": HISTORY_PATH,
        "history_available": os.path.exists(HISTORY_PATH),
        "history_entries": len(read_history()),
        "watched_sources": sources,
        "tasks_total": total,
        "tasks_active": active,
        "agents": agents,
        "last_sync": _get_state(conn, "cli_last_sync"),
    }
