/* ===== Nile Systems — برامج سطح المكتب =====
 *
 * الخمسة برامج تعمل على جهاز العميل بلا إنترنت، وترسل عملياتها إلى هنا عند
 * رجوع الشبكة. هذا الملف هو الطرف الآخر: يستقبل الدفعات ويتحقق منها ويرفض
 * المكرر.
 *
 * القاعدة الحاكمة: مفتاح العملية يُنتج على الجهاز، والخادم يتذكّره. إعادة
 * الإرسال (شبكة قطعت بعد الإرسال وقبل الرد) لا تصنع حركة ثانية — تعود
 * `duplicates` وتُعتبر ناجحة على الجهاز.
 *
 * حدود صادقة: مفتاح الجهاز مشترك في العرض التجريبي (`demo-device`)، وليس
 * نظام مصادقة أجهزة حقيقي. مذكور في المواصفة لا مخفي.
 */

const PROGRAMS = [
  { slug: 'cashier', name: 'نيل كاشير', icon: '🧾' },
  { slug: 'stock', name: 'نيل مخازن', icon: '📦' },
  { slug: 'kitchen', name: 'نيل مطعم', icon: '🍽️' },
  { slug: 'attendance', name: 'نيل حضور', icon: '🖐️' },
  { slug: 'reports', name: 'نيل تقارير', icon: '📈' },
];
const MAX_OPS_PER_BATCH = 300;
const KEEP_KEYS = 8000;

module.exports = function createWindows(ctx) {
  const { getDb, save, sendJSON, sendError, readBody } = ctx;
  const now = () => new Date().toISOString();
  const DEVICE_KEY = process.env.WINDOWS_DEVICE_KEY || 'demo-device';

  function seedDefaults(d) {
    let changed = false;
    if (d.windowsOps === undefined) { d.windowsOps = []; changed = true; }
    if (d.windowsDevices === undefined) { d.windowsDevices = []; changed = true; }
    return changed;
  }

  const isProgram = (slug) => PROGRAMS.some((p) => p.slug === slug);

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/windows')) return false;
    const d = getDb();
    if (!d.windowsOps) seedDefaults(d);
    const p = url.pathname;
    const route = `${req.method} ${p}`;
    const device = String(req.headers['x-nile-device'] || '');

    if (device !== DEVICE_KEY) {
      return sendError(res, 401, 'مفتاح الجهاز غير معروف — البرامج تسجّل بمفتاح الجهاز المثبَّت معها'), true;
    }

    /* -------- قائمة البرامج وحالتها -------- */
    if (route === 'GET /api/windows/programs') {
      const list = PROGRAMS.map((prog) => {
        const ops = (d.windowsOps || []).filter((o) => o.program === prog.slug);
        return {
          ...prog,
          ops: ops.length,
          lastAt: ops.length ? ops[ops.length - 1].at : null,
          devices: [...new Set(ops.map((o) => o.device))].slice(0, 10),
        };
      });
      return sendJSON(res, 200, { programs: list, deviceKey: 'معتمد', serverTime: now() }), true;
    }

    /* -------- استقبال دفعة مزامنة -------- */
    if (route === 'POST /api/windows/sync') {
      const b = await readBody(req);
      const program = String(b.program || '');
      if (!isProgram(program)) return sendError(res, 400, 'برنامج غير معروف'), true;
      const ops = Array.isArray(b.ops) ? b.ops : [];
      if (!ops.length) return sendJSON(res, 200, { acked: [], duplicates: [], serverTime: now() }), true;
      if (ops.length > MAX_OPS_PER_BATCH) {
        return sendError(res, 400, `الدفعة أكبر من ${MAX_OPS_PER_BATCH} عملية — قسّمها`), true;
      }
      const bad = ops.find((o) => !o || typeof o.key !== 'string' || !o.key || typeof o.type !== 'string' || !o.type);
      if (bad) return sendError(res, 400, 'كل عملية تحتاج مفتاحاً ونوعاً'), true;

      const seen = new Set((d.windowsOps || []).map((o) => o.key));
      const acked = [];
      const duplicates = [];
      const deviceId = String(b.device || 'unknown').slice(0, 40);
      for (const o of ops) {
        if (seen.has(o.key)) { duplicates.push(o.key); continue; }
        seen.add(o.key);
        d.windowsOps.push({
          key: String(o.key).slice(0, 64), program,
          type: String(o.type).slice(0, 40),
          at: o.at && !Number.isNaN(Date.parse(o.at)) ? new Date(o.at).toISOString() : now(),
          amount: Math.round((Number(o.amount) || 0) * 100) / 100,
          device: deviceId,
          receivedAt: now(),
        });
        acked.push(o.key);
      }
      // سجل الأجهزة: أي جهاز زامن ومتى — مفيد للدعم وللتقرير
      const dev = d.windowsDevices.find((x) => x.id === deviceId);
      if (dev) { dev.lastAt = now(); dev.program = program; dev.count = (dev.count || 0) + acked.length; }
      else d.windowsDevices.push({ id: deviceId, program, firstAt: now(), lastAt: now(), count: acked.length });

      // نحتفظ بآخر 8000 مفتاح فقط: سجل عرض لا أرشيف
      if (d.windowsOps.length > KEEP_KEYS) d.windowsOps = d.windowsOps.slice(-KEEP_KEYS);
      save();
      return sendJSON(res, 200, {
        acked, duplicates, serverTime: now(),
        totals: {
          program: d.windowsOps.filter((o) => o.program === program).length,
          all: d.windowsOps.length,
        },
      }), true;
    }

    /* -------- ملخص المزامنة -------- */
    if (route === 'GET /api/windows/summary') {
      const ops = d.windowsOps || [];
      const programs = PROGRAMS.map((prog) => {
        const list = ops.filter((o) => o.program === prog.slug);
        return {
          program: prog.slug, name: prog.name,
          ops: list.length,
          amount: Math.round(list.reduce((a, o) => a + o.amount, 0) * 100) / 100,
          lastAt: list.length ? list[list.length - 1].at : null,
          devices: [...new Set(list.map((o) => o.device))].length,
        };
      }).filter((x) => x.ops > 0);
      const days = {};
      for (const o of ops) {
        const day = String(o.at).slice(0, 10);
        days[day] = days[day] || { day, ops: 0, amount: 0 };
        days[day].ops += 1;
        days[day].amount = Math.round((days[day].amount + o.amount) * 100) / 100;
      }
      return sendJSON(res, 200, {
        serverTime: now(),
        totalOps: ops.length,
        programs,
        devices: d.windowsDevices || [],
        days: Object.values(days).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14),
      }), true;
    }

    return false;
  }

  return { seedDefaults, handle, PROGRAMS };
};
