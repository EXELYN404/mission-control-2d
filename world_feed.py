#!/usr/bin/env python3
"""
World Feed — Mission Control 2D
================================
Mengambil topik NYATA yang sedang dibicarakan manusia di dunia: berita
terkini Indonesia, tren pencarian, dan berita teknologi.

Kenapa ini ada: supaya obrolan para agent bukan karangan. Mereka membahas
hal yang benar-benar sedang ramai — bukan tema buatan yang ditulis di kode.

Semua sumber di bawah GRATIS dan TIDAK butuh API key. Hasilnya disimpan
ke cache (memori + berkas) supaya dashboard tetap cepat dan tidak
menghujani sumber berita dengan permintaan.
"""

import json
import os
import re
import threading
import time
import urllib.request

CACHE_PATH = os.path.expanduser("~/.hermes/cache/scratch/mc2d_world_feed.json")
CACHE_TTL = 600                # detik — 10 menit
REQUEST_TIMEOUT = 12
MAX_PER_SOURCE = 10

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; MissionControl2D/1.0)"}

_lock = threading.Lock()
_cache = {"ts": 0, "data": None}
stats = {"fetches": 0, "ok": 0, "failed": 0, "last_error": None,
         "last_fetch": None, "sources_ok": []}

SOURCES = [
    {"id": "google_news_id", "label": "Google Berita Indonesia", "kind": "rss",
     "url": "https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id"},
    {"id": "antara", "label": "Antara News", "kind": "rss",
     "url": "https://www.antaranews.com/rss/terkini.xml"},
    {"id": "google_trends_id", "label": "Tren Google Indonesia", "kind": "rss",
     "url": "https://trends.google.com/trending/rss?geo=ID"},
    {"id": "hackernews", "label": "Hacker News", "kind": "hn",
     "url": "https://hacker-news.firebaseio.com/v0/topstories.json"},
]


# ------------------------------------------------------------------
def _get(url, as_json=False):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8", "replace")) if as_json else raw.decode("utf-8", "replace")


def _clean_title(t):
    """Rapikan judul RSS: buang CDATA, tag, entitas, dan spasi berlebih."""
    t = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", t, flags=re.S)
    t = re.sub(r"<[^>]+>", "", t)
    t = (t.replace("&amp;", "&").replace("&quot;", '"')
          .replace("&#39;", "'").replace("&apos;", "'")
          .replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " "))
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _rss_titles(xml_text, limit=MAX_PER_SOURCE):
    """Ambil judul dari sebuah feed RSS (tanpa pustaka tambahan)."""
    titles = []
    for block in re.findall(r"<item[^>]*>(.*?)</item>", xml_text, flags=re.S):
        m = re.search(r"<title[^>]*>(.*?)</title>", block, flags=re.S)
        if not m:
            continue
        t = _clean_title(m.group(1))
        if not t or len(t) < 6:
            continue
        # Google Berita menambahkan " - Nama Media" di belakang judul
        t = re.sub(r"\s+-\s+[^-]{2,40}$", "", t) if t.count(" - ") else t
        if t not in titles:
            titles.append(t)
        if len(titles) >= limit:
            break
    return titles


def _hn_titles(limit=6):
    """Ambil judul teratas Hacker News (perlu satu permintaan per cerita)."""
    ids = _get(SOURCES[3]["url"], as_json=True)
    out = []
    for sid in (ids or [])[:limit]:
        try:
            item = _get(f"https://hacker-news.firebaseio.com/v0/item/{sid}.json",
                        as_json=True)
            t = _clean_title(str(item.get("title") or ""))
            if t and t not in out:
                out.append(t)
        except Exception:
            continue
    return out


# ------------------------------------------------------------------
def fetch_all(force=False):
    """
    Ambil topik dunia nyata dari semua sumber.

    Kembalikan dict: {"news": [...], "trends": [...], "tech": [...],
                      "updated": iso, "sources": [...]}
    """
    with _lock:
        now = time.time()
        if not force and _cache["data"] and (now - _cache["ts"]) < CACHE_TTL:
            return _cache["data"]

        stats["fetches"] += 1
        data = {"news": [], "trends": [], "tech": [], "sources": [],
                "updated": time.strftime("%Y-%m-%d %H:%M:%S")}
        errors = []

        for src in SOURCES:
            try:
                if src["kind"] == "hn":
                    titles = _hn_titles()
                    data["tech"].extend(titles)
                elif src["id"] == "google_trends_id":
                    titles = _rss_titles(src["url"] and _get(src["url"]))
                    data["trends"].extend(titles)
                else:
                    titles = _rss_titles(_get(src["url"]))
                    data["news"].extend(titles)
                data["sources"].append({"id": src["id"], "label": src["label"],
                                        "count": len(titles), "ok": True})
            except Exception as e:
                errors.append(f"{src['id']}: {type(e).__name__}: {str(e)[:90]}")
                data["sources"].append({"id": src["id"], "label": src["label"],
                                        "count": 0, "ok": False})

        # Buang duplikat antar sumber
        for key in ("news", "trends", "tech"):
            seen, uniq = set(), []
            for t in data[key]:
                k = t.lower()
                if k in seen:
                    continue
                seen.add(k)
                uniq.append(t)
            data[key] = uniq[:MAX_PER_SOURCE]

        got_any = bool(data["news"] or data["trends"] or data["tech"])
        if got_any:
            _cache["data"] = data
            _cache["ts"] = now
            stats["ok"] += 1
            stats["last_error"] = None
            stats["last_fetch"] = data["updated"]
            stats["sources_ok"] = [s["id"] for s in data["sources"] if s["ok"]]
            _save(data)
        else:
            stats["failed"] += 1
            stats["last_error"] = "; ".join(errors[-3:]) or "semua sumber kosong"
            # Pakai cache berkas bila ada (jangan pernah mengarang topik)
            disk = _load()
            if disk:
                return disk
        return data


def _save(data):
    try:
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


def _load():
    try:
        if os.path.exists(CACHE_PATH):
            with open(CACHE_PATH, encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None


def cached():
    """Topik dari cache (memori → berkas) tanpa memanggil jaringan."""
    with _lock:
        if _cache["data"]:
            return _cache["data"]
    disk = _load()
    if disk:
        with _lock:
            _cache["data"] = disk
            _cache["ts"] = 0            # biarkan diperbarui saat diminta
        return disk
    return {"news": [], "trends": [], "tech": [], "sources": [], "updated": None}


def for_prompt(limit_news=5, limit_trends=5, limit_tech=3):
    """
    Bentuk ringkas untuk prompt model: hal yang benar-benar sedang ramai.
    Selalu kembalikan struktur (boleh kosong) supaya prompt tetap valid.
    """
    d = cached()
    return {
        "news": (d.get("news") or [])[:limit_news],
        "trends": (d.get("trends") or [])[:limit_trends],
        "tech": (d.get("tech") or [])[:limit_tech],
        "updated": d.get("updated"),
    }


if __name__ == "__main__":
    import sys
    data = fetch_all(force="--force" in sys.argv)
    print("Sumber:")
    for s in data["sources"]:
        print(f"  [{'OK ' if s['ok'] else 'GAGAL'}] {s['label']:24} {s['count']} item")
    print(f"\nBerita ({len(data['news'])}):")
    for t in data["news"][:6]:
        print("  -", t)
    print(f"\nTren ({len(data['trends'])}):")
    for t in data["trends"][:8]:
        print("  -", t)
    print(f"\nTeknologi ({len(data['tech'])}):")
    for t in data["tech"][:5]:
        print("  -", t)
    print("\nstat:", {k: v for k, v in stats.items() if k != "sources_ok"})
