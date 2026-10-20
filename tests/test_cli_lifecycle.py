#!/usr/bin/env python3
"""
Uji SIKLUS HIDUP PEKERJAAN dari CLI.

Skenario yang diuji (persis seperti permintaan pengguna):
  1. Pengguna mengubah sesuatu di CLI      → agent dapat pekerjaan baru
  2. CLI lanjut ke permintaan berikutnya   → pekerjaan lama DITUTUP (selesai)
  3. Permintaan menyatakan "selesai"       → ditutup dengan alasan tuntas
Hasil akhir: agent tidak lagi membahas data yang sudah selesai.
"""

import os
import shutil
import sqlite3
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cli_bridge as cb  # noqa: E402

FAIL = []


def check(name, ok, detail=""):
    print(f"  [{'LULUS' if ok else 'GAGAL'}] {name}" + (f"  → {detail}" if detail else ""))
    if not ok:
        FAIL.append(name)


tmp = tempfile.mkdtemp()
hist = os.path.join(tmp, "history.txt")
cb.HISTORY_PATH = hist                      # arahkan ke berkas uji
cb.WATCHED = []                             # fokus hanya ke riwayat CLI

db = os.path.join(tmp, "t.db")
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
conn.executescript("""
CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, role TEXT, avatar_color TEXT,
                     state TEXT, current_room TEXT, current_task TEXT, description TEXT,
                     desk_x INTEGER, desk_y INTEGER, created_at TEXT, updated_at TEXT);
CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, description TEXT, status TEXT,
                    priority TEXT, assignee_id TEXT, tags TEXT, created_at TEXT,
                    updated_at TEXT);
CREATE TABLE activities (id TEXT PRIMARY KEY, agent_id TEXT, type TEXT,
                         message TEXT, created_at TEXT);
INSERT INTO agents (id,name,role,state) VALUES
 ('agent-lead','Aria','Lead Agent','idle'),
 ('agent-eng','Reza','Lead Engineer','idle'),
 ('agent-coder-1','Nova','Coder Frontend','idle'),
 ('agent-coder-2','Pixel','Coder Backend','idle'),
 ('agent-researcher','Sage','Researcher','idle'),
 ('agent-reviewer','Vera','Reviewer','idle');
""")
conn.commit()


def write_history(entries):
    """Tulis riwayat CLI dengan format nyata."""
    with open(hist, "w", encoding="utf-8") as f:
        for ts, text in entries:
            f.write(f"# {ts}\n+{text}\n")


def open_tasks():
    return [dict(r) for r in conn.execute(
        "SELECT title, status, source_ref, specialty FROM tasks "
        "WHERE source='cli' ORDER BY created_at, rowid")]


def done_activities():
    return [r["message"] for r in conn.execute(
        "SELECT message FROM activities WHERE type='task_done' ORDER BY created_at")]


print("=" * 68)
print("  UJI SIKLUS HIDUP PEKERJAAN — MISSION CONTROL 2D")
print("=" * 68)

# --- Langkah 0: baseline (semua permintaan lama dianggap sudah dikenal) ---
BASE = [("2026-10-20 09:00:00.000000", "permintaan awal sebelum pemantauan")]
write_history(BASE)
cb._ensure_tables(conn)
cb._set_state(conn, "cli_seen_hashes",
              ",".join(cb._hash(t) for _, t in BASE))
conn.commit()
cb.sync(conn)
print("\nLangkah 0 — baseline dibuat (permintaan lama tidak diimpor ulang)")
check("Baseline tidak membuat task lama", len(open_tasks()) == 0,
      f"{len(open_tasks())} task")

# --- Langkah 1: pengguna mengubah sesuatu di CLI ---
write_history([
    ("2026-10-20 09:00:00.000000", "permintaan awal sebelum pemantauan"),
    ("2026-10-20 09:05:00.000000", "perbaiki tampilan kamera pada visual 2d office"),
])
time.sleep(0.01)
r1 = cb.sync(conn)
tasks = open_tasks()
print("\nLangkah 1 — pengguna mengubah tampilan di CLI")
check("Terbentuk 1 pekerjaan baru", len(tasks) == 1, f"{len(tasks)} task")
check("Pekerjaan baru berstatus dikerjakan",
      bool(tasks) and tasks[0]["status"] == "in_progress",
      tasks[0]["status"] if tasks else "-")
check("Pekerjaan diarahkan ke bidang yang tepat",
      bool(tasks) and tasks[0]["specialty"] == "frontend",
      tasks[0]["specialty"] if tasks else "-")

# --- Langkah 2: CLI lanjut ke permintaan berikutnya ---
write_history([
    ("2026-10-20 09:00:00.000000", "permintaan awal sebelum pemantauan"),
    ("2026-10-20 09:05:00.000000", "perbaiki tampilan kamera pada visual 2d office"),
    ("2026-10-20 09:12:00.000000", "tambahkan endpoint API untuk laporan harian"),
])
time.sleep(0.01)
r2 = cb.sync(conn)
tasks = open_tasks()
by_status = {}
for t in tasks:
    by_status.setdefault(t["status"], []).append(t["title"])
print("\nLangkah 2 — CLI lanjut ke pekerjaan berikutnya")
check("Pekerjaan lama otomatis DITUTUP (selesai)",
      len(by_status.get("done", [])) == 1,
      f"selesai: {by_status.get('done')}")
check("Hanya 1 pekerjaan yang masih dikerjakan",
      len(by_status.get("in_progress", [])) == 1,
      f"dikerjakan: {by_status.get('in_progress')}")
check("Pekerjaan baru = permintaan terbaru",
      bool(by_status.get("in_progress")) and
      "endpoint API" in by_status["in_progress"][0],
      by_status.get("in_progress", ["-"])[0])
check("Bidang pekerjaan baru benar (backend)",
      any(t["specialty"] == "backend" and t["status"] == "in_progress" for t in tasks),
      ", ".join(f"{t['specialty']}:{t['status']}" for t in tasks))

# --- Langkah 3: permintaan yang menyatakan pekerjaan tuntas ---
write_history([
    ("2026-10-20 09:00:00.000000", "permintaan awal sebelum pemantauan"),
    ("2026-10-20 09:05:00.000000", "perbaiki tampilan kamera pada visual 2d office"),
    ("2026-10-20 09:12:00.000000", "tambahkan endpoint API untuk laporan harian"),
    ("2026-10-20 09:20:00.000000", "laporan harian sudah selesai dan berjalan lancar"),
])
time.sleep(0.01)
r3 = cb.sync(conn)
tasks = open_tasks()
done_titles = [t["title"] for t in tasks if t["status"] == "done"]
acts = done_activities()
print("\nLangkah 3 — CLI menyatakan pekerjaan sebelumnya sudah selesai")
check("Pekerjaan sebelumnya ditutup lagi (total 2 selesai)",
      len(done_titles) == 2, f"{len(done_titles)} selesai")
check("Alasan penutupan menyebut pekerjaan tuntas",
      any("tuntas" in a for a in acts),
      acts[-1] if acts else "-")
check("Permintaan 'selesai' tetap tercatat sebagai pekerjaan",
      len(tasks) == 3, f"{len(tasks)} task total")
check("Tidak ada pekerjaan lama yang masih menggantung",
      len([t for t in tasks if t["status"] == "in_progress"]) == 1,
      str([t["title"] for t in tasks if t["status"] == "in_progress"]))

# --- Langkah 4: idempoten ---
before = len(tasks)
cb.sync(conn)
check("Sync ulang tidak menggandakan pekerjaan",
      len(open_tasks()) == before, f"{len(open_tasks())} vs {before}")

# --- Langkah 5: agent hanya bekerja di bidangnya ---
print("\nBidang agent vs pekerjaan yang dipegang:")
rows = conn.execute("""
    SELECT ag.name, ag.specialty, ag.state, t.title, t.specialty AS task_spec
    FROM agents ag LEFT JOIN tasks t
      ON t.assignee_id = ag.id AND t.status IN ('in_progress','review')
    ORDER BY ag.name
""").fetchall()
mismatch = []
for r in rows:
    print(f"  {r['name']:8} {r['specialty'] or '-':9} {r['state']:10} "
          f"{(r['title'] or '-')[:40]:42} {r['task_spec'] or '-'}")
    if r["task_spec"] and r["task_spec"] != r["specialty"]:
        mismatch.append(r["name"])
check("Setiap agent hanya memegang pekerjaan sesuai bidangnya",
      not mismatch, ", ".join(mismatch) or "semua sesuai")

# --- Langkah 6: agent tanpa pekerjaan di bidangnya menjadi bebas (idle) ---
idle_agents = [r["name"] for r in rows if not r["title"]]
check("Agent tanpa pekerjaan di bidangnya berstatus bebas",
      len(idle_agents) > 0, f"bebas: {', '.join(idle_agents) or '-'}")

conn.close()
shutil.rmtree(tmp)

print("\n" + "=" * 68)
if FAIL:
    print(f"  HASIL: {len(FAIL)} GAGAL → " + "; ".join(FAIL))
    sys.exit(1)
print("  HASIL: SEMUA UJI SIKLUS HIDUP LULUS")
print("=" * 68)
