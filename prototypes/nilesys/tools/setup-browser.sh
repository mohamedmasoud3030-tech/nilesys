#!/bin/sh
# تشغيل اختبار المتصفح في بيئة بلا صلاحيات root.
#
# المشكلة: كروم بلاي رايت يحتاج مكتبات نظام (nss, atk, cups, avahi…) غير مثبتة
# في هذه الصورة، و`playwright install-deps` يحتاج sudo غير متاح.
# الحل: تنزيل حزم deb كمستخدم عادي، فكّها في /tmp/sysroot، وتوجيه LD_LIBRARY_PATH.
#
#   sh tools/setup-browser.sh                     # مرة واحدة لكل جلسة
#   sh tools/setup-browser.sh tools/ui-restaurant.js
set -e

PW_HOME="${PW_HOME:-/tmp/pw}"
ROOT="${SYSROOT:-/tmp/sysroot}"
LIBS="libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 \
libatspi2.0-0 libxdamage1 libasound2 libdbus-1-3 libxcomposite1 libxrandr2 libgbm1 \
libpango-1.0-0 libcairo2 libxfixes3 libxi6 libxcursor1 libxrender1 libexpat1 \
libglib2.0-0 libdrm2 libavahi-common3 libavahi-client3"

if [ ! -x "$PW_HOME/node_modules/.bin/playwright" ]; then
  mkdir -p "$PW_HOME"
  ( cd "$PW_HOME" && npm init -y >/dev/null 2>&1 && npm i playwright@1.47.2 --no-audit --no-fund >/dev/null 2>&1 )
fi
ln -sfn "$PW_HOME/node_modules" /tmp/node_modules 2>/dev/null || true

if [ ! -f "$ROOT/usr/lib/x86_64-linux-gnu/libnss3.so" ]; then
  mkdir -p "$ROOT/debs"
  ( cd "$ROOT/debs" && apt-get download $LIBS >/dev/null 2>&1 || true
    for f in *.deb; do [ -e "$f" ] && dpkg-deb -x "$f" "$ROOT"; done
    cd / && rm -rf "$ROOT/debs" )
fi

export LD_LIBRARY_PATH="$ROOT/usr/lib/x86_64-linux-gnu:$ROOT/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
if [ -n "$1" ]; then
  exec node "$@"
fi
echo "browser ready: LD_LIBRARY_PATH=$LD_LIBRARY_PATH"
