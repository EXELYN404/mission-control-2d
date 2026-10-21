#!/usr/bin/env python3
"""
Chat — balasan agen natural + jembatan CLI EXELYN AGENT AI.
=========================================================

Dua kemampuan yang sengaja dipisah:

1. `agent_reply()` — seorang agen menjawab pengguna dengan suara dan
   kepribadiannya sendiri, memakai model AI yang sama dengan otak agen
   (rantai OpenRouter → OVH → LLM7). Inilah yang memunculkan gelembung di
   atas kepala agen di kantor 2D.

2. `hermes_oneshot()` — menjalankan `hermes -z` (mode one-shot CLI EXELYN
   AGENT AI) sehingga seluruh kemampuan CLI nyata — AI, skills, tools,
   sistem berkas — tetap tersedia. Menu chat tidak menampung proses
   interaktif; ia hanya menembakkan satu prompt dan menerima hasilnya.

Tidak ada respons karangan: bila model tidak tersedia, fungsi mengembalikan
status fallback yang jujur, bukan teks yang menyamar sebagai jawaban agen.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path

import ai_dialogue

# ------------------------------------------------------------------
# KONFIGURASI
# ------------------------------------------------------------------
HERMES_BIN = os.environ.get("HERMES_BIN") or "hermes"

# Direktori kerja default untuk tugas CLI Hermes.
DEFAULT_WORKDIR = Path(os.environ.get("EXELYN_CHAT_WORKDIR")
                       or (Path(__file__).resolve().parent))

# Batas waktu: cukup untuk satu respons AI, tidak menahan pengguna selamanya.
HERMES_TIMEOUT = int(os.environ.get("HERMES_ONESHOT_TIMEOUT") or 600)
REPLY_TIMEOUT = float(os.environ.get("AGENT_REPLY_TIMEOUT") or 60)


class ChatError(Exception):
    """Kegagalan chat yang bisa dijelaskan ke pengguna."""

    def __init__(self, message, *, code="CHAT_ERROR", hint=None):
        super().__init__(message)
        self.code = code
        self.hint = hint


# ------------------------------------------------------------------
# 1. BALASAN AGEN (model AI nyata, natural)
# ------------------------------------------------------------------
_REPLY_SYS = """Kamu adalah {name}, {role} yang bekerja di kantor "Mission Control 2D".
Kepribadianmu: {persona}

Aturan:
- Jawab PESAN PENGGUNA di bawah sebagai dirimu sendiri, dengan suaramu.
- Bahasa Indonesia yang natural, seperti orang benar-benar bicara — bukan
  daftar, bukan laporan, bukan markdown.
- MAKSIMAL 2 kalimat. Langsung ke inti. Boleh bertanya balik bila perlu.
- Jangan menyebut nama diri sendiri di awal jawaban.
- Jangan mengaku mengerjakan hal yang belum kamu lakukan.
- Jawab sesuai kepribadianmu di atas, jangan diseragamkan.
- Keluarkan HANYA teks jawaban, tanpa tanda kutip pembuka/penutup."""

_REPLY_USER = """Keadaanmu sekarang: sedang {state}{task_clause}.
Pesan dari pengguna: {message}

Jawab sekarang."""


def _reply_prompt(agent, message, state=None, task=None):
    state = state or agent.get("state") or "bekerja"
    task = task if task is not None else agent.get("current_task")
    task_clause = f', sedang mengerjakan "{task}"' if task else ""
    sys_txt = _REPLY_SYS.format(
        name=agent.get("name") or "Agen",
        role=agent.get("role") or "anggota tim",
        persona=ai_dialogue.persona_for(agent),
    )
    user_txt = _REPLY_USER.format(state=state, task_clause=task_clause,
                                  message=message)
    return sys_txt, user_txt


def agent_reply(agent, message, *, state=None, task=None, allow_fallback=True):
    """
    Satu agen menjawab pesan pengguna memakai model AI nyata.

    Mengembalikan:
      {"ok":True, "text":..., "source":"ai"|"fallback", "model":...,
       "latency":..., "emotion":..., "mood":...}
    """
    message = (message or "").strip()
    if not message:
        raise ChatError("Pesan kosong.", code="EMPTY_MESSAGE")
    if not isinstance(agent, dict) or not agent.get("name"):
        raise ChatError("Agen tidak dikenal.", code="UNKNOWN_AGENT")

    api_key = ai_dialogue._load_api_key()
    sys_txt, user_txt = _reply_prompt(agent, message, state, task)
    prompt = f"{sys_txt}\n\n{user_txt}"

    attempts = []
    if api_key:
        attempts += [(m, api_key, ai_dialogue.API_URL, "openrouter")
                     for m in ai_dialogue.MODEL_CHAIN]
    attempts += [(m, None, ai_dialogue.OVH_URL, "ovh")
                 for m in ai_dialogue.OVH_MODELS]
    attempts += [(m, None, ai_dialogue.LLM7_URL, "llm7")
                 for m in ai_dialogue.LLM7_MODELS]

    last_err = None
    for model, key, url, prov in attempts:
        if ai_dialogue._is_down(prov):
            continue
        try:
            ai_dialogue._throttle()
            t0 = time.time()
            import urllib.request
            payload = json.dumps({
                "model": model,
                "messages": [
                    {"role": "system", "content": sys_txt},
                    {"role": "user", "content": user_txt},
                ],
                "temperature": 0.95,
                "max_tokens": 320,
            }).encode("utf-8")
            headers = {"Content-Type": "application/json"}
            if key:
                headers["Authorization"] = f"Bearer {key}"
            req = urllib.request.Request(url, data=payload, headers=headers)
            with urllib.request.urlopen(req, timeout=REPLY_TIMEOUT) as resp:
                data = json.load(resp)
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError("respons tanpa choices")
            content = ((choices[0].get("message") or {}).get("content") or "").strip()
            if not content:
                content = ((choices[0].get("message") or {})
                           .get("reasoning_content") or "").strip()
            if not content:
                raise RuntimeError("model mengembalikan jawaban kosong")

            latency = round(time.time() - t0, 2)
            text = ai_dialogue._clean_text(content)
            if ai_dialogue.is_repeat(text):
                raise RuntimeError("jawaban terlalu mirip dengan sebelumnya")
            ai_dialogue.remember_lines([text])

            return {
                "ok": True,
                "text": text,
                "source": "ai",
                "model": f"{prov}/{model}",
                "latency": latency,
                "emotion": _pick_emotion(text),
            }
        except Exception as exc:
            last_err = f"{prov}/{model}: {type(exc).__name__}: {exc}"
            if isinstance(exc, Exception) and "429" in str(exc):
                ai_dialogue._mark_down(prov)
            continue

    if not allow_fallback:
        raise ChatError(f"Model AI tidak tersedia: {last_err}",
                        code="AI_UNAVAILABLE")

    # Fallback JUJUR: pengguna tahu ini bukan jawaban model.
    return {
        "ok": False,
        "text": "",
        "source": "fallback",
        "model": None,
        "latency": None,
        "emotion": None,
        "error": "Model AI sedang sibuk. Coba lagi dalam beberapa menit.",
    }


def _pick_emotion(text):
    """Tebak emosi dari kosakata sederhana — hanya untuk label UI."""
    t = (text or "").lower()
    if any(w in t for w in ("haha", "wkwk", "tertawa", "lucu")):
        return "tertawa"
    if any(w in t for w in ("sedih", "menyesal", "gagal total")):
        return "sedih"
    if any(w in t for w in ("marah", "kesal", "sebal")):
        return "kesal"
    if any(w in t for w in ("cemas", "khawatir", "takut")):
        return "cemas"
    if any(w in t for w in ("hebat", "bagus", "senang", "asyik", "mantap")):
        return "senang"
    if any(w in t for w in ("semangat", "ayo", "kita coba")):
        return "semangat"
    if any(w in t for w in ("hmm", "bingung", "ragu")):
        return "bingung"
    return "tenang"


# ------------------------------------------------------------------
# DETEKSI NAMA AGEN
# ------------------------------------------------------------------
def detect_agent(message, agents):
    """
    Kenali agen dari pesan pengguna.

    Mengenali pola: "@Vera ...", "Vera, ...", "Vera tolong ...", "Vera: ...",
    atau nama yang muncul di awal kalimat. Cocok tanpa mempedulikan huruf
    besar/kecil, dan tidak tertukar dengan kata lain yang kebetulan mengandung
    nama agen.

    Mengembalikan agent dict atau None.
    """
    text = (message or "").strip()
    if not text:
        return None

    norm = {str(a.get("name") or "").strip().lower(): a for a in agents if a.get("name")}
    if not norm:
        return None

    # Pola eksplisit: @Nama di awal (satu kata, tanpa spasi)
    m = re.match(r"^@([A-Za-z][\w\-]{0,39})\b", text)
    if m and m.group(1).strip().lower() in norm:
        return norm[m.group(1).strip().lower()]

    # Nama di awal kalimat, diikuti tanda baca/pisah/kata tugas
    first = re.split(r"[\s,:;.!?\-]+", text, maxsplit=1)[0].lower()
    if first in norm:
        return norm[first]

    # Sebutan di awal dengan sapaan: "Vera tolong ...", "Vera, tolong ..."
    m = re.match(r"^([A-Za-z][\w .\-]{0,30}?)\s+(?:tolong|mohon|buatkan|buat|"
                 r"kerjakan|carikan|jelaskan|analisa|analisis|bantu|"
                 r"bikin|tolongkan)\b", text, re.IGNORECASE)
    if m:
        key = m.group(1).strip().lower()
        if key in norm:
            return norm[key]

    # Nama lain yang muncul di 2 kata pertama (toleran, tapi hanya nama utuh)
    words = [w.strip(",.!:;?\"'").lower() for w in text.split()[:2]]
    for w in words:
        if w in norm:
            return norm[w]
    return None


def strip_mention(message, agent):
    """Buang sebutan nama agen dari awal pesan sebelum dikirim ke model."""
    text = (message or "").strip()
    if not agent or not agent.get("name"):
        return text
    name = re.escape(str(agent["name"]).strip())
    text = re.sub(rf"^@{name}\b[,\s]*", "", text, flags=re.IGNORECASE)
    text = re.sub(rf"^{name}\b[,\s]*", "", text, flags=re.IGNORECASE)
    return text.strip() or (message or "").strip()


# ------------------------------------------------------------------
# 2. JEMBATAN CLI EXELYN AGENT AI (hermes -z)
# ------------------------------------------------------------------
# Cache ketersediaan Hermes supaya tidak menjalankan subprocess setiap panggilan.
_hermes_cache = {"ok": None, "info": None, "ts": 0}
_HERMES_CACHE_TTL = 300  # detik

def hermes_available():
    """Apakah executable hermes ada dan bisa dijalankan?"""
    global _hermes_cache
    now = time.time()
    if _hermes_cache["ok"] is not None and (now - _hermes_cache["ts"]) < _HERMES_CACHE_TTL:
        return _hermes_cache["ok"], _hermes_cache["info"]

    path = None
    for cand in (HERMES_BIN, os.path.expanduser("~/.local/bin/hermes")):
        if os.path.sep in cand:
            if Path(cand).exists():
                path = cand
                break
        else:
            import shutil
            if shutil.which(cand):
                path = cand
                break
    if not path:
        _hermes_cache = {"ok": False, "info": f"'{HERMES_BIN}' tidak ditemukan.", "ts": now}
        return False, _hermes_cache["info"]
    try:
        out = subprocess.run([path, "--version"], capture_output=True,
                             text=True, timeout=60)
    except Exception as exc:
        _hermes_cache = {"ok": False, "info": f"Tidak dapat menjalankan hermes: {exc}", "ts": now}
        return False, _hermes_cache["info"]
    result = (True, (out.stdout or "").strip().splitlines()[0] if out.stdout else "hermes")
    _hermes_cache = {"ok": result[0], "info": result[1], "ts": now}
    return result


def hermes_oneshot(prompt, *, workdir=None, model=None, provider=None,
                   timeout=None, extra_args=None):
    """
    Jalankan `hermes -z` — mode one-shot CLI EXELYN AGENT AI.

    Menu chat TIDAK menjalankan proses interaktif: ini menembakkan satu
    prompt dan menunggu hasilnya, lalu prosesnya selesai. Seluruh kemampuan
    CLI (AI, skills, tools) ikut terpakai karena yang dijalankan adalah
    binary Hermes yang sesungguhnya.

    Mengembalikan {"ok":True,"output":...,"exit_code":...,"latency":...}
    atau melempar ChatError.
    """
    ok, info = hermes_available()
    if not ok:
        raise ChatError(info, code="HERMES_MISSING",
                        hint="Pasang CLI EXELYN AGENT AI lalu set HERMES_BIN.")

    cwd = Path(workdir or DEFAULT_WORKDIR).expanduser().resolve()
    if not cwd.is_dir():
        raise ChatError(f"Direktori kerja tidak ada: {cwd}", code="BAD_WORKDIR")

    cmd = [HERMES_BIN, "-z", prompt, "--in", str(cwd)]
    if model:
        cmd += ["-m", str(model)]
    if provider:
        cmd += ["--provider", str(provider)]
    for arg in (extra_args or []):
        cmd.append(str(arg))

    t0 = time.time()
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout or HERMES_TIMEOUT, cwd=str(cwd),
        )
    except subprocess.TimeoutExpired:
        raise ChatError(
            f"Tugas CLI melebihi batas waktu {timeout or HERMES_TIMEOUT} detik. "
            "Proses dihentikan — tidak ada tugas ganda yang berjalan.",
            code="HERMES_TIMEOUT",
        )

    latency = round(time.time() - t0, 2)
    output = (proc.stdout or "").strip()

    if proc.returncode != 0 and not output:
        raise ChatError(
            f"Hermes berhenti dengan kode {proc.returncode}: "
            f"{(proc.stderr or '').strip()[:300]}",
            code="HERMES_FAILED",
        )

    if not output:
        raise ChatError("Hermes tidak menghasilkan keluaran.",
                        code="HERMES_EMPTY")

    return {
        "ok": True,
        "output": output,
        "exit_code": proc.returncode,
        "latency": latency,
        "workdir": str(cwd),
    }


# ------------------------------------------------------------------
# 3. ORKESTRASI SATU PESAN
# ------------------------------------------------------------------
def handle_message(message, agents, *, selected_agent_id=None, workdir=None,
                   prefer_cli=False):
    """
    Satu fungsi untuk alur chat:

      1. Bila pesan menyebut nama agen → agen itu menjawab (model AI nyata),
         cocok untuk memunculkan gelembung di kantor 2D.
      2. Bila pengguna memilih mode CLI penuh → `hermes -z` menjalankan tugas.

    Mengembalikan dict dengan `mode` ("agent" | "cli") dan hasilnya.
    """
    text = (message or "").strip()
    if not text:
        raise ChatError("Pesan kosong.", code="EMPTY_MESSAGE")

    agent = None
    if selected_agent_id:
        agent = next((a for a in agents if a.get("id") == selected_agent_id), None)
    if agent is None:
        agent = detect_agent(text, agents)

    if agent is not None and not prefer_cli:
        clean = strip_mention(text, agent)
        reply = agent_reply(agent, clean)
        return {
            "mode": "agent",
            "agent_id": agent.get("id"),
            "agent_name": agent.get("name"),
            "agent_role": agent.get("role"),
            "question": clean,
            "reply": reply,
            "bubble": reply.get("text") if reply.get("ok") else None,
            "source": reply.get("source"),
            "model": reply.get("model"),
            "latency": reply.get("latency"),
            "emotion": reply.get("emotion"),
        }

    # Mode CLI penuh (Hermes)
    result = hermes_oneshot(text, workdir=workdir)
    return {
        "mode": "cli",
        "agent_id": None,
        "agent_name": "Hermes CLI",
        "agent_role": "EXELYN AGENT AI — CLI penuh (AI, skills, tools)",
        "question": text,
        "reply": {"ok": True, "text": result["output"], "source": "cli",
                  "model": "hermes", "latency": result["latency"], "emotion": None},
        "bubble": None,
        "source": "cli",
        "model": "hermes",
        "latency": result["latency"],
        "emotion": None,
        "workdir": result["workdir"],
    }


def status():
    """Status kapabilitas chat (untuk endpoint /api/chat/status)."""
    ok, info = hermes_available()
    return {
        "ok": True,
        "hermes": {"available": ok, "version": info if ok else None,
                   "error": None if ok else info, "bin": HERMES_BIN},
        "reply_engine": {
            "models": list(ai_dialogue.MODEL_CHAIN) + list(ai_dialogue.OVH_MODELS)
                      + list(ai_dialogue.LLM7_MODELS),
            "timeout": REPLY_TIMEOUT,
        },
        "workdir": str(DEFAULT_WORKDIR),
        "hermes_timeout": HERMES_TIMEOUT,
    }


if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        print(json.dumps(status(), indent=2, ensure_ascii=False))
    elif cmd == "detect":
        agents = json.loads(sys.argv[2])
        msg = sys.argv[3]
        found = detect_agent(msg, agents)
        print(json.dumps({"message": msg, "agent": found}, indent=2, ensure_ascii=False))
    elif cmd == "hermes":
        try:
            print(json.dumps(hermes_oneshot(sys.argv[2]), indent=2, ensure_ascii=False))
        except ChatError as exc:
            print(json.dumps({"ok": False, "error": str(exc), "code": exc.code},
                             indent=2, ensure_ascii=False))
            sys.exit(1)
    else:
        print(f"Perintah tidak dikenal: {cmd}", file=sys.stderr)
        sys.exit(2)
