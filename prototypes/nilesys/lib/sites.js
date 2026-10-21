/* ===== Nile Systems — لوحة المواقع =====
 *
 * التطبيق السابع والأخير: يدير المواقع السبعة التي بُنيت كصفحات مستقلة.
 * مستخدموه (مدير الموقع/مدير نشاط)، مساراته /api/sites، وبياناته في مجموعاته.
 *
 * القاعدة الحاكمة: حالة الموقع تُقرأ من الصفحة نفسها لا تُخترع. ما يعمل مكتوب
 * أنه يعمل، وما لم يُبنَ مكتوب أنه قيد التنفيذ — واللوحة تعرض الحقيقة نفسها،
 * وعدد الأنظمة العاملة يأتي من سجل المواصفات (public/data/systems.json) لا من
 * رقم مكتوب هنا بخط اليد.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// حالة كل موقع مطابقة لشارته المنشورة في صفحته (public/sites/<slug>.html).
const SITES = [
  { slug: 'fashion', name: 'متجر ملابس', status: 'live', headline: 'مقاسات وألوان بلا فوضى في الرف', phone: '0100 111 2233', whatsapp: '201001112233' },
  { slug: 'mobile', name: 'متجر موبايلات', status: 'live', headline: 'بيع موبايلات بضمان، وبضاعة بتتعدّد صح', phone: '0100 111 2244', whatsapp: '201001112244' },
  { slug: 'clinic', name: 'موقع عيادة', status: 'coming', headline: 'مواعيد وملف مريض وروشتة تُطبع', phone: '0100 111 2255', whatsapp: '201001112255' },
  { slug: 'courts', name: 'موقع ملاعب', status: 'coming', headline: 'الملعب محجوز للساعة دي؟ تعرف قبل ما ترد', phone: '0100 111 2266', whatsapp: '201001112266' },
  { slug: 'gym', name: 'موقع جيم', status: 'coming', headline: 'اشتراكات بتخلص في وقتها، وتذكير قبلها', phone: '0100 111 2277', whatsapp: '201001112277' },
  { slug: 'realestate', name: 'موقع عقارات', status: 'coming', headline: 'وحدات وعملاء ومتابعات في مكان واحد', phone: '0100 111 2288', whatsapp: '201001112288' },
  { slug: 'restaurant', name: 'موقع مطعم', status: 'coming', headline: 'ترابيزات وشاشة مطبخ وحساب في الآخر', phone: '0100 111 2299', whatsapp: '201001112299' },
];

module.exports = function createSites(ctx) {
  const { getDb, save, audit, sendJSON, sendError, readBody } = ctx;

  const now = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);
  const bySlug = (slug) => SITES.find((s) => s.slug === slug) || null;

  /* ---------------- البذور ---------------- */
  function seedDefaults(d) {
    let changed = false;
    const ensure = (k, v) => { if (d[k] === undefined) { d[k] = v; changed = true; } };
    ensure('siteLeads', []);
    ensure('siteViews', []);
    ensure('siteViewSessions', []);
    ensure('siteOverrides', {});
    // مدير النشاط مربوط بموقع واحد؛ مدير الموقع يرى الكل.
    ensure('siteAssignments', [{ username: 'manager', slug: 'fashion' }]);
    return changed;
  }

  /* ---------------- أدوات ---------------- */
  const isSitesUser = (u) => u && u.system === 'admin';
  const isSiteAdmin = (u) => isSitesUser(u) && u.role === 'admin';

  // الموقع المسموح للمستخدم: null = الكل (مدير الموقع).
  function scopeSlug(d, u) {
    if (isSiteAdmin(u)) return null;
    const a = (d.siteAssignments || []).find((x) => x.username === u.username);
    return a ? a.slug : '__none__';
  }
  function guard(u, res, opts = {}) {
    if (!isSitesUser(u)) { sendError(res, 403, 'غير مسموح: لوحة المواقع لمستخدميها فقط'); return true; }
    if (opts.admin && !isSiteAdmin(u)) { sendError(res, 403, 'لمدير الموقع بس'); return true; }
    return false;
  }

  const view = (d, site) => ({
    ...site,
    ...(d.siteOverrides[site.slug] || {}),
    url: `/sites/${site.slug}.html`,
    active: d.siteOverrides[site.slug] && d.siteOverrides[site.slug].active !== undefined
      ? d.siteOverrides[site.slug].active : true,
  });

  const viewsFor = (d, slug, date) => {
    const row = (d.siteViews || []).find((v) => v.siteSlug === slug && v.date === date);
    return row ? row.count : 0;
  };

  // سجل الأنظمة المولَّد من docs/product/systems/*.md بواسطة tools/build-app-specs.py.
  function systemsRegister() {
    const file = path.join(__dirname, '..', 'public', 'data', 'systems.json');
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = Array.isArray(doc) ? doc : doc.systems || [];
      return { source: 'public/data/systems.json', systems: list };
    } catch {
      return { source: 'missing', systems: [] };
    }
  }

  /* ---------------- المعالج ---------------- */
  async function handle(req, res, url, rc) {
    const { route, user: u } = rc;
    if (!url.pathname.startsWith('/api/sites')) return false;
    const d = getDb();
    if (!d.siteLeads) seedDefaults(d);
    const p = url.pathname;
    const parts = p.split('/').filter(Boolean); // ['api','sites',...]
    const q = url.searchParams;

    /* -------- عام: رسالة من صفحة موقع (بلا تسجيل دخول) -------- */
    if (route.startsWith('POST /api/sites/') && p.endsWith('/lead')) {
      const slug = parts[2];
      if (!bySlug(slug)) return sendError(res, 404, 'الموقع مش موجود'), true;
      const b = await readBody(req);
      const name = String(b.name || '').trim().slice(0, 80);
      const phone = String(b.phone || '').replace(/\s+/g, '').slice(0, 20);
      if (name.length < 2) return sendError(res, 400, 'الاسم مطلوب'), true;
      if (!/^0\d{8,14}$/.test(phone)) return sendError(res, 400, 'رقم موبايل غير صالح'), true;

      // نفس الموبايل على نفس الموقع خلال 24 ساعة = رسالة واحدة.
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const dup = (d.siteLeads || []).find((l) => l.siteSlug === slug && l.phone === phone
        && Date.parse(l.at) >= since);
      if (dup) return sendJSON(res, 200, { lead: dup, duplicate: true }), true;

      const lead = {
        id: crypto.randomUUID(), siteSlug: slug, name, phone,
        message: String(b.message || '').slice(0, 500),
        status: 'new', at: now(), by: null,
      };
      d.siteLeads.push(lead);
      audit(null, 'sites.lead', `رسالة من ${slug}: ${name}`, { leadId: lead.id, siteSlug: slug });
      save();
      return sendJSON(res, 201, { lead, duplicate: false }), true;
    }

    /* -------- عام: عدّاد زيارة -------- */
    if (route.startsWith('POST /api/sites/') && p.endsWith('/view')) {
      const slug = parts[2];
      const site = bySlug(slug);
      if (!site) return sendError(res, 404, 'الموقع مش موجود'), true;
      const cookie = String(req.headers.cookie || '');
      const m = cookie.match(/(?:^|;\s*)nile_vid=([^;]+)/);
      const vid = m ? decodeURIComponent(m[1]) : crypto.randomUUID();
      const date = today();
      const key = `${vid}:${slug}:${date}`;
      const headers = m ? {} : { 'Set-Cookie': `nile_vid=${vid}; Path=/; Max-Age=2592000; SameSite=Lax` };
      // زيارة واحدة لكل جلسة في اليوم — العدد لا يتضاعف بإعادة التحميل.
      if ((d.siteViewSessions || []).includes(key)) {
        return sendJSON(res, 200, { counted: false, views: viewsFor(d, slug, date) }, headers), true;
      }
      d.siteViewSessions = d.siteViewSessions || [];
      d.siteViewSessions.push(key);
      if (d.siteViewSessions.length > 5000) d.siteViewSessions = d.siteViewSessions.slice(-4000);
      let row = (d.siteViews || []).find((v) => v.siteSlug === slug && v.date === date);
      if (!row) { row = { siteSlug: slug, date, count: 0 }; d.siteViews.push(row); }
      row.count += 1;
      save();
      return sendJSON(res, 200, { counted: true, views: row.count }, headers), true;
    }

    /* -------- لوحة: قائمة المواقع -------- */
    if (route === 'GET /api/sites') {
      if (guard(u, res)) return true;
      const scope = scopeSlug(d, u);
      const date = q.get('date') || today();
      const sites = SITES
        .filter((s) => scope === null || s.slug === scope)
        .map((s) => {
          const v = view(d, s);
          const leads = d.siteLeads.filter((l) => l.siteSlug === s.slug);
          return {
            ...v, viewsToday: viewsFor(d, s.slug, date),
            leadsTotal: leads.length,
            leadsNew: leads.filter((l) => l.status === 'new').length,
          };
        });
      return sendJSON(res, 200, { sites, date }), true;
    }

    /* -------- لوحة: الرسائل -------- */
    if (route === 'GET /api/sites/leads') {
      if (guard(u, res)) return true;
      const scope = scopeSlug(d, u);
      const list = (d.siteLeads || [])
        .filter((l) => scope === null || l.siteSlug === scope)
        .filter((l) => !q.get('status') || l.status === q.get('status'))
        .filter((l) => !q.get('site') || l.siteSlug === q.get('site'))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 300)
        .map((l) => ({ ...l, siteName: (bySlug(l.siteSlug) || {}).name || l.siteSlug }));
      return sendJSON(res, 200, { leads: list }), true;
    }

    if (route.startsWith('POST /api/sites/leads/') && p.endsWith('/status')) {
      if (guard(u, res)) return true;
      const lead = (d.siteLeads || []).find((l) => l.id === parts[3]);
      if (!lead) return sendError(res, 404, 'الرسالة مش موجودة'), true;
      const scope = scopeSlug(d, u);
      if (scope !== null && lead.siteSlug !== scope) return sendError(res, 403, 'الرسالة دي لموقع تاني'), true;
      const b = await readBody(req);
      const to = String(b.status || '');
      if (!['replied', 'closed'].includes(to)) return sendError(res, 400, 'حالة غير معروفة'), true;
      // مغلقة لا تعود جديدة — والانتقال المسموح فقط من جديدة أو تم الرد.
      if (lead.status === 'closed') return sendError(res, 409, 'الرسالة مغلقة — ما ينفعش ترجع'), true;
      if (lead.status === to) return sendError(res, 409, 'الرسالة بالحالة دي بالفعل'), true;
      lead.status = to;
      lead.decidedAt = now();
      lead.decidedBy = u.id;
      audit(u, 'sites.lead.status', `رسالة ${lead.siteSlug} → ${to}`, { leadId: lead.id });
      save();
      return sendJSON(res, 200, { lead }), true;
    }

    /* -------- لوحة: تعديل محتوى موقع (مدير الموقع فقط) -------- */
    if (route.startsWith('PUT /api/sites/') && parts.length === 3) {
      if (guard(u, res, { admin: true })) return true;
      const site = bySlug(parts[2]);
      if (!site) return sendError(res, 404, 'الموقع مش موجود'), true;
      const b = await readBody(req);
      const ov = d.siteOverrides[site.slug] || {};
      if (b.headline !== undefined) ov.headline = String(b.headline).slice(0, 120);
      if (b.phone !== undefined) ov.phone = String(b.phone).slice(0, 24);
      if (b.whatsapp !== undefined) ov.whatsapp = String(b.whatsapp).replace(/\D/g, '').slice(0, 20);
      if (b.active !== undefined) ov.active = Boolean(b.active);
      if (b.status !== undefined && b.status !== site.status) {
        return sendError(res, 400, 'حالة الموقع تُقرأ من صفحته — ما تتغيّرش من هنا'), true;
      }
      d.siteOverrides[site.slug] = ov;
      audit(u, 'sites.updated', `تعديل ${site.slug}`, { siteSlug: site.slug });
      save();
      return sendJSON(res, 200, { site: view(d, site) }), true;
    }

    /* -------- لوحة: الملخص -------- */
    if (route === 'GET /api/sites/summary') {
      if (guard(u, res)) return true;
      const scope = scopeSlug(d, u);
      const date = today();
      const sites = SITES.filter((s) => scope === null || s.slug === scope);
      const leads = (d.siteLeads || []).filter((l) => scope === null || l.siteSlug === scope);
      const leadsToday = leads.filter((l) => String(l.at).slice(0, 10) === date);
      const reg = systemsRegister();
      const systems = reg.systems.filter((s) => scope === null || true);
      const perSite = sites.map((s) => ({
        slug: s.slug, name: s.name,
        views: viewsFor(d, s.slug, date),
        leads: leadsToday.filter((l) => l.siteSlug === s.slug).length,
      })).sort((a, b) => b.leads - a.leads || b.views - a.views);
      const replied = leads.filter((l) => l.status !== 'new').length;
      return sendJSON(res, 200, {
        date,
        systems: {
          source: reg.source,
          total: systems.length,
          live: systems.filter((s) => s.status === 'live').length,
          planned: systems.filter((s) => s.status !== 'live').length,
        },
        sites: {
          total: sites.length,
          live: sites.filter((s) => s.status === 'live').length,
          coming: sites.filter((s) => s.status !== 'live').length,
        },
        leads: {
          total: leads.length,
          today: leadsToday.length,
          new: leads.filter((l) => l.status === 'new').length,
          unanswered: leads.filter((l) => l.status === 'new').length,
          replyRate: leads.length ? Math.round((replied / leads.length) * 100) : 0,
        },
        topSite: perSite[0] || null,
        perSite,
      }), true;
    }

    return false;
  }

  return { seedDefaults, handle, SITES };
};
