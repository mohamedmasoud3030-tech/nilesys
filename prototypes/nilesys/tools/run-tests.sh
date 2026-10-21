#!/bin/sh
# يشغّل كل اختبارات الديمو على سيرفر نظيف ثم يقفله.
#
# لماذا سكربت: الاختبارات تحفظ حالة (بيع، وردية، مستخدمون، محاولات دخول).
# تشغيلها على سيرفر عاش تشغيلاً سابقاً يعطي نتائج مختلفة كل مرة — وهذا
# أسوأ من فشل: يجعل الفشل غير قابل للتفسير. كل تشغيل هنا يبدأ من صفر،
# وكل ملف يُشغَّل مرة واحدة فقط.
#
#   ./tools/run-tests.sh            كل الملفات
#   ./tools/run-tests.sh backlog    ملف واحد فقط
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

PORT=${PORT:-$((20000 + $$ % 20000))}
LOG=$(mktemp /tmp/nile-test-log-XXXXXX.txt)
FAIL=0
TOTAL=0
PASSED=0

# كل ملف على سيرفر وقاعدة بيانات جديدة: الملفات تفترض أنها تبدأ من صفر،
# وتشغيلها على قاعدة واحدة يجعل الملف الثاني يرى بقايا الأول (تقلّب فعلي).
for f in tests/${1:-}*.test.js; do
  [ -e "$f" ] || continue
  PORT=$((20000 + ($$ + TOTAL * 7) % 20000))
  DB=$(mktemp -u /tmp/nile-test-XXXXXX.json)
  DB_FILE="$DB" PORT="$PORT" node server.js >/tmp/nile-test-server.log 2>&1 &
  SRV=$!

  i=0
  while [ $i -lt 80 ]; do
    curl -sf "http://localhost:$PORT/api/session" >/dev/null 2>&1 && break
    i=$((i + 1)); sleep 0.25
  done
  if [ $i -ge 80 ]; then
    echo "السيرفر ما اشتغلش لـ $f. آخر السجل:"
    tail -20 /tmp/nile-test-server.log
    kill -9 "$SRV" 2>/dev/null || true
    FAIL=1
    continue
  fi

  printf '\n=== %s (:%s) ===\n' "$f" "$PORT"
  BASE="http://localhost:$PORT" DB_FILE="$DB" node --test "$f" >"$LOG" 2>&1
  grep -E '^not ok' "$LOG" || true
  grep -E '^# (tests|pass|fail)' "$LOG" || true

  N=$(awk '/^# tests/{print $3}' "$LOG");  TOTAL=$((TOTAL + ${N:-0}))
  P=$(awk '/^# pass/{print $3}' "$LOG");   PASSED=$((PASSED + ${P:-0}))
  F=$(awk '/^# fail/{print $3}' "$LOG")
  [ "${F:-1}" != "0" ] && FAIL=1

  kill -9 "$SRV" 2>/dev/null || true
  rm -f "$DB"
  sleep 0.2
done

echo
echo "الإجمالي: $PASSED/$TOTAL"
if [ "$FAIL" = "0" ]; then echo "النتيجة: كل الملفات نجحت"; else echo "النتيجة: فيه فشل — التفاصيل فوق"; fi
exit $FAIL
