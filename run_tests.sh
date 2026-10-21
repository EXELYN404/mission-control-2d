#!/bin/bash
# ============================================
# Mission Control 2D — Test Runner
# Menjalankan semua pengujian tanpa browser.
# ============================================
cd "$(dirname "$0")"
FAIL=0

echo "╔══════════════════════════════════════════════╗"
echo "║      MISSION CONTROL 2D — TEST SUITE        ║"
echo "╚══════════════════════════════════════════════╝"
echo

# 1) Sintaks backend
echo "[1/4] Cek sintaks server.py"
python3 -c "import ast; ast.parse(open('server.py').read())" \
  && echo "      OK" || { echo "      GAGAL"; FAIL=1; }
echo

# 2) Sintaks JavaScript
echo "[2/4] Cek sintaks JavaScript"
for f in static/js/api.js static/js/office.js static/js/app.js; do
  if command -v node >/dev/null 2>&1; then
    node --check "$f" && echo "      OK  $f" || { echo "      GAGAL  $f"; FAIL=1; }
  else
    echo "      (node tidak tersedia, dilewati: $f)"
  fi
done
echo

# 3) Uji fungsional OfficeRenderer (tanpa browser)
echo "[3/4] Uji fungsional OfficeRenderer"
if command -v node >/dev/null 2>&1; then
  node tests/test_office_renderer.js || FAIL=1
else
  echo "      (node tidak tersedia, dilewati)"
fi
echo

# 4) Uji API backend
echo "[4/4] Uji API backend (butuh server jalan di :3000)"
BASE="http://localhost:3000"
if curl -s -o /dev/null --max-time 3 "$BASE/api/dashboard"; then
  for ep in dashboard agents tasks activities calendar memory channels office; do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/$ep")
    if [ "$CODE" = "200" ]; then echo "      OK  /api/$ep"; else echo "      GAGAL  /api/$ep (HTTP $CODE)"; FAIL=1; fi
  done
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
  if [ "$CODE" = "200" ]; then echo "      OK  / (halaman utama)"; else echo "      GAGAL  / (HTTP $CODE)"; FAIL=1; fi

  # Hasil AI harus ikut disajikan di data agent
  MIND=$(curl -s "$BASE/api/agents" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin).get('data') or []
except Exception:
    d = []
print('yes' if d and all('mind' in a for a in d) else 'no')
" 2>/dev/null)
  if [ "$MIND" = "yes" ]; then
    echo "      OK  /api/agents menyertakan hasil AI (mind)"
  else
    echo "      GAGAL  /api/agents tidak menyertakan hasil AI"
    FAIL=1
  fi
else
  echo "      Server belum jalan. Jalankan: ./start.sh"
  echo "      (dilewati)"
fi
echo

if [ "$FAIL" = "0" ]; then
  echo "SEMUA TES LULUS"
else
  echo "ADA TES YANG GAGAL"
fi
exit $FAIL
