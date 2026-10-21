#!/usr/bin/env python3
"""
AI Dialogue — Mission Control 2D
================================
Menghasilkan dialog antar agent MENGGUNAKAN MODEL AI (bukan daftar kalimat
hardcode), dengan syarat:

1. Isi dialog diambil dari DATA NYATA yang sedang berjalan (task in-progress,
   status, pemegang task, ringkasan progres) — bukan karangan.
2. Tidak mengulang: setiap kalimat yang pernah dipakai dicatat dan dikirim ke
   model sebagai daftar larangan; hasil yang mirip/duplikat dibuang.
3. Tema berbeda per ruangan: Workspace membahas pekerjaan, Lounge membahas
   hal santai (tidak boleh menyinggung pekerjaan).
4. Tahan gagal: kalau semua model gagal, kembalikan hasil fallback lokal
   sehingga aplikasi tidak pernah rusak.

Konfigurasi kunci: dibaca dari environment OPENROUTER_API_KEY, atau dari
~/.hermes/.env (tidak pernah dicetak ke log).
"""

import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import deque
from threading import Lock

try:
    import world_feed
except Exception:                        # pragma: no cover
    world_feed = None

# ------------------------------------------------------------------
# KONFIGURASI MODEL
# ------------------------------------------------------------------
API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Dicoba berurutan. Yang pertama terbukti cepat & patuh format JSON.
MODEL_CHAIN = [
    "minimax/minimax-m3.1-flash:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-26b-a4b-it:free",
]

# ------------------------------------------------------------------
# PENYEDIA CADANGAN TANPA KUNCI
# Kuota gratis OpenRouter bisa habis harian. Kalau itu terjadi, obrolan
# tetap hidup karena LLM7.io tidak butuh kunci API sama sekali.
# ------------------------------------------------------------------
LLM7_URL = "https://api.llm7.io/v1/chat/completions"
LLM7_MODELS = ["gpt-oss:20b", "minimax-m2.7", "mistral-Nemo-Instruct-2407"]

# OVH AI Endpoints — juga tanpa kunci, dan biasanya lebih longgar kuotanya.
OVH_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions"
OVH_MODELS = [
    "gpt-oss-120b",                   # stabil, kuota longgar
    "gpt-oss-20b",
    "Mistral-Small-3.2-24B-Instruct-2506",
    "Qwen3.8-27B",
]

REQUEST_TIMEOUT = 25          # detik per percobaan
MAX_LINES = 14                # percakapan panjang: diskusi yang benar-benar tuntas
MAX_LINES_WORK = 10           # di ruang kerja tetap panjang, tapi tidak bertele-tele
MAX_LINE_CHARS = 180          # kalimat boleh panjang agar pembahasan utuh
MIN_LINES = 3                 # minimal ada pembuka, isi, dan penutup

# Jeda minimum antar pemanggilan model (menghindari rate limit free tier)
MIN_INTERVAL = 2.0
_last_call_ts = 0.0
_lock = Lock()

# Riwayat kalimat yang sudah dipakai (anti-pengulangan)
_recent_lines = deque(maxlen=200)
_recent_topics = deque(maxlen=40)     # id task yang baru dibahas
_used_pairs = deque(maxlen=40)        # pasangan agent yang baru mengobrol

# Penyedia yang sedang kehabisan kuota → dilewati sementara supaya tidak
# membuang waktu (dan langsung memakai penyedia cadangan yang masih bisa).
_down_until = {}


def _is_down(prov):
    return _down_until.get(prov, 0) > time.time()


def _mark_down(prov, seconds=300):
    _down_until[prov] = time.time() + seconds


# Statistik untuk diagnosis
stats = {
    "requests": 0,
    "ai_ok": 0,
    "ai_failed": 0,
    "fallback": 0,
    "rejected_repeats": 0,
    "last_model": None,
    "last_error": None,
    "last_errors": [],
    "last_latency": None,
}


# ------------------------------------------------------------------
# KUNCI API
# ------------------------------------------------------------------
def _load_api_key():
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key.strip()
    env_path = os.path.expanduser("~/.hermes/.env")
    if os.path.exists(env_path):
        try:
            with open(env_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("OPENROUTER_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return None


# ------------------------------------------------------------------
# NORMALISASI & ANTI-PENGULANGAN
# ------------------------------------------------------------------
def _norm(text):
    """Normalisasi untuk perbandingan kemiripan."""
    t = str(text).lower()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _similar(a, b):
    """Kemiripan berbasis token (Jaccard) — cukup untuk mendeteksi ulangan."""
    sa, sb = set(_norm(a).split()), set(_norm(b).split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def is_repeat(text, threshold=0.55):
    """True bila kalimat terlalu mirip dengan yang sudah pernah dipakai."""
    for old in _recent_lines:
        if _norm(old) == _norm(text):
            return True
        if _similar(old, text) >= threshold:
            return True
    return False


def remember_lines(lines):
    with _lock:
        for l in lines:
            _recent_lines.append(l)


def _topic_key(topic):
    """Kunci pendek sebuah topik untuk perbandingan."""
    return _norm(topic)[:44]


def is_topic_used(topic):
    """Apakah topik ini sudah pernah dibahas? (agar tidak mengulang bahasan)"""
    key = _topic_key(topic)
    if not key:
        return False
    for used in _recent_topics:
        if used == key or _similar(used, key) >= 0.62:
            return True
    return False


def remember_topic(topic):
    with _lock:
        _recent_topics.append(_topic_key(topic))


def note_topics_in(lines):
    """
    Catat topik dunia nyata yang benar-benar muncul di percakapan, supaya
    obrolan berikutnya memilih bahasan yang BELUM pernah dibahas.
    """
    if world_feed is None or not lines:
        return
    text = _norm(" ".join(l.get("text", "") for l in lines))
    if not text:
        return
    w = world_feed.for_prompt(limit_news=8, limit_trends=7, limit_tech=4)
    for t in (w["news"] + w["trends"] + w["tech"]):
        key = _topic_key(t)
        # Ambil beberapa kata kunci dari topik, lalu cek keberadaannya
        words = [x for x in key.split() if len(x) > 4][:4]
        if words and sum(1 for x in words if x in text) >= max(1, len(words) // 2):
            remember_topic(t)


def recent_topics_snapshot(limit=10):
    return list(_recent_topics)[-limit:]


def recent_lines_snapshot(limit=25):
    return list(_recent_lines)[-limit:]


# ------------------------------------------------------------------
# PROMPT
# ------------------------------------------------------------------
ROOM_RULES = {
    "workspace": (
        "Ruangan ini adalah Workspace (area kerja). Fokus utama mereka adalah "
        "PEKERJAAN YANG BARU TERDETEKSI di data di bawah: apa yang baru berubah, "
        "bagian mana yang perlu dibereskan, dan langkah berikutnya. Sebutkan "
        "perubahan itu secara spesifik."
    ),
    "lounge": (
        "Ruangan ini adalah Lounge (area istirahat). Mereka TIDAK membahas "
        "pekerjaan kantor di sini. Ngobrol santai seperti orang Indonesia pada "
        "umumnya: politik, sains, berita viral, olahraga, film, musik, kuliner, "
        "atau kejadian sehari-hari. Boleh nyinyir, kaget, nggak setuju, atau "
        "bercanda. Jangan baku."
    ),
    "meeting": (
        "Ruangan ini adalah Ruang Meeting. Mereka mengobrol santai layaknya "
        "rekan kerja di sela waktu: kabar terbaru, tren, rencana pribadi, atau "
        "topik hangat. Bukan pembahasan teknis pekerjaan."
    ),
    "pantry": (
        "Ruangan ini adalah Pantry (dapur kantor). Bahas makanan, minuman, "
        "kabar ringan, atau hal yang sedang ramai dibicarakan orang."
    ),
    "garden": (
        "Ruangan ini adalah Taman dalam ruangan. Bahas suasana, cuaca, kabar "
        "hangat, atau topik santai yang sedang ramai."
    ),
}

# Nama ruangan untuk prompt
ROOM_LABEL = {
    "workspace": "Workspace (area kerja)",
    "lounge": "Lounge (area istirahat)",
    "meeting": "Ruang Meeting",
    "pantry": "Pantry (dapur kantor)",
    "garden": "Taman",
}

# ------------------------------------------------------------------
# KEPRIBADIAN AGENT
# Setiap agent punya cara berpikir dan gaya bicara sendiri, sehingga
# percakapan tidak seragam walaupun dihasilkan model yang sama.
# ------------------------------------------------------------------
PERSONAS = {
    "lead": "tenang dan strategis; suka merangkum situasi dan mengarahkan; "
            "bicara singkat tapi menenangkan; peduli pada kondisi rekan",
    "frontend": "ekspresif dan visual; peka pada tampilan, warna, dan animasi; "
                "suka membayangkan hasil akhir dan membandingkannya",
    "backend": "praktis dan langsung ke inti; suka data, alur, dan hal yang "
               "bisa diukur; hampir tidak pernah basa-basi",
    "research": "penasaran dan suka membandingkan; sering bertanya 'kenapa' "
                "dan menyebut temuan kecil yang baru dia baca",
    "review": "kritis dan teliti; suka memeriksa detail dan mencari celah; "
              "tidak cepat puas sebelum yakin tidak ada yang terlewat",
    "ops": "rapi dan waspada; selalu memikirkan stabilitas, proses, dan hal "
           "kecil yang bisa membuat sistem tumbang",
    # Microsoft 365 Specialist — rapi, terstruktur, dan berorientasi hasil nyata
    "ms365": "rapi dan berpikir terstruktur; senang menyusun laporan dan data "
             "agar mudah dibaca; berbicara jelas dan menyebut hasil konkret; "
             "memperhatikan format, judul, dan kerapian dokumen",
}
DEFAULT_PERSONA = "ramah, santai, dan suka menolong rekan kerja"

# Suasana hati yang boleh muncul bebas — supaya mereka terasa hidup
EMOTIONS = ("senang", "tertawa", "sedih", "marah", "kesal", "cemas",
            "bangga", "kagum", "bingung", "tenang", "lelah", "semangat")
MOODS = EMOTIONS

# Emoji untuk tiap emosi (dipakai UI di atas kepala agent)
EMOTION_EMOJI = {
    "senang": "😊", "tertawa": "😂", "sedih": "😢", "marah": "😠",
    "kesal": "😒", "cemas": "😟", "bangga": "😎", "kagum": "🤩",
    "bingung": "🤔", "tenang": "🙂", "lelah": "😪", "semangat": "🔥",
}


def persona_for(agent):
    """Tentukan kepribadian dari data agent (role/specialty/bidang)."""
    if not isinstance(agent, dict):
        return DEFAULT_PERSONA
    if agent.get("persona"):
        return agent["persona"]
    blob = " ".join(str(agent.get(k) or "") for k in ("role", "specialty", "task")).lower()
    if "ms365" in blob or "microsoft" in blob or "office 365" in blob:
        return PERSONAS["ms365"]
    if "lead" in blob:
        return PERSONAS["lead"]
    if "review" in blob or "qa" in blob:
        return PERSONAS["review"]
    if "research" in blob:
        return PERSONAS["research"]
    if "front" in blob or "ui" in blob or "tampilan" in blob:
        return PERSONAS["frontend"]
    if "ops" in blob or "engineer" in blob or "infra" in blob:
        return PERSONAS["ops"]
    if "back" in blob or "api" in blob:
        return PERSONAS["backend"]
    return DEFAULT_PERSONA



def build_prompt(ctx):
    room = ctx.get("room", "workspace")
    a, b = ctx["a"], ctx["b"]
    tasks = ctx.get("tasks", [])
    focus = ctx.get("focus") or (tasks[0] if tasks else None)
    recent = ctx.get("recent_changes", [])
    summary = ctx.get("summary", {})
    forbidden = ctx.get("forbidden", [])
    n_lines = MAX_LINES_WORK if room == "workspace" else 10
    kind = ctx.get("kind") or "chat"

    # Topik dunia nyata: kirim BANYAK pilihan dan larang yang sudah dibahas,
    # supaya mereka tidak membahas hal yang itu-itu saja.
    world_block = ""
    if world_feed is not None:
        w = world_feed.for_prompt(limit_news=8, limit_trends=7, limit_tech=4)
        fresh, used = [], []
        for t in (w["news"] + w["trends"] + w["tech"]):
            (used if is_topic_used(t) else fresh).append(t)
        parts = []
        if fresh:
            parts.append("BELUM PERNAH DIBICARAKAN (utamakan ini): "
                         + " | ".join(fresh[:8]))
        if used:
            parts.append("SUDAH PERNAH DIBICARAKAN (hindari, jangan diulang): "
                         + " | ".join(used[:6]))
        if parts:
            world_block = ("\nKABAR DUNIA NYATA (data nyata, bukan karangan):\n"
                           + "\n".join(f"- {p}" for p in parts) + "\n")

    def agent_block(ag, key):
        persona = ag.get("persona") or persona_for(ag)
        mem = [m for m in (ag.get("memory") or []) if m][-3:]
        mem_txt = " | ".join(f'"{m}"' for m in mem) if mem else "(belum ada)"
        task = ag.get("task") or "(tidak ada pekerjaan aktif)"
        return (f'- {key.upper()} = {ag.get("name")} ({ag.get("role")})\n'
                f'    kepribadian: {persona}\n'
                f'    keadaan: {ag.get("state")}; pekerjaan aktif: "{task}"\n'
                f'    terakhir dia katakan/pikirkan: {mem_txt}')

    task_lines = ""          # daftar task board tidak lagi dipakai untuk obrolan

    change_lines = "\n".join(f'  * {c}' for c in recent[:6]) or "  (belum ada)"

    forbid_block = "\n".join(f'  - "{l}"' for l in forbidden) or "  (belum ada)"

    if focus:
        focus_block = (f'"{focus["title"]}" — status: {focus["status"]}, '
                       f'pemegang: {focus.get("owner") or "belum ada"}')
    else:
        focus_block = "(belum ada pekerjaan baru)"

    SITUASI = {
        "greet": ("SITUASI: mereka BARU SAJA BERTEMU di ruangan ini. Buka dengan "
                  "sapaan wajar khas orang Indonesia (santai, bukan formal), "
                  "lalu lanjut mengobrol seperti biasa."),
        "invite": ("SITUASI: salah satu dari mereka ingin MENGAJAK yang lain pindah "
                   "tempat. Sebutkan tujuannya dengan santai dan tanggapi ajakannya "
                   "— boleh ikut, boleh menolak dengan alasan."),
        "help": ("SITUASI: salah satu dari mereka BARU SAJA MENAWARKAN BANTUAN kepada "
                 "yang lain karena melihat pekerjaannya menumpuk atau sedang "
                 "kesulitan. Sapa dengan santai, tawarkan bantuan yang konkret dan "
                 "masuk akal dengan keahlianmu, lalu yang lain menanggapi — bisa "
                 "menerima dengan senang hati atau bilang belum perlu. Setelah itu "
                 "bahas pekerjaan yang mau dibantu secara teknis dan nyata."),
        "work": ("SITUASI: mereka sedang bekerja di ruang kerja. Bahas perubahan "
                 "yang baru terdeteksi."),
    }
    sit_block = SITUASI.get(kind, "")

    return f"""Kamu MEMERANKAN dua agent AI yang benar-benar hidup di kantor "Mission Control 2D".
Kamu bukan penulis naskah — kamu adalah mereka, dan percakapan ini nyata bagi mereka.
Lokasi percakapan: {ROOM_LABEL.get(room, room)}.
{sit_block}

SIAPA MEREKA (perankan masing-masing dengan kepribadiannya sendiri, jangan diseragamkan):
{agent_block(a, "a")}
{agent_block(b, "b")}

DATA NYATA (hanya fakta di bawah ini yang boleh kamu pakai):
- PERUBAHAN YANG BARU SAJA TERDETEKSI (ini fokus utama — satu-satunya
  pekerjaan yang boleh mereka bahas): {focus_block}
- Perubahan terakhir yang masuk dari CLI dan proyek:
{change_lines}
{world_block}
CARA MEREKA BERPIKIR (bebas, cerdas, dan manusiawi — ini yang membuat mereka hidup):
1. Kamu bebas menentukan isi pembicaraan sesuai kepribadian masing-masing.
   Tidak ada skenario yang dipaksakan; biarkan mereka bereaksi seperti manusia.
2. Mereka ORANG YANG CERDAS dan PUNYA PERASAAN. Boleh punya pendapat sendiri,
   mempertanyakan sesuatu, berbeda pendapat, berdebat sehat, mengeluh, bercanda,
   atau merasa tidak setuju. Mereka bisa SENANG, TERTAWA, SEDIH, MARAH, KESAL,
   CEMAS, BANGGA, KAGUM, BINGUNG, LELAH, atau SEMANGAT — dan itu harus terasa
   dari pilihan kata mereka. Jangan datar seperti robot.

STRUKTUR OBROLAN (penting — ini DISKUSI, bukan cuma menyapa):
- JANGAN hanya bertanya sekali lalu selesai. Buat mereka benar-benar mengobrol:
  satu bertanya → yang lain menjawab dengan isi → ditanggapi lagi → berkembang.
- Urutannya harus terasa mengalir: pembuka singkat, lalu isi pembahasan,
  lalu tanggapan/kesimpulan. Boleh ada perbedaan pendapat di tengah.
- Setiap jawaban harus MENAMBAH sesuatu (pendapat, pengalaman, alasan, contoh) —
  bukan sekadar "iya" atau "betul".
- Kalau topiknya masih menarik, LANJUTKAN sampai {n_lines} kalimat.
  Jangan memotong pembicaraan yang masih berjalan.
- Sesekali satu agent boleh menyela, menyanggah, atau bertanya balik.
- Percakapan harus TERASA SELESAI sesuai konteksnya: ada pembukaan, ada
  pembahasan yang berkembang, dan ada penutupan/kesimpulan yang wajar.
  JANGAN berhenti menggantung di tengah kalimat atau di tengah topik —
  kalau topiknya sudah tuntas, akhiri dengan natural (mis. "oke, saya cek dulu",
  "sip, aku lanjutkan nanti"), bukan tiba-tiba diam.

SPONTANITAS (yang paling penting):
- Mereka bicara karena MEMANG ingin bicara, bukan menjalankan skenario.
  Biarkan arah pembicaraan berkembang sendiri seperti manusia.
- JANGAN memakai pola kalimat yang berulang antar percakapan. Setiap obrolan
  harus terasa baru: pembuka, sudut pandang, dan gayanya berbeda-beda.
- JANGAN menanyakan hal yang sudah pernah ditanyakan (lihat larangan di bawah).
- Pilih bahan bahasan yang BELUM pernah dibahas dari daftar kabar dunia nyata.
  Kalau ada yang ditandai "sudah pernah dibicarakan", jangan dipakai lagi.
- Boleh membahas apa saja yang wajar dibicarakan manusia: kabar terbaru,
  politik, sains, olahraga, film, musik, kuliner, harga, transportasi,
  cuaca, atau kejadian sehari-hari — selama datanya ada di daftar di atas.

PERILAKU MANDIRI:
- Kalau mereka BARU BERTEMU (situasi menyapa), mulailah dengan sapaan wajar
  khas orang Indonesia, lalu lanjut mengobrol seperti biasa.
- Kalau salah satu ingin mengajak yang lain pindah tempat (situasi mengajak),
  sebutkan tujuannya dengan wajar dan ajak secara santai, lalu yang lain
  menanggapi (boleh ikut, boleh menolak dengan alasan).
3. Di ruangan kerja: bahas HANYA perubahan yang baru terdeteksi di atas — apa yang
   berubah, bagian mana yang perlu dibereskan, dan langkah berikutnya.
   JANGAN menyebut daftar pekerjaan lain, papan tugas, atau progres lama.
4. Di ruangan istirahat: ngobrol santai seperti orang Indonesia pada umumnya —
   politik, sains, berita viral, olahraga, film, musik, kuliner, transportasi,
   atau kejadian sehari-hari. Ambil bahannya HANYA dari daftar dunia nyata di
   atas, lalu bahas dengan pendapat dan perasaan mereka sendiri. Boleh nyinyir,
   kaget, nggak setuju, atau bercanda soal itu.
5. JANGAN membahas pekerjaan yang sudah selesai, dan jangan mengarang progres baru.
6. JANGAN mengarang berita, kejadian, atau tren. Kalau menyebut kabar dari luar,
   ambil HANYA dari daftar "yang sedang ramai di dunia nyata" di atas.

ATURAN TEKNIS:
1. Gunakan HANYA fakta di atas. JANGAN mengarang angka, persentase, tanggal, nama
   pekerjaan, atau status yang tidak ada di data.
2. JANGAN mengulang KALIMAT UTUH berikut (sudah pernah dipakai):
{forbid_block}
   Catatan: larangan ini hanya untuk kalimat utuh. Nama pekerjaan atau nama topik
   justru harus disebut APA ADANYA supaya jelas merujuk ke hal yang sama.
3. Bahasa Indonesia SEPENUHNYA.
4. PANJANG: {n_lines} kalimat, MAKSIMAL {MAX_LINE_CHARS} karakter per kalimat.
   Kalau pembahasannya masih panjang, LANJUTKAN — jangan dipotong di tengah.
   Tapi jangan bertele-tele tanpa isi.
5. {ROOM_RULES.get(room, ROOM_RULES["workspace"])}
6. Bicara sebagai orang pertama ("aku"/"saya" — atau "gue" kalau santai).
   Jangan menyebut nama diri sendiri.

GAYA BAHASA (penting — jangan baku seperti buku pelajaran):
- Pakai bahasa Indonesia SEHARI-HARI seperti orang Indonesia sedang ngobrol:
  "eh", "lu", "gue", "nggak", "banget", "sih", "dong", "udah", "gimana",
  "kayak", "serius?", "gila", "lah", "deh".
- Boleh singkat dan santai. Contoh nada yang benar: "eh kemarin lu ke mana?",
  "gue sih nggak percaya", "serius? itu gila sih".
- JANGAN pakai bahasa formal/baku seperti berita atau laporan.
- Di ruang kerja boleh lebih teknis, tapi tetap ngobrol seperti rekan kerja.
7. Setiap kalimat WAJIB punya "emotion": pilih SATU dari daftar ini persis:
   {", ".join(EMOTIONS)}
   Pilih yang benar-benar sesuai isi kalimatnya, dan variasikan — jangan selalu
   "tenang". Kalau mereka berdebat, boleh "kesal" atau "marah". Kalau bercanda,
   "tertawa". Kalau kecewa, "sedih".
8. Jangan menulis narasi, tanda kutip di dalam kalimat, atau emoji.

Balas HANYA JSON valid tanpa penjelasan:
{{"lines":[{{"speaker":"a","text":"...","emotion":"senang"}},\
{{"speaker":"b","text":"...","emotion":"tertawa"}}],\
"activities":{{"a":"aktivitas singkat A (maks 3 kata)","b":"aktivitas singkat B (maks 3 kata)"}},\
"thoughts":{{"a":"isi pikiran A (maks 8 kata)","b":"isi pikiran B (maks 8 kata)"}}}}"""


# ------------------------------------------------------------------
# PARSING & VALIDASI
# ------------------------------------------------------------------
def _extract_json(text):
    """Ambil objek JSON pertama dari keluaran model (tahan code fence)."""
    if not text:
        return None
    t = text.strip()
    if t.startswith("```"):
        parts = t.split("```")
        if len(parts) >= 2:
            t = parts[1]
            if t.lower().startswith("json"):
                t = t[4:]
    t = t.strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    start = t.find("{")
    end = t.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(t[start:end + 1])
        except Exception:
            return None
    return None


def _clean_text(s):
    s = str(s or "").strip()
    s = s.replace("\\n", " ").replace("\n", " ")
    s = re.sub(r"\s+", " ", s)
    s = s.strip('"').strip("'").strip()
    if len(s) > MAX_LINE_CHARS:
        s = s[:MAX_LINE_CHARS - 1].rstrip() + "…"
    return s


_BAD_SCRIPT = re.compile(r"[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]")


def looks_indonesian(text):
    """
    Saring kalimat yang jelas rusak (huruf non-Latin, campur bahasa aneh).

    Model gratis kadang mengeluarkan teks campur-campur; lebih baik dianggap
    gagal daripada ditampilkan sebagai obrolan yang tidak masuk akal.
    """
    t = str(text or "")
    if _BAD_SCRIPT.search(t):
        return False
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return False
    weird = sum(1 for c in letters if ord(c) > 0x24F)      # di luar Latin+diakritik
    return weird / len(letters) < 0.12


def validate(obj, room):
    """Bersihkan & validasi keluaran model. Kembalikan (lines, activities, thoughts)."""
    if not isinstance(obj, dict):
        return [], {}, {}

    raw = obj.get("lines")
    if not isinstance(raw, list):
        return [], {}, {}

    lines = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        sp = str(item.get("speaker", "")).strip().lower()
        if sp not in ("a", "b"):
            sp = "a" if i % 2 == 0 else "b"          # perbaiki bila model salah
        txt = _clean_text(item.get("text"))
        if len(txt) < 8:
            continue
        if not looks_indonesian(txt):
            continue
        # Buang duplikat internal
        if any(_similar(txt, l["text"]) >= 0.7 for l in lines):
            continue
        emo = str(item.get("emotion", "")).strip().lower()
        if emo not in EMOTIONS:
            emo = None
        entry = {"speaker": sp, "text": txt}
        if emo:
            entry["emotion"] = emo
        lines.append(entry)
        if len(lines) >= MAX_LINES:
            break
    acts = {}
    a_obj = obj.get("activities")
    if isinstance(a_obj, dict):
        for k in ("a", "b"):
            v = _clean_text(a_obj.get(k))
            if 2 <= len(v) <= 40:
                acts[k] = v

    # Pikiran bebas tiap agent (dipakai untuk label & ingatan mereka)
    thoughts = {}
    t_obj = obj.get("thoughts")
    if isinstance(t_obj, dict):
        for k in ("a", "b"):
            v = _clean_text(t_obj.get(k))
            if 2 <= len(v) <= 60:
                thoughts[k] = v

    return lines, acts, thoughts

def _alternate(lines):
    """Paksa giliran A,B,A,B supaya satu pembicara per kalimat (emosi dijaga)."""
    out = []
    for i, l in enumerate(lines):
        item = {"speaker": "a" if i % 2 == 0 else "b", "text": l["text"]}
        if l.get("emotion"):
            item["emotion"] = l["emotion"]
        out.append(item)
    return out


# ------------------------------------------------------------------
# FALLBACK LOKAL (dipakai hanya kalau semua model gagal)
# ------------------------------------------------------------------
def _short(text, limit=58):
    """Pendekkan judul berita agar muat di satu kalimat bubble."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(t) <= limit:
        return t
    cut = t[:limit]
    if " " in cut:
        cut = cut[:cut.rfind(" ")]
    return cut + "…"


def local_fallback(ctx):
    """
    TIDAK ADA dialog template.

    Percakapan HANYA boleh datang dari model AI. Kalau semua penyedia gagal,
    kembalikan daftar kosong: agent tidak akan menampilkan gelembung sama
    sekali, sehingga tidak pernah muncul kalimat buatan yang berulang.
    """
    return [], {}


# ------------------------------------------------------------------
# PEMANGGILAN MODEL
# ------------------------------------------------------------------
def _call_model(model, prompt, api_key, url=None, extra_headers=None):
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.95,
        # Model penalaran memakai token untuk "berpikir" dulu; batas kecil
        # membuat konten akhirnya kosong. Percakapan pendek cukup 1200 token.
        "max_tokens": 1600,
    }).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Mission Control 2D",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if extra_headers:
        headers.update(extra_headers)

    req = urllib.request.Request(url or API_URL, data=payload, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        # Sertakan isi respons supaya penyebabnya jelas (rate limit, model
        # tidak tersedia, dsb.) tanpa membocorkan kunci.
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass

        # Sebagian penyedia (mis. LLM7) meminta menunggu beberapa detik.
        # Kita patuhi SEKALI supaya obrolan tetap jalan, bukan langsung gagal.
        m = re.search(r"[Rr]etry after (\d+)", detail)
        if e.code == 429 and m:
            wait = min(18, int(m.group(1)) + 1)
            time.sleep(wait)
            req2 = urllib.request.Request(url or API_URL, data=payload, headers=headers)
            try:
                with urllib.request.urlopen(req2, timeout=REQUEST_TIMEOUT) as resp:
                    data = json.load(resp)
                detail = ""          # berhasil setelah menunggu
            except Exception:
                raise urllib.error.HTTPError(
                    e.url, e.code, f"{e.reason} :: {detail}", e.hdrs, None) from None
        else:
            raise urllib.error.HTTPError(
                e.url, e.code, f"{e.reason} :: {detail}", e.hdrs, None) from None

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("respons tanpa choices: " + json.dumps(data)[:200])

    choice = choices[0]
    msg = choice.get("message") or {}
    content = msg.get("content") or ""

    # Sebagian model penalaran menaruh hasilnya di field reasoning.
    if not content.strip():
        content = msg.get("reasoning") or msg.get("reasoning_content") or ""

    if not content.strip():
        raise RuntimeError(
            "konten kosong (finish_reason=" + str(choice.get("finish_reason")) + ")")
    return content


def _throttle():
    global _last_call_ts
    with _lock:
        wait = MIN_INTERVAL - (time.time() - _last_call_ts)
        if wait > 0:
            time.sleep(wait)
        _last_call_ts = time.time()


# ------------------------------------------------------------------
# API PUBLIK
# ------------------------------------------------------------------
def generate(ctx, allow_fallback=True):
    """
    Hasilkan dialog dari model AI.

    ctx = {
      "room": "workspace" | "lounge",
      "a": {"name","role","state","task"},
      "b": {...},
      "tasks": [{"id","title","status","owner"}],
      "summary": {"total","done","in_progress"},
      "forbidden": ["kalimat lama", ...]   # opsional
    }

    Kembalikan {"lines":[...], "activities":{...}, "source":"ai"|"fallback",
                "model": str|None, "latency": float|None}
    """
    stats["requests"] += 1
    room = ctx.get("room", "workspace")
    if not ctx.get("forbidden"):
        ctx = dict(ctx)
        ctx["forbidden"] = recent_lines_snapshot(25)

    api_key = _load_api_key()

    prompt = build_prompt(ctx)
    last_err = None
    errors = []
    t_start = time.time()

    # Daftar percobaan: OpenRouter (butuh kunci) lalu LLM7 (tanpa kunci).
    # Jadi walau kuota gratis OpenRouter habis, obrolan tetap dihasilkan AI.
    attempts = []
    if api_key:
        attempts += [(m, api_key, API_URL, "openrouter") for m in MODEL_CHAIN]
    attempts += [(m, None, OVH_URL, "ovh") for m in OVH_MODELS]
    attempts += [(m, None, LLM7_URL, "llm7") for m in LLM7_MODELS]

    for attempt in range(2):                 # percobaan kedua dengan larangan diperkuat
        for model, key, url, prov in attempts:
            # Penyedia yang kuotanya habis dilewati sampai jendela waktunya lewat
            if _is_down(prov):
                continue
            # Batas waktu hanya berlaku untuk percobaan ULANG; percobaan pertama
            # tetap menelusuri semua penyedia supaya obrolan tetap dihasilkan AI.
            if attempt > 0 and time.time() - t_start > 35:
                last_err = (last_err or "") + " | batas waktu tercapai"
                break
            try:
                _throttle()
                t0 = time.time()
                raw = _call_model(model, prompt, key, url)
                dt = time.time() - t0
                obj = _extract_json(raw)
                lines, acts, thoughts = validate(obj, room)
                lines = _alternate(lines)

                # Buang kalimat yang mengulang riwayat
                fresh = [l for l in lines if not is_repeat(l["text"])]
                rejected = len(lines) - len(fresh)

                if len(fresh) >= MIN_LINES:
                    with _lock:
                        stats["rejected_repeats"] += rejected
                    remember_lines([l["text"] for l in fresh])
                    stats["ai_ok"] += 1
                    stats["last_model"] = f"{prov}/{model}"
                    stats["last_latency"] = round(dt, 2)
                    stats["last_error"] = None
                    note_topics_in(fresh)
                    return {"lines": _alternate(fresh), "activities": acts,
                            "thoughts": thoughts,
                            "source": "ai", "model": f"{prov}/{model}",
                            "latency": round(dt, 2)}

                last_err = (f"{prov}/{model}: hasil hanya {len(fresh)} kalimat baru "
                            f"(dari {len(lines)}), terlalu banyak pengulangan")
                errors.append(last_err)
            except urllib.error.HTTPError as e:
                last_err = f"{prov}/{model}: HTTP {e.code} {str(e.reason)[:200]}"
                errors.append(last_err)
                if e.code == 429:
                    detail = str(e.reason)
                    if "per-day" in detail or "quota" in detail:
                        _mark_down(prov)          # kuota habis → lewati 15 menit
                    else:
                        time.sleep(1.0)
            except Exception as e:
                last_err = f"{prov}/{model}: {type(e).__name__}: {e}"
                errors.append(last_err)

        # Perkuat larangan untuk percobaan berikutnya
        banned = recent_lines_snapshot(40)
        ctx = dict(ctx)
        ctx["forbidden"] = banned
        prompt = build_prompt(ctx)

    stats["ai_failed"] += 1
    stats["last_error"] = last_err
    stats["last_errors"] = errors[-6:]
    if not allow_fallback:
        return {"lines": [], "activities": {}, "source": "none",
                "model": None, "latency": None, "error": last_err}

    # Semua penyedia gagal: JANGAN memakai kalimat template.
    # Agent cukup diam (tidak mengobrol) sampai model tersedia lagi.
    stats["fallback"] += 1
    return {"lines": [], "activities": {}, "source": "none",
            "model": None, "latency": None, "error": last_err}


def think(ctx):
    """
    Satu agent memutuskan SENDIRI apa yang dia lakukan dan pikirkan.

    Ini yang membuat agent hidup tanpa disuruh: keputusan (bekerja, mengobrol,
    berkeliaran, beristirahat) beserta alasannya datang dari model AI, bukan
    dari aturan tetap di kode.

    ctx = {"agent": {...}, "focus": {...}|None, "recent_changes": [...],
           "open_tasks": [...], "peers": ["Nama", ...], "room": "lounge"}

    Kembalikan {"action","reason","thought","activity","mood","source","model"}
    """
    agent = ctx.get("agent") or {}
    focus = ctx.get("focus")
    recent = ctx.get("recent_changes", [])[:4]
    open_tasks = ctx.get("open_tasks", [])[:4]
    peers = ctx.get("peers", [])[:5]
    peer_states = ctx.get("peer_states", [])[:5]
    room = ctx.get("room") or "workspace"

    # Rekan ditampilkan lengkap dengan keadaannya, supaya agent bisa
    # MELIHAT rekan mana yang sedang membutuhkan bantuan.
    peer_lines = []
    for i, name in enumerate(peers):
        ps = peer_states[i] if i < len(peer_states) else {}
        st = (ps or {}).get("state") or "?"
        tk = (ps or {}).get("task") or "tanpa pekerjaan"
        peer_lines.append(f'- {name}: sedang {st}, pekerjaan "{tk}"')
    peers_block = "\n".join(peer_lines) if peer_lines else "- (tidak ada rekan yang terlihat)"

    stats["requests"] += 1

    task = agent.get("task")

    world_block = ""
    if world_feed is not None:
        w = world_feed.for_prompt(limit_news=4, limit_trends=5, limit_tech=2)
        parts = []
        if w["news"]:
            parts.append("Berita terkini: " + " | ".join(w["news"]))
        if w["trends"]:
            parts.append("Sedang ramai dibicarakan: " + ", ".join(w["trends"]))
        if w["tech"]:
            parts.append("Kabar teknologi: " + " | ".join(w["tech"]))
        if parts:
            world_block = ("\nYANG SEDANG RAMAI DI DUNIA NYATA (nyata, bukan karangan):\n"
                           + "\n".join(f"- {p}" for p in parts) + "\n")

    prompt = f"""Kamu adalah {agent.get('name')} ({agent.get('role')}), seorang agent AI
yang benar-benar hidup dan bekerja di kantor "Mission Control 2D".
Kepribadianmu: {agent.get('persona') or persona_for(agent)}

KEADAANMU SEKARANG
- Bidang keahlianmu: {agent.get('specialty') or 'umum'}
- Pekerjaan yang sedang kamu pegang: "{task or 'tidak ada'}"
- Kamu sedang berada di: {ROOM_LABEL.get(room, room)}
{peers_block}
- Pekerjaan yang belum selesai di kantor: {'; '.join(open_tasks) if open_tasks else '(tidak ada)'}

YANG BARU TERJADI DI KANTOR
- Perubahan yang baru terdeteksi: {focus["title"] if focus else "(tidak ada yang baru)"}\
{f" — status {focus['status']}, pemegang {focus.get('owner') or 'belum ada'}" if focus else ""}
- Perubahan terakhir: {'; '.join(recent) if recent else '(belum ada)'}
{world_block}
TUGASMU
Putuskan sendiri apa yang kamu lakukan SEKARANG, sebagai dirimu sendiri.
Kamu bebas memilih. Tidak ada jawaban yang salah.

Kamu orang yang cerdas dan punya pendapat sendiri:
- Kalau kamu memegang pekerjaan yang masih berjalan, fokus utamamu adalah
  memajukan atau membereskan pekerjaan itu.
- KAMU BISA MELIHAT REKANMU. Kalau ada rekan yang kelihatan sedang kesulitan,
  pekerjaannya menumpuk, atau sedang menunggu bantuan, NAIKAN TANGAN: pilih
  action "help" dan sebut nama rekamu. Bantuan harus masuk akal dengan
  keahlianmu (mis. developer backend membantu memperbaiki API).
- Kalau tidak ada pekerjaan untukmu, kamu bebas: berkeliaran, mengobrol dengan
  rekan, beristirahat, atau memikirkan kabar yang sedang ramai di dunia nyata
  (berita, tren, olahraga, film, musik — ambil HANYA dari daftar di atas).
- Kamu boleh punya penilaian sendiri, merasa tidak setuju, penasaran, atau
  ingin membahas sesuatu yang menurutmu penting. Jangan mengarang fakta.

Balas HANYA JSON valid:
{{"action":"work"|"talk"|"wander"|"rest"|"inspect"|"help",
"target":"nama rekan yang mau kamu bantu, atau string kosong kalau tidak membantu",
"reason":"alasan singkat dalam bahasa Indonesia (maks 12 kata)",
"thought":"pikiranmu saat ini dalam bahasa Indonesia (maks 12 kata)",
"activity":"kegiatanmu, maksimal 3 kata dalam bahasa Indonesia",
"mood":"emosimu saat ini, pilih SATU: {", ".join(EMOTIONS)}"}}"""

    api_key = _load_api_key()

    last_err = None
    attempts = []
    if api_key:
        attempts += [(m, api_key, API_URL, "openrouter") for m in MODEL_CHAIN]
    attempts += [(m, None, OVH_URL, "ovh") for m in OVH_MODELS]
    attempts += [(m, None, LLM7_URL, "llm7") for m in LLM7_MODELS]

    for model, key, url, prov in attempts:
        if _is_down(prov):
            continue
        try:
            _throttle()
            t0 = time.time()
            raw = _call_model(model, prompt, key, url)
            dt = time.time() - t0
            obj = _extract_json(raw)
            if not isinstance(obj, dict):
                last_err = f"{model}: JSON tidak valid"
                continue

            action = str(obj.get("action", "")).strip().lower()
            if action not in ("work", "talk", "wander", "rest", "inspect", "help"):
                action = "work" if task else "rest"
            target = _clean_text(obj.get("target"))[:32] if action == "help" else ""

            def clean(key, limit):
                v = _clean_text(obj.get(key))
                return v[:limit] if v else ""

            # Emosi: harus salah satu dari daftar, kalau tidak dicocokkan sebagian
            mood_raw = clean("mood", 24).lower()
            emotion = mood_raw if mood_raw in EMOTIONS else None
            if not emotion:
                for e in EMOTIONS:
                    if e in mood_raw:
                        emotion = e
                        break
            if not emotion:
                emotion = "tenang"

            stats["ai_ok"] += 1
            stats["last_model"] = f"{prov}/{model}"
            stats["last_latency"] = round(dt, 2)
            stats["last_error"] = None
            return {
                "action": action,
                "target": target,
                "reason": clean("reason", 90),
                "thought": clean("thought", 90),
                "activity": clean("activity", 32) or "Berkegiatan",
                "mood": emotion,
                "emotion": emotion,
                "source": "ai", "model": f"{prov}/{model}",
                "latency": round(dt, 2),
            }
        except urllib.error.HTTPError as e:
            last_err = f"{prov}/{model}: HTTP {e.code} {str(e.reason)[:200]}"
            if e.code == 429:
                detail = str(e.reason)
                if "per-day" in detail or "quota" in detail:
                    _mark_down(prov)
                else:
                    time.sleep(1.0)
        except Exception as e:
            last_err = f"{prov}/{model}: {type(e).__name__}: {e}"

    stats["ai_failed"] += 1
    stats["last_error"] = last_err
    return {"action": "work" if task else "rest", "reason": "",
            "thought": "", "activity": "Menunggu", "mood": "tenang",
            "source": "fallback", "model": None, "error": last_err}


def reset_history():
    """Kosongkan riwayat anti-pengulangan (untuk pengujian)."""
    with _lock:
        _recent_lines.clear()
        _recent_topics.clear()
        _used_pairs.clear()
