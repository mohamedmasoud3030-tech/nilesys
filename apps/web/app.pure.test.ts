/**
 * اختبارات المنطق النقي لواجهة الكاشير (apps/web/app.js):
 * تنسيق/تحويل المال بقروش صحيحة، الكميات بأجزاء الألف، وهوية العمليات
 * المالية المعلّقة (منع البيع المزدوج من الواجهة). يَحمِل الملف في VM
 * بلا DOM — القسم المتصفحي محروس ولا يُنفَّذ هنا.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const src = readFileSync(fileURLToPath(new URL('./app.js', import.meta.url)), 'utf8');
const sandbox: Record<string, unknown> = { console };
sandbox['globalThis'] = sandbox;
runInNewContext(src, sandbox);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = (sandbox as any).NilePOSPure;

describe('مال الواجهة: تحويل وتنسيق بقروش صحيحة', () => {
  it('fmtMinor يفكك صحيحًا دون عائم', () => {
    expect(P.fmtMinor(0)).toBe('0.00');
    expect(P.fmtMinor(5)).toBe('0.05');
    expect(P.fmtMinor(50)).toBe('0.50');
    expect(P.fmtMinor(8995)).toBe('89.95');
    expect(P.fmtMinor(123456789)).toBe('1,234,567.89');
    expect(P.fmtMinor(-40000)).toBe('-400.00');
    expect(P.fmtMinor(3000000000)).toBe('30,000,000.00'); // حد فتح الوردية بالمحرك
  });

  it('parseMoneyToMinor: لاتيني وعربي وفواصل آلاف', () => {
    expect(P.parseMoneyToMinor('89.95')).toBe(8995);
    expect(P.parseMoneyToMinor('٨٩٫٩٥')).toBe(8995); // أرقام عربية + فاصلة ٫
    expect(P.parseMoneyToMinor('1,500.5')).toBe(150050);
    expect(P.parseMoneyToMinor('0')).toBe(0);
    expect(P.parseMoneyToMinor(' 12 ')).toBe(1200);
  });

  it('parseMoneyToMinor يرفض الغامض والخطر', () => {
    for (const bad of ['', 'abc', '-5', '1.005', '1.5.2', '.5', '1.', '١٢.٣٤٥']) {
      expect(P.parseMoneyToMinor(bad), bad).toBeNull();
    }
  });

  it('minorToInput/parseMoneyToMinor ذهاب وعودة', () => {
    for (const m of [0, 7, 750, 8995, 19000, 1234567]) expect(P.parseMoneyToMinor(P.minorToInput(m))).toBe(m);
  });
});

describe('كميات الواجهة: أجزاء ألف صحيحة (بيع بالوزن)', () => {
  it('parseQtyMilli + milliToQtyString', () => {
    expect(P.parseQtyMilli('2')).toBe(2000);
    expect(P.parseQtyMilli('0.250')).toBe(250);
    expect(P.parseQtyMilli('٠٫٥')).toBe(500);
    expect(P.milliToQtyString(2000)).toBe('2');
    expect(P.milliToQtyString(250)).toBe('0.25');
    expect(P.milliToQtyString(12500)).toBe('12.5');
    expect(P.fmtQtyString('120.000')).toBe('120');
    expect(P.fmtQtyString('12.500')).toBe('12.5');
  });

  it('معاينة السطر تُقرَّب على مستوى السطر (النهائي من المحرك)', () => {
    // جبنة 320.00 للكجم × 0.250 = 80.00
    expect(P.lineEstimateMinor(32000, 250)).toBe(8000);
    const est = P.computeEstimate([
      { priceMinor: 750, qtyMilli: 2000 },
      { priceMinor: 333, qtyMilli: 1500 }, // 499.5 → 500 على السطر
    ]);
    expect(est.lines[1].lineMinor).toBe(500);
    expect(est.totalMinor).toBe(2000);
  });
});

describe('هوية العمليات المالية: لا بيع مزدوجًا من الواجهة', () => {
  it('نفس البصمة ⇒ نفس المفتاح؛ تعديل العملية ⇒ مفتاح جديد', () => {
    const s = P.createPendingStore((kind: string) => `key-${kind}-${Math.random()}`);
    const fp = P.fingerprintOf({ lines: [{ variantId: 'a', quantity: '2' }], tenders: [{ method: 'cash', amountMinor: 1500 }] });
    const k1 = s.getOrCreate('checkout', fp);
    expect(s.getOrCreate('checkout', fp)).toBe(k1); // ضغطة مزدوجة/إعادة بعد قطع شبكة
    const fp2 = P.fingerprintOf({ lines: [{ variantId: 'a', quantity: '3' }], tenders: [{ method: 'cash', amountMinor: 2250 }] });
    expect(s.getOrCreate('checkout', fp2)).not.toBe(k1);
    s.clear('checkout');
    expect(s.has('checkout')).toBe(false);
  });

  it('البصمة لا تتأثر بترتيب مفاتيح الكائنات لكن تتأثر بترتيب البنود', () => {
    expect(P.fingerprintOf({ b: 1, a: 2 })).toBe(P.fingerprintOf({ a: 2, b: 1 }));
    expect(P.fingerprintOf([1, 2])).not.toBe(P.fingerprintOf([2, 1]));
  });

  it('snapshot/restore يحفظ الهويات عبر إعادة تحميل الصفحة', () => {
    const a = P.createPendingStore();
    const key = a.getOrCreate('checkout', 'fp-1');
    expect(key.length).toBeGreaterThanOrEqual(8); // حد العقد الأدنى
    const b = P.createPendingStore();
    b.restore(a.snapshot());
    expect(b.getOrCreate('checkout', 'fp-1')).toBe(key);
    b.restore([['x']]); // قمامة لا تكسر شيئًا
    expect(b.has('checkout')).toBe(false);
  });

  it('تصنيف النتائج: شبكة/5xx غير مؤكد، 401 جلسة، و4xx نهائي', () => {
    expect(P.classifyStatus(0)).toBe('uncertain');
    expect(P.classifyStatus(503)).toBe('uncertain');
    expect(P.classifyStatus(429)).toBe('uncertain');
    expect(P.classifyStatus(401)).toBe('unauthenticated');
    expect(P.classifyStatus(422)).toBe('definitive');
    expect(P.classifyStatus(409)).toBe('definitive');
    expect(P.classifyStatus(403)).toBe('definitive');
  });
});

describe('نصوص عربية', () => {
  it('رسائل إجرائية معروفة وأدوار معرّبة', () => {
    expect(P.messageForError({ code: 'insufficient_stock' })).toContain('المخزون');
    expect(P.messageForError({ code: 'shift_required_for_cash' })).toContain('وردية');
    expect(P.messageForError({ status: 0 })).toContain('الاتصال');
    expect(P.roleLabelAr('branch-manager')).toBe('مدير فرع');
    expect(P.roleLabelAr('cashier')).toBe('كاشير');
  });
});
