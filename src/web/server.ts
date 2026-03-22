import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { OfferStore } from '../store/offer-store.js';
import type { AnalyticsStore } from '../store/analytics-store.js';
import { geoGuard, getClientIP } from './geo-guard.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('web');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANALYTICS_PWD = process.env.ANALYTICS_PASSWORD || 'flytlv2026';

export function startWebServer(store: OfferStore, analytics: AnalyticsStore, port: number = 3737): void {
  const app = express();
  app.use(express.json());

  // --- Maintenance mode ---
  const MAINTENANCE = process.env.MAINTENANCE === 'true';
  if (MAINTENANCE) {
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/analytics')) return next();
      res.send(maintenanceHtml());
    });
  }

  // Geo-IP guard: Israel only (skip for /analytics and maintenance)
  app.use((req, res, next) => {
    if (req.path.startsWith('/analytics')) return next();
    return geoGuard()(req, res, next);
  });

  // --- Analytics tracking middleware ---
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/analytics')) return next();
    try {
      analytics.recordEvent({
        type: 'page_view',
        ip: getClientIP(req),
        page: req.path,
        referrer: req.headers.referer || req.headers.referrer as string || '',
        userAgent: req.headers['user-agent'] || '',
        country: 'IL',
      });
    } catch (e) { /* don't break the request */ }
    next();
  });

  // --- Analytics event endpoint ---
  app.post('/api/analytics/event', (req, res) => {
    try {
      const { event } = req.body || {};
      if (event === 'enter_dashboard' || event === 'beacon') {
        analytics.recordEvent({
          type: event,
          ip: getClientIP(req),
          page: '/dashboard',
          referrer: req.headers.referer || '',
          userAgent: req.headers['user-agent'] || '',
          country: 'IL',
        });
      }
    } catch (e) { /* silent */ }
    res.json({ ok: true });
  });

  // --- Analytics admin dashboard ---
  app.get('/analytics', (req, res) => {
    if (req.query.pwd !== ANALYTICS_PWD) {
      res.send(analyticsLoginHtml());
      return;
    }
    const range = (req.query.range as string) || '30d';
    const data = analytics.getDashboard(range as any);
    res.send(analyticsHtml(data, range, ANALYTICS_PWD));
  });

  // --- Data routes (open) ---
  app.get('/api/offers', (req, res) => {
    const { status, airline, destination } = req.query;
    const offers = store.getAllOffers({
      status: status as string | undefined,
      airline: airline as string | undefined,
      destination: destination as string | undefined,
    });
    res.json(offers);
  });

  app.get('/api/stats', (_req, res) => {
    res.json(store.getStats());
  });

  app.get('/api/price-history/:fingerprint', (req, res) => {
    res.json(store.getPriceHistory(req.params.fingerprint));
  });

  app.get('/', (_req, res) => {
    res.send(dashboardHtml());
  });

  app.listen(port, '0.0.0.0', () => {
    log.info({ port }, `Dashboard running at http://localhost:${port}`);
  });
}

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FlyTLV - Rescue Flights from Ben Gurion</title>
<meta property="og:title" content="FlyTLV - Rescue Flights from Ben Gurion">
<meta property="og:description" content="Free real-time scanner for rescue flights out of TLV. Scans El Al, Arkia, Israir &amp; Air Haifa every few minutes. No signup needed.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://claim.travel">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#f8fafc;--bg2:#f1f5f9;--white:#fff;
  --border:#e2e8f0;--border2:#cbd5e1;
  --text:#0f172a;--text2:#475569;--text3:#94a3b8;--text4:#64748b;
  --blue:#3b82f6;--blue-hover:#2563eb;--blue-light:#eff6ff;--blue-50:#dbeafe;--blue-ring:rgba(59,130,246,.25);
  --green:#10b981;--green-dark:#059669;--green-light:#ecfdf5;--green-tag:#d1fae5;--green-ring:rgba(16,185,129,.15);
  --red:#ef4444;--red-light:#fef2f2;--red-tag:#fecaca;
  --orange:#f59e0b;--orange-dark:#d97706;--orange-light:#fffbeb;--orange-tag:#fef3c7;--orange-ring:rgba(245,158,11,.12);
  --purple:#8b5cf6;--purple-light:#f5f3ff;
  --radius:16px;--radius-sm:10px;--radius-xs:8px;
  --shadow-xs:0 1px 2px rgba(0,0,0,.03);
  --shadow-sm:0 1px 3px rgba(0,0,0,.04),0 1px 2px rgba(0,0,0,.02);
  --shadow:0 4px 6px -1px rgba(0,0,0,.05),0 2px 4px -2px rgba(0,0,0,.03);
  --shadow-md:0 10px 15px -3px rgba(0,0,0,.06),0 4px 6px -4px rgba(0,0,0,.04);
  --shadow-lg:0 20px 25px -5px rgba(0,0,0,.06),0 8px 10px -6px rgba(0,0,0,.04);
  --transition:all .2s cubic-bezier(.4,0,.2,1);
}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased;line-height:1.5}
a{text-decoration:none;color:inherit}
button{font-family:inherit;cursor:pointer}

/* ============ NAV ============ */
.nav{background:var(--white);border-bottom:1px solid var(--border);padding:0 max(20px,calc((100vw - 1180px)/2));display:flex;align-items:center;height:56px;gap:16px;position:sticky;top:0;z-index:100;backdrop-filter:blur(16px);background:rgba(255,255,255,.88)}
.logo{font-size:17px;font-weight:800;letter-spacing:-.3px;color:var(--text);display:flex;align-items:center;gap:8px}
.logo-mark{width:30px;height:30px;background:linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%);border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.logo-mark svg{width:16px;height:16px}
.nav-right{margin-left:auto;display:flex;align-items:center;gap:12px}
.live-pill{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--green-dark);background:var(--green-light);padding:4px 10px 4px 8px;border-radius:20px;border:1px solid var(--green-tag)}
.live-dot{width:6px;height:6px;background:var(--green);border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.update-text{font-size:11px;color:var(--text3);font-weight:500}

/* Nav utilities */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:13px;font-weight:600;padding:7px 14px;border-radius:var(--radius-xs);border:none;transition:var(--transition);white-space:nowrap}
.btn-primary{background:var(--blue);color:#fff;box-shadow:0 1px 2px rgba(59,130,246,.3)}
.btn-primary:hover{background:var(--blue-hover);box-shadow:0 2px 8px rgba(59,130,246,.35);transform:translateY(-1px)}
.btn-ghost{background:transparent;color:var(--text3);padding:7px 10px}
.btn-ghost:hover{background:var(--bg2);color:var(--text2)}
.btn-outline{background:var(--white);color:var(--text2);border:1px solid var(--border);box-shadow:var(--shadow-xs)}
.btn-outline:hover{background:var(--bg);border-color:var(--border2)}
.btn svg{width:14px;height:14px}
.btn-sm{font-size:12px;padding:5px 10px}

/* ============ (banner removed) ============ */

/* ============ HERO ============ */
.hero{background:var(--text);padding:32px max(20px,calc((100vw - 1180px)/2)) 36px;color:#fff;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(59,130,246,.12) 0%,transparent 40%,rgba(139,92,246,.08) 100%)}
.hero-inner{position:relative;z-index:1;display:flex;align-items:flex-end;justify-content:space-between;gap:32px;flex-wrap:wrap}
.hero-left h1{font-size:24px;font-weight:800;letter-spacing:-.5px;margin-bottom:4px}
.hero-left p{font-size:13px;color:rgba(255,255,255,.5);max-width:420px;line-height:1.5}
.stats-row{display:flex;gap:8px;flex-wrap:wrap}
.stat-card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:var(--radius-sm);padding:14px 20px;min-width:100px;backdrop-filter:blur(4px)}
.stat-val{font-size:28px;font-weight:800;letter-spacing:-.5px;line-height:1}
.stat-label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.35);margin-top:3px;font-weight:600}

/* ============ TOOLBAR ============ */
.toolbar{background:var(--white);border-bottom:1px solid var(--border);padding:0 max(20px,calc((100vw - 1180px)/2));display:flex;align-items:center;gap:0;height:52px;overflow-x:auto}
.tool-section{display:flex;align-items:center;gap:8px;padding:0 12px;height:100%}
.tool-section:not(:last-child){border-right:1px solid var(--border)}
.tool-section:first-child{padding-left:0}
.tool-label{font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;white-space:nowrap}
.select-wrap{position:relative}
.select-wrap select{border:1px solid var(--border);background:var(--white);padding:6px 30px 6px 10px;border-radius:var(--radius-xs);font-size:12px;color:var(--text);font-family:inherit;cursor:pointer;appearance:none;font-weight:500;transition:var(--transition);white-space:nowrap}
.select-wrap select:hover{border-color:var(--border2)}
.select-wrap select:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px var(--blue-ring)}
.select-wrap::after{content:'';position:absolute;right:10px;top:50%;transform:translateY(-50%);width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--text3);pointer-events:none}

/* Pax picker */
.pax-group{display:flex;align-items:center;gap:4px}
.pax-label{font-size:11px;color:var(--text4);font-weight:600;min-width:42px}
.pax-stepper{display:flex;align-items:center;border:1px solid var(--border);border-radius:6px;overflow:hidden;height:28px}
.pax-stepper button{width:26px;height:100%;border:none;background:var(--bg);color:var(--text2);font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;transition:var(--transition)}
.pax-stepper button:hover{background:var(--border)}
.pax-stepper button:active{background:var(--border2)}
.pax-stepper .pax-val{width:24px;text-align:center;font-size:12px;font-weight:700;color:var(--text);background:var(--white)}

/* Tab pills */
.tab-pills{display:flex;align-items:center;gap:2px;margin-left:auto;background:var(--bg);border-radius:var(--radius-xs);padding:3px;flex-shrink:0}
.tab-pill{padding:5px 14px;font-size:12px;font-weight:600;color:var(--text3);background:transparent;border:none;border-radius:6px;transition:var(--transition);white-space:nowrap}
.tab-pill:hover:not(.active){color:var(--text2)}
.tab-pill.active{background:var(--white);color:var(--text);box-shadow:var(--shadow-xs)}

/* ============ MAIN CONTENT ============ */
.main{padding:24px max(20px,calc((100vw - 1180px)/2)) 80px}

/* Section */
.section{margin-bottom:32px}
.section-head{display:flex;align-items:center;gap:8px;margin-bottom:16px}
.section-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.section-dot.green{background:var(--green);box-shadow:0 0 0 3px var(--green-ring)}
.section-dot.gray{background:var(--text3);opacity:.4}
.section-title{font-size:15px;font-weight:700;letter-spacing:-.2px}
.section-count{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px}
.section-count.green{background:var(--green-tag);color:var(--green-dark)}
.section-count.gray{background:var(--bg2);color:var(--text3)}
.section-sep{margin:36px 0 24px;border:none;height:1px;background:var(--border);position:relative}
.section-sep::after{content:'History';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg);padding:0 14px;font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1.2px}

/* Date group */
.date-group{margin-bottom:24px}
.date-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.date-head h3{font-size:13px;font-weight:700;color:var(--text2)}
.date-head .tag{font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:var(--blue-50);color:var(--blue)}

/* ============ GRID ============ */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}

/* ============ CARD ============ */
.card{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;transition:var(--transition);box-shadow:var(--shadow-xs);position:relative}
.card:hover{box-shadow:var(--shadow-md);border-color:var(--border2);transform:translateY(-2px)}
.card.gone{opacity:.55}
.card.gone:hover{opacity:.75}
.card.priority{border-color:var(--orange);box-shadow:0 0 0 1px var(--orange-tag),var(--shadow-sm)}
.card.priority:hover{box-shadow:0 0 0 1px var(--orange),var(--shadow-md)}

/* Stripe */
.stripe{height:3px;flex-shrink:0}
.stripe.elal{background:linear-gradient(90deg,#1e40af,#3b82f6)}
.stripe.arkia{background:linear-gradient(90deg,#0369a1,#38bdf8)}
.stripe.israir{background:linear-gradient(90deg,#7c3aed,#a78bfa)}
.stripe.airhaifa{background:linear-gradient(90deg,#059669,#34d399)}

/* Card header */
.card-top{display:flex;align-items:center;gap:6px;padding:12px 16px 0;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;letter-spacing:.2px;white-space:nowrap}
.chip.elal{background:#eff6ff;color:#1d4ed8}
.chip.arkia{background:#f0f9ff;color:#0369a1}
.chip.israir{background:#f5f3ff;color:#7c3aed}
.chip.airhaifa{background:#ecfdf5;color:#059669}
.chip.available{background:var(--green-tag);color:var(--green-dark)}
.chip.gone{background:var(--bg2);color:var(--text3)}
.chip.priority{background:var(--orange-tag);color:#92400e}
.chip.date-chip{background:var(--bg2);color:var(--text4)}
.card-top-right{margin-left:auto;display:flex;align-items:center;gap:4px}

/* Route */
.route{display:flex;align-items:center;padding:14px 16px 0;gap:0}
.route-point{display:flex;flex-direction:column}
.route-point.end{align-items:flex-end}
.iata{font-size:26px;font-weight:800;letter-spacing:.5px;line-height:1;color:var(--text)}
.city-name{font-size:10px;color:var(--text3);margin-top:2px;font-weight:500}
.flight-time{font-size:11px;color:var(--text2);font-weight:600;margin-top:4px}
.route-mid{flex:1;display:flex;flex-direction:column;align-items:center;padding:0 12px;min-width:70px}
.route-line{width:100%;display:flex;align-items:center;position:relative}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dot.dep{background:var(--text2)}
.dot.arr{background:none;border:2px solid var(--text3)}
.dash{flex:1;border-top:1.5px dashed var(--border2)}
.plane-icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:var(--bg);padding:0 3px}
.plane-icon svg{width:13px;height:13px;color:var(--text3)}
.flight-num{font-size:9px;color:var(--text3);margin-top:4px;font-weight:600;letter-spacing:.5px}
.connect-hint{font-size:10px;color:var(--orange-dark);font-weight:600;margin-top:3px;display:flex;align-items:center;gap:3px}
.connect-hint svg{width:11px;height:11px}

/* Price section */
.price-section{padding:12px 16px;margin-top:10px;border-top:1px solid var(--border);display:flex;align-items:center;gap:10px}
.price-block{display:flex;align-items:baseline;gap:3px}
.price-sym{font-size:14px;font-weight:700;color:var(--text3);line-height:1}
.price-num{font-size:28px;font-weight:800;color:var(--text);line-height:1;letter-spacing:-.5px}
.price-info{display:flex;flex-direction:column;gap:1px;margin-left:2px}
.price-type{font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.4px;line-height:1.2}
.price-detail{font-size:10px;color:var(--text3);font-weight:500;line-height:1.2}
.price-right{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.seats-tag{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px}
.seats-tag.urgent{background:var(--red-light);color:var(--red)}
.seats-tag.warning{background:var(--orange-light);color:var(--orange-dark)}
.seats-tag.ok{background:var(--green-light);color:var(--green-dark)}
.seats-tag svg{width:10px;height:10px}

/* Seats hero (El Al) */
.seats-display{display:flex;align-items:center;gap:12px;width:100%}
.seats-ring{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--blue-light);border:2px solid var(--blue-50)}
.seats-ring-num{font-size:20px;font-weight:800;color:var(--blue);line-height:1}
.seats-detail{display:flex;flex-direction:column;gap:1px}
.seats-detail-main{font-size:13px;font-weight:700;color:var(--text)}
.seats-detail-sub{font-size:11px;color:var(--text3);font-weight:500}

/* Card footer */
.card-foot{display:flex;justify-content:space-between;align-items:center;padding:0 16px 12px;gap:8px}
.timestamps{font-size:10px;color:var(--text3);font-weight:500;display:flex;flex-direction:column;gap:1px;max-width:55%}
.timestamps .ts-verified{color:var(--green-dark);font-weight:600}
.book-link{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:var(--white);background:var(--blue);padding:7px 14px;border-radius:var(--radius-xs);transition:var(--transition);box-shadow:0 1px 2px rgba(59,130,246,.3);text-decoration:none;white-space:nowrap}
.book-link:hover{background:var(--blue-hover);box-shadow:0 3px 10px rgba(59,130,246,.35);transform:translateY(-1px)}
.book-link svg{width:11px;height:11px}
.book-link.disabled{background:var(--bg2);color:var(--text3);box-shadow:none;pointer-events:none}

/* ============ EMPTY STATE ============ */
.empty{text-align:center;padding:56px 20px}
.empty-icon{width:56px;height:56px;border-radius:50%;background:var(--blue-light);display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px}
.empty-icon svg{width:24px;height:24px;color:var(--blue)}
.empty h3{font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px}
.empty p{font-size:12px;color:var(--text3);max-width:300px;margin:0 auto;line-height:1.5}

/* ============ (modal removed — open access) ============ */

/* ============ LANDING ============ */
.landing{min-height:calc(100vh - 56px);background:linear-gradient(180deg,var(--bg) 0%,#e0e7ff 100%);display:flex;flex-direction:column;align-items:center}
.landing-hero{width:100%;padding:56px 24px 40px;text-align:center}
.landing-icon{color:var(--blue);margin-bottom:16px}
.landing-icon svg{width:48px;height:48px}
.landing-hero h1{font-size:30px;font-weight:900;letter-spacing:-.5px;margin-bottom:8px;color:var(--text);line-height:1.2}
.landing-hero h1 span{color:var(--blue)}
.landing-hero .landing-sub{font-size:15px;color:var(--text2);line-height:1.6;max-width:520px;margin:0 auto 28px}
.landing-actions{display:flex;gap:10px;justify-content:center;margin-bottom:12px;flex-wrap:wrap}
.btn-lg{padding:12px 28px;font-size:15px;border-radius:var(--radius-sm)}
.landing-note{font-size:12px;color:var(--text3)}

/* Feature cards */
.features{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:720px;width:100%;padding:0 24px;margin-bottom:40px}
.feat-card{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:24px 20px;text-align:left;box-shadow:var(--shadow-xs)}
.feat-card-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:12px;flex-shrink:0}
.feat-card-icon.blue{background:var(--blue-light);color:var(--blue)}
.feat-card-icon.green{background:var(--green-light);color:var(--green-dark)}
.feat-card-icon.orange{background:var(--orange-light);color:var(--orange-dark)}
.feat-card-icon svg{width:18px;height:18px}
.feat-card h3{font-size:14px;font-weight:700;margin-bottom:4px;color:var(--text)}
.feat-card p{font-size:12px;color:var(--text3);line-height:1.5}

/* About section */
.about{max-width:720px;width:100%;padding:0 24px 48px}
.about-box{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);padding:28px 24px;box-shadow:var(--shadow-xs)}
.about-box h2{font-size:18px;font-weight:800;margin-bottom:12px;color:var(--text);letter-spacing:-.2px}
.about-box p{font-size:13px;color:var(--text2);line-height:1.7;margin-bottom:12px}
.about-box p:last-child{margin-bottom:0}
.about-box ul{list-style:none;padding:0;margin:0 0 12px}
.about-box li{font-size:13px;color:var(--text2);line-height:1.7;padding-left:20px;position:relative;margin-bottom:4px}
.about-box li::before{content:'';position:absolute;left:0;top:8px;width:8px;height:8px;border-radius:50%;background:var(--blue-light);border:2px solid var(--blue)}

/* ============ FOOTER ============ */
.page-foot{text-align:center;padding:24px 20px;font-size:11px;color:var(--text3);font-weight:500}

/* ============ RESPONSIVE ============ */
@media(max-width:768px){
  /* Nav */
  .nav{padding:0 14px;height:48px;gap:10px}
  .logo{font-size:15px;gap:6px}
  .logo-mark{width:26px;height:26px;border-radius:7px}
  .logo-mark svg{width:13px;height:13px}
  .update-text{display:none}

  /* Landing */
  .landing-hero{padding:36px 16px 28px}
  .landing-hero h1{font-size:22px}
  .landing-hero .landing-sub{font-size:13px;margin-bottom:20px}
  .landing-actions{width:100%}
  .landing-actions .btn-lg{width:100%;padding:14px 20px;font-size:16px}
  .landing-note{font-size:11px}
  .features{grid-template-columns:1fr;max-width:100%;padding:0 16px;gap:10px;margin-bottom:28px}
  .feat-card{padding:18px 16px}
  .feat-card h3{font-size:13px}
  .feat-card p{font-size:11px}
  .about{padding:0 16px 36px}
  .about-box{padding:20px 16px}
  .about-box h2{font-size:16px}
  .about-box p{font-size:12px}
  .about-box li{font-size:12px}

  /* Hero */
  .hero{padding:20px 14px 24px}
  .hero-left h1{font-size:18px}
  .hero-left p{font-size:12px}
  .hero-inner{flex-direction:column;align-items:flex-start;gap:16px}
  .stats-row{width:100%;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .stat-card{min-width:0;padding:10px 8px;text-align:center}
  .stat-val{font-size:20px}
  .stat-label{font-size:8px;letter-spacing:.5px}

  /* Toolbar */
  .toolbar{height:auto;flex-wrap:wrap;padding:8px 14px;gap:8px}
  .tool-section{padding:0;border:none !important;flex-wrap:wrap}
  .tool-label{font-size:9px}
  .select-wrap select{font-size:12px;padding:8px 28px 8px 10px}
  .pax-label{font-size:10px;min-width:36px}
  .pax-stepper{height:32px}
  .pax-stepper button{width:30px;font-size:15px}
  .pax-stepper .pax-val{font-size:13px}
  .tab-pills{margin-left:0;width:100%;justify-content:center}
  .tab-pill{padding:8px 16px;font-size:12px}

  /* Main content */
  .main{padding:16px 14px 60px}
  .grid{grid-template-columns:1fr}
  .section-title{font-size:14px}
  .date-head h3{font-size:12px}

  /* Cards */
  .card-top{padding:10px 12px 0;gap:4px}
  .chip{font-size:9px;padding:2px 6px}
  .route{padding:10px 12px 0}
  .iata{font-size:22px}
  .city-name{font-size:9px}
  .flight-time{font-size:10px}
  .route-mid{min-width:60px;padding:0 8px}
  .flight-num{font-size:8px}
  .price-section{padding:10px 12px}
  .price-num{font-size:24px}
  .price-sym{font-size:12px}
  .price-type{font-size:9px}
  .price-detail{font-size:9px}
  .seats-ring{width:40px;height:40px}
  .seats-ring-num{font-size:17px}
  .seats-detail-main{font-size:12px}
  .seats-detail-sub{font-size:10px}
  .card-foot{padding:0 12px 10px;gap:6px}
  .timestamps{font-size:9px;max-width:50%}
  .book-link{padding:8px 12px;font-size:11px}
}

@media(max-width:400px){
  .landing-hero h1{font-size:20px}
  .stats-row{grid-template-columns:repeat(2,1fr)}
  .stat-card{padding:8px 6px}
  .stat-val{font-size:18px}
  .iata{font-size:18px}
  .route-mid{min-width:44px;padding:0 4px}
  .price-section{flex-wrap:wrap;gap:6px}
  .price-right{margin-left:0;width:100%;flex-direction:row;justify-content:flex-end}
  .card-foot{flex-wrap:wrap}
  .book-link{width:100%;justify-content:center;padding:10px}
  .pax-group{gap:2px}
  .tool-section{gap:6px}
}
</style>
</head>
<body>

<!-- NAV -->
<nav class="nav">
  <a class="logo" href="#" onclick="showLanding();return false" style="text-decoration:none;color:inherit">
    <div class="logo-mark">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
    </div>
    FlyTLV
  </a>
  <div class="nav-right">
    <div class="live-pill"><span class="live-dot"></span>Live</div>
    <span class="update-text" id="lastUpdate"></span>
  </div>
</nav>

<!-- LANDING (shown when not logged in) -->
<div class="landing" id="landing" style="display:none">
  <div class="landing-hero">
    <div class="landing-icon">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0011.5 2 1.5 1.5 0 0010 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>
    </div>
    <h1>Find Rescue Flights<br>Out of <span>Ben Gurion</span></h1>
    <p class="landing-sub">Built by a parent who couldn't find a flight for his family. FlyTLV scans all available flights departing TLV in the <strong>next 7 days</strong> across El Al, Arkia, Israir, and Air Haifa. Airlines release seats unpredictably throughout the day &mdash; this tool catches them the moment they appear.</p>
    <div class="landing-actions">
      <button class="btn btn-primary btn-lg" onclick="enterDashboard()">Show Me the Flights</button>
    </div>
    <p class="landing-note">Available only from Israel. Free, no registration required.</p>
  </div>

  <div class="features">
    <div class="feat-card">
      <div class="feat-card-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
      <h3>7-Day Rolling Window</h3>
      <p>We scan flights departing in the next 7 days only. This is a rescue tool &mdash; built for urgency, not long-term planning. Availability updates every 2-5 minutes.</p>
    </div>
    <div class="feat-card">
      <div class="feat-card-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></div>
      <h3>Family-Aware</h3>
      <p>Set your exact party &mdash; adults, children, infants. See prices for your entire group and only flights with enough seats to get everyone out.</p>
    </div>
    <div class="feat-card">
      <div class="feat-card-icon orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg></div>
      <h3>30+ Destinations</h3>
      <p>Greece, Spain, Italy, Cyprus, Western &amp; Eastern Europe. Priority routes to key hubs are highlighted so you see the best escape options first.</p>
    </div>
  </div>

  <div class="about">
    <div class="about-box">
      <h2>About FlyTLV</h2>
      <p>FlyTLV is a free rescue-flight scanner for people trying to leave Israel through Ben Gurion Airport. When flights are scarce and seats sell out in minutes, manually refreshing airline websites is not enough. FlyTLV does the work for you &mdash; scanning 4 Israeli carriers every 2-5 minutes and showing you what's actually available <strong>in the next 7 days</strong>.</p>
      <p>This is <strong>not</strong> a vacation planner or a flight comparison site. It is built for one purpose: helping families and individuals find an available seat out of TLV as fast as possible.</p>
      <p><strong>What to expect:</strong></p>
      <ul>
        <li>A live dashboard of every available flight from TLV in the next 7 days, across El Al, Arkia, Israir, and Air Haifa</li>
        <li>Real seat counts &mdash; know exactly how many seats remain before you click through to book</li>
        <li>Prices calculated for your specific party size (adults, children, infants)</li>
        <li>Automatic filtering &mdash; flights without enough seats for your group are hidden</li>
        <li>Priority tagging on key escape routes (Spain, Athens, Rome, and more)</li>
        <li>History of flights that were available and sold out, so you can spot patterns</li>
        <li>One-click booking links direct to the airline &mdash; FlyTLV never sells tickets, only finds them</li>
      </ul>
      <p>This service is only accessible from within Israel. We do not collect any personal data. FlyTLV is free and independent &mdash; we are not affiliated with any airline.</p>
    </div>
  </div>

  <div class="about" style="padding-top:0">
    <div class="about-box" style="border-top:3px solid var(--blue)">
      <h2>Why I Built This</h2>
      <p>We're a young family &mdash; my partner, myself, and our three-year-old son. Before the war, he went to nursery every morning. It was a 35-minute drive, but it was his world &mdash; his friends, his teachers, his routine.</p>
      <p>When things escalated, the nursery mostly shut down. Even the partial reopening didn't work for us &mdash; we couldn't justify the drive under the circumstances. So our son stayed home. Day after day, with no routine, no friends around, no familiar faces beyond us.</p>
      <p>At first he asked about his teachers and friends constantly. Then less. Then he started forgetting their names. Every day the war continues, he loses a little more of the life he had before. That's when we decided we need to get out &mdash; even temporarily &mdash; and find him a normal environment abroad.</p>
      <p>But finding flights was impossible. Airlines release rescue seats unpredictably throughout the day. By the time you spot availability, it's gone. I'd spend hours refreshing airline websites, missing seats by minutes.</p>
      <p>So I built FlyTLV. It scans every Israeli carrier around the clock and shows you the moment a seat opens up. I built it for my family &mdash; and I'm sharing it because I know we're not the only ones going through this.</p>
    </div>
  </div>
</div>

<!-- HERO -->
<div class="hero" style="display:none">
  <div class="hero-inner">
    <div class="hero-left">
      <h1>Rescue Flights from Ben Gurion</h1>
      <p>Next 7 days. Live seat availability across Israeli carriers, scanned every 2-5 minutes.</p>
    </div>
    <div class="stats-row">
      <div class="stat-card"><span class="stat-val" id="statFlights">-</span><span class="stat-label">Available</span></div>
      <div class="stat-card"><span class="stat-val" id="statDest">-</span><span class="stat-label">Destinations</span></div>
      <div class="stat-card"><span class="stat-val" id="statAirlines">-</span><span class="stat-label">Airlines</span></div>
      <div class="stat-card"><span class="stat-val" id="statGone">-</span><span class="stat-label">Sold Out</span></div>
    </div>
  </div>
</div>

<!-- TOOLBAR -->
<div class="toolbar" style="display:none">
  <div class="tool-section">
    <span class="tool-label">Airline</span>
    <div class="select-wrap"><select id="fAirline"><option value="">All</option></select></div>
  </div>
  <div class="tool-section">
    <span class="tool-label">To</span>
    <div class="select-wrap"><select id="fDest"><option value="">All destinations</option></select></div>
  </div>
  <div class="tool-section" id="paxSection">
    <div class="pax-group"><span class="pax-label">Adults</span><div class="pax-stepper"><button onclick="adjPax('adults',-1)">&minus;</button><span class="pax-val" id="paxAdults">1</span><button onclick="adjPax('adults',1)">+</button></div></div>
    <div class="pax-group"><span class="pax-label">Kids</span><div class="pax-stepper"><button onclick="adjPax('children',-1)">&minus;</button><span class="pax-val" id="paxChildren">0</span><button onclick="adjPax('children',1)">+</button></div></div>
    <div class="pax-group"><span class="pax-label">Infants</span><div class="pax-stepper"><button onclick="adjPax('infants',-1)">&minus;</button><span class="pax-val" id="paxInfants">0</span><button onclick="adjPax('infants',1)">+</button></div></div>
  </div>
  <div class="tab-pills" id="statusBtns">
    <button class="tab-pill active" data-v="">All</button>
    <button class="tab-pill" data-v="available">Available</button>
    <button class="tab-pill" data-v="gone">History</button>
  </div>
</div>

<!-- MAIN -->
<div class="main" id="main" style="display:none">
  <div class="empty">
    <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg></div>
    <h3>Loading flights...</h3>
    <p>Data populates after the first scrape cycle completes.</p>
  </div>
</div>

<script>
let offers=[], statusFilter='';
let prefs={adults:1,children:0,infants:0};

/* ── Navigation ── */
function enterDashboard(){
  document.getElementById('landing').style.display='none';
  document.querySelector('.hero').style.display='';
  document.querySelector('.toolbar').style.display='';
  document.getElementById('main').style.display='';
  load();
  // Track dashboard enter
  fetch('/api/analytics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'enter_dashboard'})}).catch(()=>{});
  // Beacon on page hide for time-on-site
  if(!window._beaconSet){window._beaconSet=true;document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')navigator.sendBeacon('/api/analytics/event',JSON.stringify({event:'beacon'}))})}
}
function showLanding(){
  document.getElementById('landing').style.display='flex';
  document.querySelector('.hero').style.display='none';
  document.querySelector('.toolbar').style.display='none';
  document.getElementById('main').style.display='none';
}

/* ── Pax ── */
function adjPax(type, delta){
  const limits = { adults:[1,9], children:[0,9], infants:[0,4] };
  prefs[type] = Math.max(limits[type][0], Math.min(limits[type][1], prefs[type]+delta));
  updatePaxUI(); applyFilters();
  localStorage.setItem('flytlv_prefs',JSON.stringify(prefs));
}
function updatePaxUI(){
  document.getElementById('paxAdults').textContent = prefs.adults;
  document.getElementById('paxChildren').textContent = prefs.children;
  document.getElementById('paxInfants').textContent = prefs.infants;
}
function paxTotal(){ return prefs.adults+prefs.children+prefs.infants }
function paxLabel(){
  const p=[];
  if(prefs.adults) p.push(prefs.adults+'A');
  if(prefs.children) p.push(prefs.children+'C');
  if(prefs.infants) p.push(prefs.infants+'I');
  return p.join('+')||'1A';
}
function estPrice(o){ return o.price_per_adult * (prefs.adults + prefs.children*0.75 + prefs.infants*0.1) }

/* ── Helpers ── */
const CITIES = {
  ATH:'Athens',RHO:'Rhodes',SKG:'Thessaloniki',HER:'Heraklion',CFU:'Corfu',
  JTR:'Santorini',JMK:'Mykonos',LCA:'Larnaca',PFO:'Paphos',ECN:'Ercan',
  BER:'Berlin',PRG:'Prague',BUD:'Budapest',VIE:'Vienna',SOF:'Sofia',
  BEG:'Belgrade',OTP:'Bucharest',WAW:'Warsaw',MXP:'Milan',FCO:'Rome',
  BCN:'Barcelona',LIS:'Lisbon',ZRH:'Zurich',AMS:'Amsterdam',CDG:'Paris',
  LHR:'London',MUC:'Munich',FRA:'Frankfurt',EMA:'East Midlands',
  MAD:'Madrid',GVA:'Geneva',LYS:'Lyon',VCE:'Venice',TIA:'Tirana',
  TLV:'Tel Aviv',SZG:'Salzburg',TBS:'Tbilisi',KRK:'Krakow',LTN:'London Luton'
};
function city(c){ return CITIES[c]||c }
function acl(n){ const l=n.toLowerCase(); if(l.includes('el al'))return'elal'; if(l.includes('arkia'))return'arkia'; if(l.includes('israir'))return'israir'; return'airhaifa' }
function isPri(d){ return false }

function fmtDate(d){
  const dt=new Date(d+'T00:00:00'), now=new Date(); now.setHours(0,0,0,0);
  const diff=Math.round((dt-now)/864e5);
  const wd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
  const mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()];
  const lbl=wd+', '+dt.getDate()+' '+mn;
  if(diff===0) return 'Today \u2014 '+lbl;
  if(diff===1) return 'Tomorrow \u2014 '+lbl;
  if(diff<0) return lbl+' (past)';
  return 'In '+diff+'d \u2014 '+lbl;
}
function ago(s){
  if(!s) return '';
  const m=Math.floor((Date.now()-new Date(s).getTime())/6e4);
  if(m<1) return 'just now';
  if(m<60) return m+'m ago';
  const h=Math.floor(m/60);
  if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}
function fmtNum(n){ return n.toLocaleString('en-US',{maximumFractionDigits:0}) }
function cur(c){ return c==='ILS'?'\\u20AA':c==='EUR'?'\\u20AC':'$' }

/* ── Render ── */
function renderCard(o){
  const ac=acl(o.airline), gone=o.status==='gone', seatsOnly=o.total_price===0;
  const pri=isPri(o.destination)&&!gone;
  const sn=o.seats_available;

  let h='<div class="card'+(gone?' gone':'')+(pri?' priority':'')+'">';
  h+='<div class="stripe '+ac+'"></div>';

  // Top: chips
  h+='<div class="card-top">';
  h+='<span class="chip '+ac+'">'+o.airline+'</span>';
  h+='<span class="chip date-chip">'+fmtDate(o.departure_date).split(' \u2014 ')[0]+'</span>';
  if(pri) h+='<span class="chip priority">\\u2605 Priority</span>';
  h+='<span class="card-top-right"><span class="chip '+(gone?'gone':'available')+'">'+(gone?'Sold Out':'Available')+'</span></span>';
  h+='</div>';

  // Route
  h+='<div class="route">';
  h+='<div class="route-point"><span class="iata">'+o.origin+'</span><span class="city-name">'+city(o.origin)+'</span>'+(o.departure_time?'<span class="flight-time">'+o.departure_time+'</span>':'')+'</div>';
  h+='<div class="route-mid"><div class="route-line"><span class="dot dep"></span><span class="dash"></span><span class="plane-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0011.5 2 1.5 1.5 0 0010 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg></span><span class="dash"></span><span class="dot arr"></span></div><span class="flight-num">'+o.flight_number+'</span></div>';
  const connectHint = '';
  h+='<div class="route-point end"><span class="iata">'+o.destination+'</span><span class="city-name">'+city(o.destination)+'</span>'+(o.arrival_time?'<span class="flight-time">'+o.arrival_time+'</span>':'')+connectHint+'</div>';
  h+='</div>';

  // Price section
  h+='<div class="price-section">';
  if(seatsOnly){
    h+='<div class="seats-display">';
    h+='<div class="seats-ring"><span class="seats-ring-num">'+(sn!==null?sn:'?')+'</span></div>';
    h+='<div class="seats-detail"><span class="seats-detail-main">Seats Available</span><span class="seats-detail-sub">Check elal.com for pricing</span></div>';
    h+='</div>';
  } else if(gone){
    // HISTORY: show normalized per-person price
    h+='<div class="price-block"><span class="price-sym">'+cur(o.currency)+'</span><span class="price-num">'+fmtNum(o.price_per_adult)+'</span></div>';
    const isRT=o.conditions&&o.conditions.includes('Round-trip');
    h+='<div class="price-info"><span class="price-type">'+(isRT?'Round-trip':'One-way')+' / person</span><span class="price-detail">When last available</span></div>';
  } else {
    // AVAILABLE: show estimated party price
    const ep=estPrice(o);
    h+='<div class="price-block"><span class="price-sym">'+cur(o.currency)+'</span><span class="price-num">'+fmtNum(ep)+'</span></div>';
    const isRT=o.conditions&&o.conditions.includes('Round-trip');
    h+='<div class="price-info"><span class="price-type">'+(isRT?'Round-trip':'One-way')+' \\u00b7 '+paxLabel()+'</span><span class="price-detail">'+cur(o.currency)+fmtNum(o.price_per_adult)+'/person</span></div>';
    if(sn!==null){
      const urg=sn<=3?'urgent':sn<=10?'warning':'ok';
      const icon=sn<=3?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>':'';
      h+='<div class="price-right"><span class="seats-tag '+urg+'">'+icon+sn+' seat'+(sn!==1?'s':'')+' left</span></div>';
    }
  }
  h+='</div>';

  // Footer
  h+='<div class="card-foot">';
  h+='<div class="timestamps">';
  h+='<span>Found '+ago(o.first_seen)+'</span>';
  if(gone){
    h+='<span>Gone '+ago(o.gone_at)+'</span>';
  } else {
    h+='<span class="ts-verified">\\u2713 Verified '+ago(o.last_seen)+'</span>';
  }
  h+='</div>';
  if(!gone && o.booking_url){
    h+='<a class="book-link" href="'+o.booking_url+'" target="_blank" rel="noopener">Book <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg></a>';
  }
  h+='</div>';

  h+='</div>';
  return h;
}

function renderDateGroup(date, items){
  const av = items.filter(o=>o.status==='available').length;
  let h = '<div class="date-group"><div class="date-head"><h3>'+fmtDate(date)+'</h3>'+(av?'<span class="tag">'+av+' available</span>':'')+'</div><div class="grid">';
  for(const o of items) h += renderCard(o);
  h += '</div></div>';
  return h;
}

function render(list){
  const el = document.getElementById('main');
  if(!list.length){
    el.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></div><h3>No flights match your filters</h3><p>We scan the next 7 days across all carriers. Try widening your filters or check back shortly.</p></div>';
    return;
  }

  // Sort: available by departure date then price; gone by departure date then price
  const sortByDate = (a,b) => {
    const da=a.departure_date, db=b.departure_date;
    if(da!==db) return da<db?-1:1;
    const pa=isPri(a.destination)?0:1, pb=isPri(b.destination)?0:1;
    if(pa!==pb) return pa-pb;
    return (a.price_per_adult||9999)-(b.price_per_adult||9999);
  };
  const avail = list.filter(o=>o.status==='available').sort(sortByDate);
  const gone = list.filter(o=>o.status==='gone').sort(sortByDate);
  let h = '';

  if(statusFilter!=='gone'){
    h+='<div class="section"><div class="section-head"><span class="section-dot green"></span><span class="section-title">Available Now</span><span class="section-count green">'+avail.length+'</span></div>';
    if(avail.length===0){
      h+='<div class="empty" style="padding:40px 20px"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></div><h3>No available flights in the next 7 days</h3><p>We check every 2-5 minutes across all carriers. New flights appear here the moment a seat opens up.</p></div>';
    } else {
      const byDate={}; avail.forEach(o=>{(byDate[o.departure_date]=byDate[o.departure_date]||[]).push(o)});
      for(const[date,items] of Object.entries(byDate)) h+=renderDateGroup(date,items);
    }
    h+='</div>';
  }

  if(statusFilter!=='available' && gone.length>0){
    h+='<hr class="section-sep">';
    h+='<div class="section"><div class="section-head"><span class="section-dot gray"></span><span class="section-title">Previously Found</span><span class="section-count gray">'+gone.length+'</span></div>';
    const byDate={}; gone.forEach(o=>{(byDate[o.departure_date]=byDate[o.departure_date]||[]).push(o)});
    for(const[date,items] of Object.entries(byDate)) h+=renderDateGroup(date,items);
    h+='</div>';
  }

  el.innerHTML = h;
}

function applyFilters(){
  let f = offers;
  const a=document.getElementById('fAirline').value, d=document.getElementById('fDest').value;
  if(a) f=f.filter(o=>o.airline===a);
  if(d) f=f.filter(o=>o.destination===d);
  if(statusFilter) f=f.filter(o=>o.status===statusFilter);
  const pt=paxTotal();
  f=f.filter(o=>o.status==='gone'||o.seats_available===null||o.seats_available>=pt);
  render(f);
}

document.getElementById('statusBtns').addEventListener('click', e => {
  const b=e.target.closest('.tab-pill'); if(!b) return;
  document.querySelectorAll('.tab-pill').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); statusFilter=b.dataset.v; applyFilters();
});
document.getElementById('fAirline').addEventListener('change', applyFilters);
document.getElementById('fDest').addEventListener('change', applyFilters);

function fillSelect(id, opts){
  const s=document.getElementById(id), cur=s.value, has=new Set([...s.options].map(o=>o.value));
  opts.forEach(o=>{ const v=typeof o==='string'?o:o.value, l=typeof o==='string'?o:o.label; if(!has.has(v)){const el=document.createElement('option');el.value=v;el.textContent=l;s.appendChild(el);has.add(v)} });
  s.value=cur;
}

async function load(){
  try {
    const [oR, sR] = await Promise.all([fetch('/api/offers'), fetch('/api/stats')]);
    offers = await oR.json();
    const st = await sR.json();
    document.getElementById('statFlights').textContent = st.available;
    document.getElementById('statDest').textContent = st.destinations.length;
    document.getElementById('statAirlines').textContent = st.airlines.length;
    document.getElementById('statGone').textContent = st.gone;
    document.getElementById('lastUpdate').textContent = 'Updated '+new Date().toLocaleTimeString();
    fillSelect('fAirline', st.airlines);
    fillSelect('fDest', st.destinations.map(d=>({value:d, label:d+' \\u2014 '+city(d)})));
    applyFilters();
  } catch(e) { console.error(e) }
}

// Restore saved prefs from localStorage
try { const sp=JSON.parse(localStorage.getItem('flytlv_prefs')); if(sp){prefs=Object.assign(prefs,sp)} } catch(e){}
updatePaxUI();

// Show landing page on load
document.getElementById('landing').style.display='flex';

setInterval(()=>{ if(document.getElementById('main').style.display!=='none') load() }, 30000);
</script>
</body>
</html>`;
}

function analyticsLoginHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlyTLV Analytics</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#fff}
.box{background:#1e293b;border-radius:16px;padding:40px;width:360px;max-width:90vw;box-shadow:0 20px 40px rgba(0,0,0,.3)}
h1{font-size:20px;font-weight:800;margin-bottom:4px}p{color:#94a3b8;font-size:13px;margin-bottom:24px}
input{width:100%;padding:12px;border:1.5px solid #334155;border-radius:8px;background:#0f172a;color:#fff;font-size:14px;font-family:inherit;outline:none;margin-bottom:16px}
input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.2)}
button{width:100%;padding:12px;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-size:14px;font-weight:700;cursor:pointer}
button:hover{background:#2563eb}</style></head>
<body><div class="box"><h1>FlyTLV Analytics</h1><p>Enter password to access dashboard</p>
<form method="GET" action="/analytics"><input type="password" name="pwd" placeholder="Password" autofocus>
<button type="submit">Access Dashboard</button></form></div></body></html>`;
}

function analyticsHtml(data: any, range: string, pwd: string): string {
  const d = data;
  const totalPV = d.daily.reduce((s: number, r: any) => s + r.page_views, 0);
  const totalUV = d.totals.total_visitors;
  const totalAllTime = d.totals.totalAllTime;
  const todayPV = d.today.page_views;
  const todayUV = d.today.unique_visitors;
  const todayDE = d.today.dashboard_enters;
  const totalDE = d.dashboardEnters;
  const mobile = d.devices.find((x: any) => x.device_type === 'mobile')?.count || 0;
  const desktop = d.devices.find((x: any) => x.device_type === 'desktop')?.count || 0;
  const mPct = totalUV > 0 ? Math.round(mobile / (mobile + desktop) * 100) : 0;

  const maxPV = Math.max(...d.daily.map((r: any) => r.page_views), 1);
  const maxUV = Math.max(...d.daily.map((r: any) => r.unique_visitors), 1);
  const barW = d.daily.length > 0 ? Math.max(4, Math.floor(760 / d.daily.length) - 2) : 20;
  let chartBars = '';
  d.daily.forEach((r: any, i: number) => {
    const x = i * (barW + 2);
    const hPV = Math.round((r.page_views / maxPV) * 140);
    const hUV = Math.round((r.unique_visitors / maxUV) * 140);
    chartBars += '<rect x="' + x + '" y="' + (150 - hPV) + '" width="' + barW + '" height="' + hPV + '" rx="2" fill="rgba(59,130,246,.3)"/>'
      + '<rect x="' + x + '" y="' + (150 - hUV) + '" width="' + barW + '" height="' + hUV + '" rx="2" fill="#3b82f6"/>';
  });
  const chartW = d.daily.length * (barW + 2);

  const refRows = d.topReferrers.map((r: any) =>
    '<tr><td style="padding:8px 12px;font-size:13px;color:#e2e8f0;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.referrer) + '</td><td style="padding:8px 12px;font-size:13px;font-weight:700;color:#fff;text-align:right">' + r.count + '</td></tr>'
  ).join('');

  const countryRows = d.countries.map((r: any) =>
    '<tr><td style="padding:8px 12px;font-size:13px;color:#e2e8f0">' + (r.country || 'Unknown') + '</td><td style="padding:8px 12px;font-size:13px;font-weight:700;color:#fff;text-align:right">' + r.count + '</td></tr>'
  ).join('');

  const milestoneRows = d.milestones.map((m: any) =>
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #334155"><span style="font-size:14px;font-weight:700;color:#3b82f6">' + m.milestone.toLocaleString() + ' visitors</span><span style="font-size:12px;color:#94a3b8">' + new Date(m.reached_at).toLocaleDateString() + '</span></div>'
  ).join('');

  const ar = (r: string) => r === range ? 'background:#3b82f6;color:#fff' : 'background:#1e293b;color:#94a3b8';

  const css = '*{margin:0;padding:0;box-sizing:border-box}'
    + "body{font-family:'Inter',system-ui,sans-serif;background:#0f172a;color:#fff;min-height:100vh;-webkit-font-smoothing:antialiased}"
    + '.wrap{max-width:900px;margin:0 auto;padding:24px 16px 60px}'
    + '.head{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px}'
    + '.head h1{font-size:22px;font-weight:900;letter-spacing:-.5px}.head h1 span{color:#3b82f6}'
    + '.ranges{display:flex;gap:4px}.ranges a{padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;transition:all .2s}.ranges a:hover{background:#334155;color:#fff}'
    + '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:28px}'
    + '.card{background:#1e293b;border-radius:12px;padding:20px;border:1px solid #334155}'
    + '.card-val{font-size:28px;font-weight:800;letter-spacing:-.5px;line-height:1}'
    + '.card-val.blue{color:#3b82f6}.card-val.green{color:#22c55e}.card-val.orange{color:#f59e0b}.card-val.purple{color:#a78bfa}'
    + '.card-label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-top:4px;font-weight:600}'
    + '.section{background:#1e293b;border-radius:12px;padding:20px;border:1px solid #334155;margin-bottom:16px}'
    + '.section h2{font-size:14px;font-weight:700;margin-bottom:14px;color:#e2e8f0}'
    + 'table{width:100%;border-collapse:collapse}tr:not(:last-child) td{border-bottom:1px solid #334155}'
    + '.chart-wrap{overflow-x:auto}'
    + '.legend{display:flex;gap:16px;margin-top:10px}.legend span{font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:4px}.legend .dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}'
    + '.device-bar{height:20px;border-radius:10px;overflow:hidden;display:flex;margin-bottom:8px}.device-bar div{height:100%}'
    + '.device-labels{display:flex;justify-content:space-between;font-size:12px;color:#94a3b8}'
    + '.back{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#64748b;margin-bottom:16px;text-decoration:none}.back:hover{color:#94a3b8}'
    + '@media(max-width:600px){.cards{grid-template-columns:repeat(2,1fr)}.card-val{font-size:22px}}';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>FlyTLV Analytics</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">'
    + '<style>' + css + '</style></head><body><div class="wrap">'
    + '<a class="back" href="/">&larr; Back to FlyTLV</a>'
    + '<div class="head"><h1>Fly<span>TLV</span> Analytics</h1>'
    + '<div class="ranges">'
    + '<a href="/analytics?pwd=' + pwd + '&range=7d" style="' + ar('7d') + '">7 days</a>'
    + '<a href="/analytics?pwd=' + pwd + '&range=30d" style="' + ar('30d') + '">30 days</a>'
    + '<a href="/analytics?pwd=' + pwd + '&range=all" style="' + ar('all') + '">All time</a>'
    + '</div></div>'
    + '<div class="cards">'
    + '<div class="card"><div class="card-val blue">' + totalAllTime.toLocaleString() + '</div><div class="card-label">All-time visitors</div></div>'
    + '<div class="card"><div class="card-val green">' + todayUV + '</div><div class="card-label">Today\'s visitors</div></div>'
    + '<div class="card"><div class="card-val orange">' + totalPV.toLocaleString() + '</div><div class="card-label">Page views (' + range + ')</div></div>'
    + '<div class="card"><div class="card-val purple">' + totalDE.toLocaleString() + '</div><div class="card-label">Dashboard views (' + range + ')</div></div>'
    + '<div class="card"><div class="card-val blue">' + todayPV + '</div><div class="card-label">Today\'s page views</div></div>'
    + '<div class="card"><div class="card-val green">' + todayDE + '</div><div class="card-label">Today\'s dashboard</div></div>'
    + '</div>'
    + '<div class="section"><h2>Traffic (' + range + ')</h2>'
    + '<div class="chart-wrap"><svg width="' + Math.max(chartW, 200) + '" height="160" style="display:block">' + chartBars + '</svg></div>'
    + '<div class="legend"><span><span class="dot" style="background:#3b82f6"></span> Unique visitors</span><span><span class="dot" style="background:rgba(59,130,246,.3)"></span> Page views</span></div></div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">'
    + '<div class="section" style="margin-bottom:0"><h2>Devices</h2>'
    + '<div class="device-bar"><div style="width:' + mPct + '%;background:#3b82f6"></div><div style="width:' + (100 - mPct) + '%;background:#8b5cf6"></div></div>'
    + '<div class="device-labels"><span>Mobile ' + mPct + '% (' + mobile + ')</span><span>Desktop ' + (100 - mPct) + '% (' + desktop + ')</span></div></div>'
    + '<div class="section" style="margin-bottom:0"><h2>Countries</h2>'
    + '<table>' + (countryRows || '<tr><td style="padding:8px;color:#64748b;font-size:13px">No data yet</td></tr>') + '</table></div></div>'
    + '<div class="section"><h2>Top Referrers</h2>'
    + '<table>' + (refRows || '<tr><td style="padding:8px;color:#64748b;font-size:13px">No referrer data yet &mdash; share your link!</td></tr>') + '</table></div>'
    + (d.milestones.length > 0 ? '<div class="section"><h2>Milestones</h2>' + milestoneRows + '</div>' : '')
    + '<div style="text-align:center;padding:20px;font-size:11px;color:#475569">FlyTLV Analytics &middot; Self-hosted &middot; No cookies &middot; Privacy-first</div>'
    + '</div></body></html>';
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function maintenanceHtml(): string {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>FlyTLV - Temporarily Unavailable</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">'
    + '<style>*{margin:0;padding:0;box-sizing:border-box}'
    + "body{font-family:'Inter',system-ui,sans-serif;background:#0f172a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;-webkit-font-smoothing:antialiased}"
    + '.box{text-align:center;max-width:480px;padding:40px 24px}'
    + '.logo{display:inline-flex;align-items:center;gap:8px;font-size:20px;font-weight:800;margin-bottom:32px}'
    + '.logo-mark{width:34px;height:34px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:10px;display:flex;align-items:center;justify-content:center}'
    + '.logo-mark svg{width:18px;height:18px}'
    + 'h1{font-size:24px;font-weight:800;margin-bottom:8px;letter-spacing:-.5px}'
    + 'p{color:#94a3b8;font-size:14px;line-height:1.7;margin-bottom:12px}'
    + '.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#f59e0b;background:rgba(245,158,11,.1);padding:6px 14px;border-radius:20px;border:1px solid rgba(245,158,11,.2);margin-bottom:24px}'
    + '.pill span{width:6px;height:6px;background:#f59e0b;border-radius:50%;animation:pulse 2s infinite}'
    + '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}'
    + '</style></head><body><div class="box">'
    + '<div class="logo"><div class="logo-mark"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg></div>FlyTLV</div>'
    + '<div class="pill"><span></span>Maintenance</div>'
    + '<h1>We\'ll be back shortly</h1>'
    + '<p>FlyTLV is temporarily offline for maintenance. Our flight scanners are still running in the background and we\'ll be back up soon.</p>'
    + '<p style="color:#64748b;font-size:12px">Rescue flight scanner for Ben Gurion Airport</p>'
    + '</div></body></html>';
}
