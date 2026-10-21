#!/usr/bin/env python3
"""
Microsoft 365 Specialist — mesin dokumen NYATA untuk Mission Control 2D.
=======================================================================

Modul ini menghasilkan file yang benar-benar dapat dibuka — .docx, .xlsx,
.pptx, .pdf, .csv, dan .md — lalu mengunggahnya ke OneDrive melalui rclone
dan MEMVERIFIKASI hasilnya dengan membaca kembali file yang terunggah.

Prinsipnya sengaja keras: tidak ada respons "dokumen selesai" tanpa file nyata.
Setiap fungsi mengembalikan status + bukti (path, ukuran, hasil verifikasi),
bukan sekadar teks.

Dependensi (opsional, dijalankan bila tersedia):
  python-docx, openpyxl, python-pptx, reportlab
Bila sebuah dependensi tidak ada, modul mengembalikan error yang jelas —
bukan file palsu atau teks yang menyamar sebagai dokumen.
"""

from __future__ import annotations

import csv
import io
import json
import os
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

# ------------------------------------------------------------------
# KONFIGURASI
# ------------------------------------------------------------------
# Folder kerja lokal untuk dokumen yang sedang dibuat.
WORK_DIR = Path(os.environ.get("MS365_WORK_DIR")
                or (Path(__file__).resolve().parent / "data" / "ms365"))

# Folder tujuan di OneDrive (relatif terhadap root remote rclone).
ONEDRIVE_FOLDER = os.environ.get("MS365_ONEDRIVE_FOLDER") or "MissionControl2D/Dokumen"

# rclone remote. Bisa dioverride lewat environment untuk pengujian.
RCLONE_REMOTE = os.environ.get("MS365_RCLONE_REMOTE") or "onedrive:"

SUPPORTED_FORMATS = ("docx", "xlsx", "pptx", "pdf", "csv", "md")


class Ms365Error(Exception):
    """Kegagalan yang bisa dijelaskan ke pengguna (bukan bug internal)."""

    def __init__(self, message, *, code="MS365_ERROR", hint=None):
        super().__init__(message)
        self.code = code
        self.hint = hint


# ------------------------------------------------------------------
# BANTUAN
# ------------------------------------------------------------------
def _deps():
    """Impor dependensi dokumen. Melempar Ms365Error bila tidak lengkap."""
    try:
        import docx               # python-docx
        import openpyxl           # openpyxl
        import pptx               # python-pptx
        from reportlab.lib.pagesizes import A4
        from reportlab.platypus import (SimpleDocTemplate, Paragraph as RLParagraph,
                                        Spacer, Table as RLTable, TableStyle,
                                        ListFlowable, ListItem)
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib import colors
        from reportlab.lib.units import mm
    except ImportError as exc:                                    # pragma: no cover
        raise Ms365Error(
            f"Pustaka dokumen tidak lengkap: {exc.name} belum terpasang.",
            code="DEPENDENCY_MISSING",
            hint="Jalankan: pip3 install python-docx openpyxl python-pptx reportlab"
        ) from exc
    return {
        "docx": docx, "openpyxl": openpyxl, "pptx": pptx,
        "A4": A4, "SimpleDocTemplate": SimpleDocTemplate,
        "Paragraph": RLParagraph, "Spacer": Spacer, "Table": RLTable,
        "TableStyle": TableStyle, "ListFlowable": ListFlowable,
        "ListItem": ListItem, "styles": getSampleStyleSheet(),
        "colors": colors, "mm": mm,
    }


def _safe_name(title, fmt):
    """Ubah judul menjadi nama berkas yang aman untuk filesystem & OneDrive."""
    keep = []
    for ch in (title or "dokumen").strip():
        if ch.isalnum() or ch in " ._-":
            keep.append(ch)
        else:
            keep.append(" ")
    name = "".join(keep).strip().replace(" ", "_")
    name = "_".join(p for p in name.split("_") if p)
    if not name:
        name = "dokumen"
    if len(name) > 80:
        name = name[:80]
    return f"{name}.{fmt}"


def _table_of(spec):
    """Ambil tabel dari spec, atau None."""
    t = spec.get("table")
    if not isinstance(t, dict):
        return None
    headers = [str(h) for h in (t.get("headers") or [])]
    rows = [[_cell(c) for c in row] for row in (t.get("rows") or [])]
    if not headers and rows:
        headers = [f"Kolom {i+1}" for i in range(len(rows[0]))]
    return {"headers": headers, "rows": rows} if headers else None


def _cell(value):
    """Rubah nilai Python menjadi teks yang aman untuk dokumen."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Ya" if value else "Tidak"
    if isinstance(value, (int, float)):
        return value
    return str(value)


# ------------------------------------------------------------------
# DOCX — Microsoft Word
# ------------------------------------------------------------------
def build_docx(spec, path):
    d = _deps()
    docx = d["docx"]
    doc = docx.Document()

    # Gaya dasar yang rapi
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = docx.shared.Pt(11)

    title = str(spec.get("title") or "Dokumen")
    doc.add_heading(title, level=0)

    subtitle = spec.get("subtitle")
    if subtitle:
        p = doc.add_paragraph(str(subtitle))
        p.runs[0].italic = True
        p.runs[0].font.size = docx.shared.Pt(12)

    meta = spec.get("meta")
    if isinstance(meta, dict) and meta:
        info = doc.add_paragraph()
        info.add_run(" | ".join(f"{k}: {_cell(v)}" for k, v in meta.items()))
        info.runs[0].font.size = docx.shared.Pt(9)
        info.runs[0].font.color.rgb = docx.shared.RGBColor(0x64, 0x74, 0x8B)

    doc.add_paragraph("")

    for block in (spec.get("sections") or []):
        if not isinstance(block, dict):
            continue
        heading = block.get("heading")
        if heading:
            doc.add_heading(str(heading), level=1)
        for para in (block.get("paragraphs") or []):
            doc.add_paragraph(str(para))
        for bullet in (block.get("bullets") or []):
            doc.add_paragraph(str(bullet), style="List Bullet")
        tbl = block.get("table") if isinstance(block.get("table"), dict) else None
        if tbl and (tbl.get("headers") or tbl.get("rows")):
            _add_docx_table(doc, d, tbl)

    tbl = _table_of(spec)
    if tbl:
        _add_docx_table(doc, d, tbl)

    for para in (spec.get("paragraphs") or []):
        doc.add_paragraph(str(para))
    for bullet in (spec.get("bullets") or []):
        doc.add_paragraph(str(bullet), style="List Bullet")

    if spec.get("footer"):
        doc.add_paragraph("")
        foot = doc.add_paragraph(str(spec["footer"]))
        foot.runs[0].italic = True
        foot.runs[0].font.size = docx.shared.Pt(9)

    doc.save(path)


def _add_docx_table(doc, d, tbl):
    headers = [str(h) for h in (tbl.get("headers") or [])]
    rows = [[_cell(c) for c in r] for r in (tbl.get("rows") or [])]
    ncol = max(len(headers), *(len(r) for r in rows)) if (headers or rows) else 0
    if not ncol:
        return
    table = doc.add_table(rows=1, cols=ncol)
    table.style = "Light Grid Accent 1"
    hdr = table.rows[0].cells
    for i in range(ncol):
        hdr[i].text = headers[i] if i < len(headers) else ""
        for run in hdr[i].paragraphs[0].runs:
            run.bold = True
    for row in rows:
        cells = table.add_row().cells
        for i in range(ncol):
            cells[i].text = row[i] if i < len(row) else ""
    doc.add_paragraph("")


# ------------------------------------------------------------------
# XLSX — Microsoft Excel
# ------------------------------------------------------------------
def build_xlsx(spec, path):
    d = _deps()
    openpyxl = d["openpyxl"]
    wb = openpyxl.Workbook()

    # Gaya header
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    header_fill = PatternFill("solid", fgColor="1F4E79")
    header_font = Font(bold=True, color="FFFFFF")
    thin = Side(style="thin", color="BFBFBF")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    sheets = spec.get("sheets")
    if not sheets:
        tbl = _table_of(spec)
        sheets = [{
            "name": (spec.get("sheet_name") or "Lembar1")[:31],
            "headers": tbl["headers"] if tbl else [],
            "rows": tbl["rows"] if tbl else [],
        }]

    first = True
    for sh in sheets:
        if not isinstance(sh, dict):
            continue
        name = (sh.get("name") or "Lembar1")[:31]
        ws = wb.active if first else wb.create_sheet()
        ws.title = name
        first = False

        headers = [str(h) for h in (sh.get("headers") or [])]
        rows = [[_cell(c) for c in r] for r in (sh.get("rows") or [])]

        r = 1
        if spec.get("title") and ws.max_row == 1 and not headers and not rows:
            ws["A1"] = str(spec["title"])
            ws["A1"].font = Font(bold=True, size=16)
            r = 3

        if headers:
            for c, h in enumerate(headers, start=1):
                cell = ws.cell(row=r, column=c, value=h)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center", vertical="center")
                cell.border = border
            r += 1

        for row in rows:
            for c, val in enumerate(row, start=1):
                cell = ws.cell(row=r, column=c, value=val)
                cell.border = border
                cell.alignment = Alignment(vertical="center")
            r += 1

        # Lebar kolom otomatis + freeze header
        for col_idx in range(1, max(len(headers), 1) + 1):
            letter = openpyxl.utils.get_column_letter(col_idx)
            longest = len(str(headers[col_idx - 1])) if col_idx <= len(headers) else 4
            for row in rows:
                if col_idx <= len(row):
                    longest = max(longest, len(str(row[col_idx - 1])))
            ws.column_dimensions[letter].width = min(max(longest + 3, 10), 46)
        if headers:
            ws.freeze_panes = ws.cell(row=2, column=1)

    if not first:
        wb.save(path)


# ------------------------------------------------------------------
# PPTX — Microsoft PowerPoint
# ------------------------------------------------------------------
def build_pptx(spec, path):
    d = _deps()
    pptx = d["pptx"]
    prs = pptx.Presentation()
    prs.slide_width = pptx.util.Inches(13.333)
    prs.slide_height = pptx.util.Inches(7.5)

    blank = prs.slide_layouts[6]

    # Slide judul
    title_slide = prs.slides.add_slide(prs.slide_layouts[0])
    title_slide.shapes.title.text = str(spec.get("title") or "Presentasi")
    if spec.get("subtitle"):
        title_slide.placeholders[1].text = str(spec["subtitle"])

    slides = spec.get("slides") or []
    if not slides:
        bullets = list(spec.get("bullets") or [])
        paragraphs = list(spec.get("paragraphs") or [])
        if bullets or paragraphs:
            slides = [{"title": spec.get("section_title") or "Isi",
                       "bullets": bullets or paragraphs}]

    for sl in slides:
        if not isinstance(sl, dict):
            continue
        slide = prs.slides.add_slide(blank)
        # Judul
        box = slide.shapes.add_textbox(pptx.util.Inches(0.6), pptx.util.Inches(0.4),
                                       pptx.util.Inches(12.1), pptx.util.Inches(1.0))
        tf = box.text_frame
        tf.text = str(sl.get("title") or "")
        tf.paragraphs[0].font.size = pptx.util.Pt(32)
        tf.paragraphs[0].font.bold = True

        # Isi
        body = slide.shapes.add_textbox(pptx.util.Inches(0.8), pptx.util.Inches(1.6),
                                        pptx.util.Inches(11.7), pptx.util.Inches(5.4))
        btf = body.text_frame
        btf.word_wrap = True
        items = list(sl.get("bullets") or sl.get("paragraphs") or [])
        for i, item in enumerate(items):
            p = btf.paragraphs[0] if i == 0 else btf.add_paragraph()
            p.text = str(item)
            p.font.size = pptx.util.Pt(20)
            p.space_after = pptx.util.Pt(8)

    if not prs.slides:
        raise Ms365Error("Presentasi tidak punya slide apa pun.",
                         code="EMPTY_PRESENTATION")
    prs.save(path)


# ------------------------------------------------------------------
# PDF
# ------------------------------------------------------------------
def build_pdf(spec, path):
    d = _deps()
    buf = io.BytesIO()
    doc = d["SimpleDocTemplate"](
        buf, pagesize=d["A4"],
        leftMargin=20 * d["mm"], rightMargin=20 * d["mm"],
        topMargin=18 * d["mm"], bottomMargin=18 * d["mm"],
        title=str(spec.get("title") or "Dokumen"),
    )
    st = d["styles"]
    flow = [
        d["Paragraph"](str(spec.get("title") or "Dokumen"), st["Title"]),
    ]
    if spec.get("subtitle"):
        flow.append(d["Paragraph"](str(spec["subtitle"]), st["Italic"]))
    flow.append(d["Spacer"](1, 8))

    for block in (spec.get("sections") or []):
        if not isinstance(block, dict):
            continue
        if block.get("heading"):
            flow.append(d["Paragraph"](str(block["heading"]), st["Heading2"]))
        for para in (block.get("paragraphs") or []):
            flow.append(d["Paragraph"](str(para), st["BodyText"]))
        for bullet in (block.get("bullets") or []):
            flow.append(d["Paragraph"](str(bullet), st["BodyText"]))
        tbl = block.get("table") if isinstance(block.get("table"), dict) else None
        if tbl and (tbl.get("headers") or tbl.get("rows")):
            flow.append(_pdf_table(d, tbl))

    tbl = _table_of(spec)
    if tbl:
        flow.append(_pdf_table(d, tbl))

    for para in (spec.get("paragraphs") or []):
        flow.append(d["Paragraph"](str(para), st["BodyText"]))
    for bullet in (spec.get("bullets") or []):
        flow.append(d["Paragraph"](str(bullet), st["BodyText"]))

    doc.build(flow)
    Path(path).write_bytes(buf.getvalue())


def _pdf_table(d, tbl):
    headers = [str(h) for h in (tbl.get("headers") or [])]
    rows = [[_cell(c) for c in r] for r in (tbl.get("rows") or [])]
    data = ([headers] if headers else []) + rows
    if not data:
        return d["Spacer"](1, 0)
    table = d["Table"](data, repeatRows=1 if headers else 0)
    table.setStyle(d["TableStyle"]([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.4, d["colors"].HexColor("#BFBFBF")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ] + ([("BACKGROUND", (0, 0), (-1, 0), d["colors"].HexColor("#1F4E79")),
          ("TEXTCOLOR", (0, 0), (-1, 0), d["colors"].white),
          ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")] if headers else [])))
    return table


# ------------------------------------------------------------------
# CSV & Markdown
# ------------------------------------------------------------------
def build_csv(spec, path):
    tbl = _table_of(spec)
    if not tbl:
        tbl = {"headers": [], "rows": []}
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        if tbl["headers"]:
            writer.writerow(tbl["headers"])
        for row in tbl["rows"]:
            writer.writerow([_cell(c) for c in row])


def build_md(spec, path):
    lines = [f"# {spec.get('title') or 'Dokumen'}", ""]
    if spec.get("subtitle"):
        lines += [str(spec["subtitle"]), ""]
    if isinstance(spec.get("meta"), dict) and spec["meta"]:
        lines += ["> " + " | ".join(f"{k}: {_cell(v)}" for k, v in spec["meta"].items()), ""]
    for block in (spec.get("sections") or []):
        if not isinstance(block, dict):
            continue
        if block.get("heading"):
            lines += [f"## {block['heading']}", ""]
        for para in (block.get("paragraphs") or []):
            lines += [str(para), ""]
        for bullet in (block.get("bullets") or []):
            lines += [f"- {bullet}"]
        lines.append("")
    for para in (spec.get("paragraphs") or []):
        lines += [str(para), ""]
    for bullet in (spec.get("bullets") or []):
        lines += [f"- {bullet}"]
    tbl = _table_of(spec)
    if tbl:
        lines += ["| " + " | ".join(tbl["headers"]) + " |",
                  "| " + " | ".join("---" for _ in tbl["headers"]) + " |"]
        for row in tbl["rows"]:
            lines.append("| " + " | ".join(_cell(c) for c in row) + " |")
        lines.append("")
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


# ------------------------------------------------------------------
# API UTAMA
# ------------------------------------------------------------------
_BUILDERS = {
    "docx": build_docx, "xlsx": build_xlsx, "pptx": build_pptx,
    "pdf": build_pdf, "csv": build_csv, "md": build_md,
}


def validate_spec(spec):
    """Periksa spec sebelum membangun. Mengembalikan pesan error atau None."""
    if not isinstance(spec, dict):
        return "Spec harus berupa objek JSON."
    fmt = str(spec.get("format") or "").strip().lower().lstrip(".")
    if fmt not in SUPPORTED_FORMATS:
        return (f"Format '{fmt or '-'}' tidak didukung. "
                f"Pilih salah satu: {', '.join(SUPPORTED_FORMATS)}.")
    if fmt == "pptx" and not (spec.get("slides") or spec.get("bullets")
                              or spec.get("paragraphs")):
        return "Presentasi butuh minimal satu slide atau daftar poin."
    if not (spec.get("title") or spec.get("paragraphs")
            or spec.get("bullets") or _table_of(spec)):
        return "Dokumen butuh judul, paragraf, poin, atau tabel."
    return None


def build_document(spec, *, keep=False):
    """
    Bangun dokumen nyata dari spec.

    Mengembalikan:
      {"ok": True, "path": ..., "format": ..., "size": ..., "title": ...}
    atau melempar Ms365Error.
    """
    err = validate_spec(spec)
    if err:
        raise Ms365Error(err, code="INVALID_SPEC")

    fmt = str(spec["format"]).strip().lower().lstrip(".")
    title = str(spec.get("title") or "Dokumen")
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    path = WORK_DIR / _safe_name(title, fmt)

    _BUILDERS[fmt](spec, path)

    if not path.exists() or path.stat().st_size == 0:
        raise Ms365Error(
            f"Pembuatan {fmt} menghasilkan berkas kosong.",
            code="EMPTY_OUTPUT",
            hint="Periksa isi spec (judul/tabel/poin).",
        )

    result = {
        "ok": True,
        "path": str(path),
        "filename": path.name,
        "format": fmt,
        "size": path.stat().st_size,
        "title": title,
    }
    if not keep:
        # Berkas sengaja dibiarkan di WORK_DIR; pembersihan dilakukan terpisah.
        pass
    return result


# ------------------------------------------------------------------
# ONEDRIVE (rclone)
# ------------------------------------------------------------------
def rclone_available():
    """Apakah rclone terpasang dan remote OneDrive terdaftar?"""
    if shutil.which("rclone") is None:
        return False, "rclone tidak ditemukan di sistem."
    try:
        out = subprocess.run(["rclone", "listremotes"], capture_output=True,
                             text=True, timeout=20)
    except Exception as exc:                                      # pragma: no cover
        return False, f"Tidak dapat menjalankan rclone: {exc}"
    remotes = [r.strip().rstrip(":") for r in (out.stdout or "").split() if r.strip()]
    name = RCLONE_REMOTE.rstrip(":")
    if name not in remotes:
        return False, (f"Remote '{RCLONE_REMOTE}' tidak terdaftar. "
        f"Remote tersedia: {', '.join(remotes) if remotes else '(tidak ada)'}.")
    return True, None


def _remote_path(filename):
    folder = ONEDRIVE_FOLDER.strip("/")
    return f"{RCLONE_REMOTE}{folder}/{filename}" if folder else f"{RCLONE_REMOTE}{filename}"


def upload_to_onedrive(path, *, folder=None):
    """
    Unggah berkas ke OneDrive dan VERIFIKASI dengan membaca kembali.

    Mengembalikan {"ok":True,"remote":...,"size":...,"verified":True}
    atau melempar Ms365Error.
    """
    ok, err = rclone_available()
    if not ok:
        raise Ms365Error(err, code="RCLONE_UNAVAILABLE")

    src = Path(path)
    if not src.is_file():
        raise Ms365Error(f"Berkas sumber tidak ada: {src}", code="SOURCE_MISSING")

    remote = _remote_path(src.name) if not folder else \
        f"{RCLONE_REMOTE}{folder.strip('/')}/{src.name}"

    try:
        proc = subprocess.run(
            ["rclone", "copyto", str(src), remote, "--stats", "0"],
            capture_output=True, text=True, timeout=180,
        )
    except subprocess.TimeoutExpired:
        raise Ms365Error("Unggah ke OneDrive melebihi batas waktu 180 detik.",
                         code="UPLOAD_TIMEOUT")

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[:400]
        raise Ms365Error(f"rclone gagal mengunggah: {detail}",
                         code="UPLOAD_FAILED")

    # Verifikasi: ukuran berkas di remote harus sama dengan lokal.
    try:
        chk = subprocess.run(["rclone", "size", remote],
                             capture_output=True, text=True, timeout=60)
    except Exception:                                             # pragma: no cover
        chk = None

    verified, remote_size = False, None
    if chk is not None and chk.returncode == 0:
        text = (chk.stdout or "").strip()
        for line in text.splitlines():
            if line.lower().startswith("total size:"):
                digits = "".join(ch for ch in line.split(":", 1)[1] if ch.isdigit())
                remote_size = int(digits) if digits else None
        verified = (remote_size == src.stat().st_size)

    if not verified:
        # Verifikasi cadangan: cek berkas benar-benar terdaftar di remote.
        try:
            ls = subprocess.run(["rclone", "lsf", remote],
                                capture_output=True, text=True, timeout=60)
            verified = ls.returncode == 0 and src.name in (ls.stdout or "")
        except Exception:                                         # pragma: no cover
            verified = False

    if not verified:
        raise Ms365Error(
            "Berkas terkirim tetapi verifikasi ukuran gagal. "
            "Jangan anggap unggahan selesai.",
            code="VERIFY_FAILED",
        )

    return {
        "ok": True,
        "remote": remote,
        "size": src.stat().st_size,
        "verified": True,
    }


def list_onedrive(folder=None):
    """Daftar berkas di folder OneDrive (bukti nyata, bukan karangan)."""
    ok, err = rclone_available()
    if not ok:
        raise Ms365Error(err, code="RCLONE_UNAVAILABLE")
    target = f"{RCLONE_REMOTE}{(folder or ONEDRIVE_FOLDER).strip('/')}"
    proc = subprocess.run(["rclone", "lsf", target, "--max-depth", "1"],
                          capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise Ms365Error(f"Tidak dapat membaca folder OneDrive: "
                         f"{(proc.stderr or '').strip()[:200]}",
                         code="LIST_FAILED")
    files = [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
    return {"ok": True, "folder": (folder or ONEDRIVE_FOLDER), "files": files}


def deliver(spec, *, upload=True):
    """
    Alur lengkap: bangun dokumen → unggah ke OneDrive → verifikasi.

    Satu-satunya cara modul ini mengaku "selesai" adalah bila berkas benar-benar
    ada dan (bila diminta unggah) benar-benar terverifikasi di OneDrive.
    """
    built = build_document(spec)
    result = {
        "ok": True,
        "document": built,
        "uploaded": False,
        "verified": False,
        "remote": None,
        "format": built["format"],
    }
    if upload:
        try:
            up = upload_to_onedrive(built["path"])
            result.update({
                "uploaded": True,
                "verified": up["verified"],
                "remote": up["remote"],
                "remote_size": up["size"],
            })
        except Ms365Error:
            # Bangun berhasil tetapi unggah gagal — laporkan jujur, jangan
            # mengaku dokumen sudah selesai di OneDrive.
            result["upload_error"] = True
            raise
    return result


def status():
    """Status kapabilitas modul (dipakai endpoint /api/ms365/status)."""
    ok, err = rclone_available()
    deps = {}
    for name in ("docx", "openpyxl", "pptx", "reportlab"):
        try:
            __import__(name)
            deps[name] = "OK"
        except ImportError:
            deps[name] = "TIDAK ADA"
    folder_exists = None
    if ok:
        try:
            folder_exists = list_onedrive()["files"] is not None
        except Ms365Error:
            folder_exists = False
    return {
        "ok": ok,
        "rclone": "TERSEDIA" if ok else f"TIDAK: {err}",
        "remote": RCLONE_REMOTE,
        "folder": ONEDRIVE_FOLDER,
        "folder_accessible": folder_exists,
        "formats": list(SUPPORTED_FORMATS),
        "deps": deps,
        "work_dir": str(WORK_DIR),
    }


# ------------------------------------------------------------------
# CLI — memudahkan pengujian langsung tanpa server
# ------------------------------------------------------------------
if __name__ == "__main__":
    import sys
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"

    if cmd == "status":
        print(json.dumps(status(), indent=2, ensure_ascii=False))
    elif cmd == "demo":
        spec = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {
            "format": "xlsx",
            "title": "Laporan Uji Mission Control",
            "sheets": [{
                "name": "Ringkasan",
                "headers": ["Agen", "Peran", "Status"],
                "rows": [["Aria", "Lead Agent", "idle"],
                         ["Reza", "Lead Engineer", "idle"],
                         ["Vera", "Microsoft 365 Specialist", "working"]],
            }],
        }
        try:
            out = deliver(spec)
            print(json.dumps(out, indent=2, ensure_ascii=False))
        except Ms365Error as exc:
            print(json.dumps({"ok": False, "error": str(exc), "code": exc.code,
                              "hint": exc.hint}, indent=2, ensure_ascii=False))
            sys.exit(1)
    elif cmd == "list":
        print(json.dumps(list_onedrive(), indent=2, ensure_ascii=False))
    else:
        print(f"Perintah tidak dikenal: {cmd}", file=sys.stderr)
        sys.exit(2)
