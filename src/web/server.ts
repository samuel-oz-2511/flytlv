import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { OfferStore } from '../store/offer-store.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('web');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startWebServer(store: OfferStore, port: number = 3737): void {
  const app = express();

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
<title>FlyTLV - Last-Minute Flights from Israel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#f5f6f8;--white:#fff;--border:#e8eaed;--border2:#d1d5db;
  --text:#0f172a;--text2:#475569;--text3:#94a3b8;
  --blue:#2563eb;--blue-light:#eff6ff;--blue-dark:#1d4ed8;--blue-50:#dbeafe;
  --green:#059669;--green-light:#ecfdf5;--green-tag:#d1fae5;
  --red:#dc2626;--red-light:#fef2f2;--red-tag:#fecaca;
  --orange:#d97706;--orange-light:#fffbeb;--orange-tag:#fde68a;
  --purple:#7c3aed;--purple-light:#f5f3ff;
  --radius:14px;--radius-sm:8px;--radius-xs:6px;
  --shadow-sm:0 1px 2px rgba(0,0,0,.04);
  --shadow:0 2px 8px rgba(0,0,0,.06);
  --shadow-lg:0 8px 32px rgba(0,0,0,.08);
}
body{font-family:'DM Sans',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}
a{text-decoration:none}

/* NAV */
.nav{background:var(--white);border-bottom:1px solid var(--border);padding:0 max(24px,calc((100vw - 1200px)/2));display:flex;align-items:center;height:60px;gap:20px;position:sticky;top:0;z-index:100;backdrop-filter:blur(12px);background:rgba(255,255,255,.92)}
.logo{font-size:19px;font-weight:800;letter-spacing:-.5px;color:var(--text);display:flex;align-items:center;gap:8px}
.logo-icon{width:32px;height:32px;background:linear-gradient(135deg,var(--blue) 0%,#7c3aed 100%);border-radius:8px;display:flex;align-items:center;justify-content:center}
.logo-icon svg{width:18px;height:18px}
.nav-right{margin-left:auto;display:flex;align-items:center;gap:14px}
.live-dot{width:8px;height:8px;background:var(--green);border-radius:50%;animation:pulse 2s infinite;box-shadow:0 0 0 0 rgba(5,150,105,.4)}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(5,150,105,.4)}70%{box-shadow:0 0 0 6px rgba(5,150,105,0)}100%{box-shadow:0 0 0 0 rgba(5,150,105,0)}}
.live-text{font-size:12px;font-weight:600;color:var(--green);display:flex;align-items:center;gap:6px}
.update-text{font-size:11px;color:var(--text3);font-weight:500}

/* HERO */
.hero{background:var(--text);padding:40px max(24px,calc((100vw - 1200px)/2)) 44px;color:#fff;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(37,99,235,.15) 0%,transparent 50%,rgba(124,58,237,.1) 100%)}
.hero::after{content:'';position:absolute;top:0;right:0;width:400px;height:100%;background:radial-gradient(ellipse at 100% 50%,rgba(37,99,235,.12) 0%,transparent 60%);pointer-events:none}
.hero-inner{position:relative;z-index:1}
.hero h1{font-size:28px;font-weight:800;letter-spacing:-.5px;margin-bottom:4px}
.hero p{font-size:14px;color:rgba(255,255,255,.6);max-width:480px;line-height:1.5}
.hero-stats{display:flex;gap:36px;margin-top:24px}
.hero-stat{display:flex;flex-direction:column}
.hero-stat-val{font-size:32px;font-weight:800;letter-spacing:-.5px;line-height:1}
.hero-stat-label{font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:rgba(255,255,255,.4);margin-top:4px;font-weight:600}

/* FILTERS */
.filters-bar{background:var(--white);border-bottom:1px solid var(--border);padding:10px max(24px,calc((100vw - 1200px)/2));display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.filter-pill{display:flex;align-items:center;gap:6px}
.filter-pill label{font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.filter-pill select{border:1px solid var(--border);background:var(--white);padding:7px 28px 7px 10px;border-radius:var(--radius-xs);font-size:13px;color:var(--text);font-family:inherit;cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2394A3B8' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;font-weight:500;transition:all .15s}
.filter-pill select:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(37,99,235,.08)}
.seg-btns{display:flex;border:1px solid var(--border);border-radius:var(--radius-xs);overflow:hidden;margin-left:auto}
.seg-btn{padding:7px 16px;font-size:12px;font-weight:600;color:var(--text3);background:var(--white);border:none;cursor:pointer;font-family:inherit;transition:all .15s}
.seg-btn:not(:last-child){border-right:1px solid var(--border)}
.seg-btn.active{background:var(--text);color:#fff}
.seg-btn:hover:not(.active){background:var(--bg);color:var(--text2)}

/* CONTENT */
.main{padding:28px max(24px,calc((100vw - 1200px)/2)) 80px;max-width:100%}

/* SECTION HEADERS */
.section-header{display:flex;align-items:center;gap:10px;margin-bottom:20px;margin-top:4px}
.section-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.section-icon.green{background:var(--green-light)}
.section-icon.gray{background:#f1f5f9}
.section-header h2{font-size:18px;font-weight:700;letter-spacing:-.2px}
.section-header .count{font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;letter-spacing:.2px}
.section-header .count.green{background:var(--green-tag);color:var(--green)}
.section-header .count.gray{background:#e2e8f0;color:var(--text3)}
.section-divider{border:none;margin:44px 0 28px;position:relative;height:1px;background:var(--border)}
.section-divider::after{content:'Previously Found';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--bg);padding:0 16px;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px}

/* DATE GROUP */
.date-section{margin-bottom:28px}
.date-label{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.date-label h3{font-size:14px;font-weight:700;color:var(--text2)}
.date-label .badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:var(--blue-50);color:var(--blue)}

/* GRID */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(370px,1fr));gap:16px}

/* CARD */
.card{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;transition:all .2s;box-shadow:var(--shadow-sm)}
.card:hover{box-shadow:var(--shadow-lg);border-color:var(--border2);transform:translateY(-1px)}
.card.gone{opacity:.5}
.card.gone:hover{opacity:.7}

/* CARD TOP BAR - airline color stripe */
.card-stripe{height:3px}
.card-stripe.elal{background:linear-gradient(90deg,#1e3a5f,#2563eb)}
.card-stripe.arkia{background:linear-gradient(90deg,#0369a1,#38bdf8)}
.card-stripe.israir{background:linear-gradient(90deg,#7c3aed,#a78bfa)}
.card-stripe.airhaifa{background:linear-gradient(90deg,#059669,#34d399)}

/* CARD HEADER */
.card-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px 0}
.airline-chip{font-size:11px;font-weight:700;padding:4px 9px;border-radius:var(--radius-xs);letter-spacing:.3px}
.airline-chip.elal{background:#eff6ff;color:#1d4ed8}
.airline-chip.arkia{background:#f0f9ff;color:#0369a1}
.airline-chip.israir{background:#f5f3ff;color:#7c3aed}
.airline-chip.airhaifa{background:#ecfdf5;color:#059669}
.status-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:4px 10px;border-radius:20px}
.status-badge.available{background:var(--green-tag);color:var(--green)}
.status-badge.gone{background:var(--red-tag);color:var(--red)}

/* ROUTE */
.route{display:flex;align-items:center;padding:16px 18px 0;gap:0}
.route-point{display:flex;flex-direction:column}
.route-point.end{align-items:flex-end}
.route-iata{font-size:28px;font-weight:800;letter-spacing:.5px;line-height:1;color:var(--text)}
.route-city{font-size:11px;color:var(--text3);margin-top:2px;font-weight:500}
.route-time{font-size:12px;color:var(--text2);font-weight:600;margin-top:4px}
.route-connector{flex:1;display:flex;flex-direction:column;align-items:center;padding:0 14px;min-width:80px}
.route-line-wrap{width:100%;display:flex;align-items:center;gap:0;position:relative}
.route-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.route-dot.dep{background:var(--text2)}
.route-dot.arr{background:none;border:2px solid var(--text3)}
.route-dash{flex:1;height:0;border-top:2px dashed var(--border2)}
.route-plane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:var(--bg);padding:0 4px}
.route-plane svg{width:14px;height:14px;color:var(--text3)}
.route-fn{font-size:10px;color:var(--text3);margin-top:5px;font-weight:600;letter-spacing:.5px}

/* PRICE AREA */
.price-area{padding:14px 18px 16px;margin-top:12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:12px}

/* Priced flight */
.price-main{display:flex;align-items:baseline;gap:4px}
.price-currency{font-size:15px;font-weight:700;color:var(--text3);line-height:1}
.price-amount{font-size:30px;font-weight:800;color:var(--text);line-height:1;letter-spacing:-1px}
.price-meta{display:flex;flex-direction:column;gap:2px;margin-left:4px}
.price-label{font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;line-height:1}
.price-breakdown{font-size:11px;color:var(--text3);font-weight:500;line-height:1}
.price-right{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.seats-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px}
.seats-pill.urgent{background:var(--red-light);color:var(--red)}
.seats-pill.warning{background:var(--orange-light);color:var(--orange)}
.seats-pill.ok{background:var(--green-light);color:var(--green)}
.seats-pill svg{width:12px;height:12px}

/* Seats-only (El Al) */
.seats-hero{display:flex;align-items:center;gap:14px;width:100%}
.seats-circle{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--blue-light);border:2px solid var(--blue-50)}
.seats-circle-num{font-size:22px;font-weight:800;color:var(--blue);line-height:1}
.seats-info{display:flex;flex-direction:column;gap:2px}
.seats-info-label{font-size:14px;font-weight:700;color:var(--text)}
.seats-info-sub{font-size:12px;color:var(--text3);font-weight:500}

/* CARD FOOTER */
.card-foot{display:flex;justify-content:space-between;align-items:center;padding:0 18px 14px}
.card-meta{font-size:11px;color:var(--text3);font-weight:500;max-width:60%}
.book-btn{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--white);background:var(--blue);padding:8px 16px;border-radius:var(--radius-xs);transition:all .15s;box-shadow:0 1px 3px rgba(37,99,235,.3)}
.book-btn:hover{background:var(--blue-dark);box-shadow:0 2px 8px rgba(37,99,235,.4);transform:translateY(-1px)}
.book-btn svg{width:12px;height:12px}
.book-btn.gone-btn{background:var(--bg);color:var(--text3);box-shadow:none;pointer-events:none}

/* EMPTY */
.empty-state{text-align:center;padding:64px 20px}
.empty-icon{width:64px;height:64px;border-radius:50%;background:var(--blue-light);display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px}
.empty-icon svg{width:28px;height:28px;color:var(--blue)}
.empty-state h3{font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px}
.empty-state p{font-size:13px;color:var(--text3);max-width:320px;margin:0 auto;line-height:1.5}

/* FOOTER */
.page-footer{text-align:center;padding:24px 20px;font-size:11px;color:var(--text3);font-weight:500}
.page-footer a{color:var(--blue);font-weight:600}

/* MOBILE */
@media(max-width:768px){
  .hero{padding:28px 20px 32px}
  .hero h1{font-size:22px}
  .hero-stats{gap:20px;flex-wrap:wrap}
  .hero-stat-val{font-size:26px}
  .nav,.filters-bar,.main{padding-left:16px;padding-right:16px}
  .grid{grid-template-columns:1fr}
  .route-iata{font-size:24px}
  .price-amount{font-size:26px}
  .seg-btns{margin-left:0}
  .filters-bar{gap:8px}
  .hero p{font-size:13px}
  .card-meta{max-width:50%}
}
@media(max-width:400px){
  .hero-stats{gap:16px}
  .hero-stat-val{font-size:22px}
  .route-iata{font-size:20px}
  .route-connector{min-width:60px;padding:0 8px}
  .price-area{flex-wrap:wrap;gap:8px}
  .price-right{margin-left:0;flex-direction:row;width:100%}
}
</style>
</head>
<body>

<nav class="nav">
  <div class="logo">
    <div class="logo-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
    </div>
    FlyTLV
  </div>
  <div class="nav-right">
    <span class="live-text"><span class="live-dot"></span>Live</span>
    <span class="update-text" id="lastUpdate"></span>
  </div>
</nav>

<div class="hero">
  <div class="hero-inner">
    <h1>Last-Minute Flights from Israel</h1>
    <p>Real-time seat availability and pricing across Israeli carriers. Updated every 5 minutes.</p>
    <div class="hero-stats">
      <div class="hero-stat">
        <span class="hero-stat-val" id="statFlights">-</span>
        <span class="hero-stat-label">Available</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-val" id="statDest">-</span>
        <span class="hero-stat-label">Destinations</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-val" id="statAirlines">-</span>
        <span class="hero-stat-label">Airlines</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-val" id="statGone">-</span>
        <span class="hero-stat-label">Sold Out</span>
      </div>
    </div>
  </div>
</div>

<div class="filters-bar">
  <div class="filter-pill">
    <label>Airline</label>
    <select id="fAirline"><option value="">All Airlines</option></select>
  </div>
  <div class="filter-pill">
    <label>To</label>
    <select id="fDest"><option value="">All Destinations</option></select>
  </div>
  <div class="seg-btns" id="statusBtns">
    <button class="seg-btn active" data-v="">All</button>
    <button class="seg-btn" data-v="available">Available Only</button>
    <button class="seg-btn" data-v="gone">History Only</button>
  </div>
</div>

<div class="main" id="main">
  <div class="empty-state">
    <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg></div>
    <h3>Loading flights...</h3>
    <p>Data populates after the first scrape cycle completes</p>
  </div>
</div>

<script>
let offers=[], statusFilter='';
const C={
  ATH:'Athens',RHO:'Rhodes',SKG:'Thessaloniki',HER:'Heraklion',CFU:'Corfu',
  JTR:'Santorini',JMK:'Mykonos',LCA:'Larnaca',PFO:'Paphos',ECN:'Ercan',
  BER:'Berlin',PRG:'Prague',BUD:'Budapest',VIE:'Vienna',SOF:'Sofia',
  BEG:'Belgrade',OTP:'Bucharest',WAW:'Warsaw',MXP:'Milan',FCO:'Rome',
  BCN:'Barcelona',LIS:'Lisbon',ZRH:'Zurich',AMS:'Amsterdam',CDG:'Paris',
  LHR:'London',MUC:'Munich',FRA:'Frankfurt',EMA:'East Midlands',
  MAD:'Madrid',GVA:'Geneva',LYS:'Lyon',VCE:'Venice',TIA:'Tirana',
  TLV:'Tel Aviv',SZG:'Salzburg',TBS:'Tbilisi',KRK:'Krakow',LTN:'London Luton'
};
function city(c){return C[c]||c}
function acl(n){const l=n.toLowerCase();if(l.includes('el al'))return'elal';if(l.includes('arkia'))return'arkia';if(l.includes('israir'))return'israir';return'airhaifa'}
function fmtDate(d){const dt=new Date(d+'T00:00:00'),now=new Date();now.setHours(0,0,0,0);const diff=Math.round((dt-now)/864e5);const wd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];const mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()];const lbl=wd+', '+dt.getDate()+' '+mn;if(diff===0)return'Today \u2014 '+lbl;if(diff===1)return'Tomorrow \u2014 '+lbl;if(diff<0)return lbl;return'In '+diff+'d \u2014 '+lbl}
function ago(s){if(!s)return'';const m=Math.floor((Date.now()-new Date(s).getTime())/6e4);if(m<1)return'just now';if(m<60)return m+'m ago';const h=Math.floor(m/60);if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago'}
function fmtNum(n){return n.toLocaleString('en-US',{maximumFractionDigits:0})}
function curSym(c){return c==='ILS'?'\\u20AA':c==='EUR'?'\\u20AC':'$'}

function renderCard(o){
  const ac=acl(o.airline), gone=o.status==='gone', seatsOnly=o.total_price===0;
  const sn=o.seats_available;
  let h='<div class="card'+(gone?' gone':'')+'">';
  h+='<div class="card-stripe '+ac+'"></div>';

  // Header
  h+='<div class="card-head"><span class="airline-chip '+ac+'">'+o.airline+'</span><span class="status-badge '+o.status+'">'+(gone?'Sold Out':'Available')+'</span></div>';

  // Route
  h+='<div class="route">';
  h+='<div class="route-point"><span class="route-iata">'+o.origin+'</span><span class="route-city">'+city(o.origin)+'</span>'+(o.departure_time?'<span class="route-time">'+o.departure_time+'</span>':'')+'</div>';
  h+='<div class="route-connector"><div class="route-line-wrap"><span class="route-dot dep"></span><span class="route-dash"></span><span class="route-plane"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0011.5 2 1.5 1.5 0 0010 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg></span><span class="route-dash"></span><span class="route-dot arr"></span></div><span class="route-fn">'+o.flight_number+'</span></div>';
  h+='<div class="route-point end"><span class="route-iata">'+o.destination+'</span><span class="route-city">'+city(o.destination)+'</span>'+(o.arrival_time?'<span class="route-time">'+o.arrival_time+'</span>':'')+'</div>';
  h+='</div>';

  // Price area
  h+='<div class="price-area">';
  if(seatsOnly){
    // El Al seats-only
    h+='<div class="seats-hero">';
    h+='<div class="seats-circle"><span class="seats-circle-num">'+(sn!==null?sn:'?')+'</span></div>';
    h+='<div class="seats-info"><span class="seats-info-label">Seats Available</span><span class="seats-info-sub">Check elal.com for pricing</span></div>';
    h+='</div>';
  }else{
    // Priced flight
    h+='<div class="price-main"><span class="price-currency">'+curSym(o.currency)+'</span><span class="price-amount">'+fmtNum(o.total_price)+'</span></div>';
    const isRT=o.conditions&&o.conditions.includes('Round-trip');
    h+='<div class="price-meta"><span class="price-label">'+(isRT?'Round-trip':'One-way')+' \u00b7 2A+1C</span><span class="price-breakdown">'+curSym(o.currency)+fmtNum(o.price_per_adult)+'/adult \u00b7 '+curSym(o.currency)+fmtNum(o.price_per_child)+'/child</span></div>';
    if(sn!==null){
      const urgency=sn<=3?'urgent':sn<=10?'warning':'ok';
      const icon=sn<=3?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>':'';
      h+='<div class="price-right"><span class="seats-pill '+urgency+'">'+icon+sn+' seat'+(sn!==1?'s':'')+' left</span></div>';
    }
  }
  h+='</div>';

  // Footer
  h+='<div class="card-foot">';
  h+='<span class="card-meta">'+(gone?'Disappeared '+ago(o.gone_at):'Seen '+ago(o.last_seen))+(o.conditions?' \u00b7 '+o.conditions:'')+'</span>';
  if(!gone && o.booking_url){
    h+='<a class="book-btn" href="'+o.booking_url+'" target="_blank" rel="noopener">Book Now <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg></a>';
  }
  h+='</div>';

  h+='</div>';
  return h;
}

function renderDateGroup(date,items){
  const av=items.filter(o=>o.status==='available').length;
  let h='<div class="date-section"><div class="date-label"><h3>'+fmtDate(date)+'</h3>'+(av?'<span class="badge">'+av+' available</span>':'')+'</div><div class="grid">';
  for(const o of items) h+=renderCard(o);
  h+='</div></div>';
  return h;
}

function render(list){
  const el=document.getElementById('main');
  if(!list.length){
    el.innerHTML='<div class="empty-state"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></div><h3>No flights match your filters</h3><p>Try widening your search or check back soon. We scan every 5 minutes.</p></div>';
    return;
  }

  const avail=list.filter(o=>o.status==='available');
  const gone=list.filter(o=>o.status==='gone');
  let h='';

  // AVAILABLE NOW
  if(statusFilter!=='gone'){
    h+='<div class="section-header"><div class="section-icon green"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg></div><h2>Available Now</h2><span class="count green">'+avail.length+'</span></div>';
    if(avail.length===0){
      h+='<div class="empty-state" style="padding:48px 20px"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></div><h3>No available flights right now</h3><p>We check every 5 minutes. New flights will appear here automatically.</p></div>';
    }else{
      const byDate={};avail.forEach(o=>{(byDate[o.departure_date]=byDate[o.departure_date]||[]).push(o)});
      for(const[date,items]of Object.entries(byDate)) h+=renderDateGroup(date,items);
    }
  }

  // PREVIOUSLY FOUND
  if(statusFilter!=='available' && gone.length>0){
    h+='<hr class="section-divider">';
    h+='<div class="section-header"><div class="section-icon gray"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><h2>History</h2><span class="count gray">'+gone.length+'</span></div>';
    const byDate={};gone.forEach(o=>{(byDate[o.departure_date]=byDate[o.departure_date]||[]).push(o)});
    for(const[date,items]of Object.entries(byDate)) h+=renderDateGroup(date,items);
  }

  el.innerHTML=h;
}

function applyFilters(){
  let f=offers;
  const a=document.getElementById('fAirline').value,d=document.getElementById('fDest').value;
  if(a)f=f.filter(o=>o.airline===a);
  if(d)f=f.filter(o=>o.destination===d);
  if(statusFilter)f=f.filter(o=>o.status===statusFilter);
  render(f);
}

document.getElementById('statusBtns').addEventListener('click',e=>{
  const b=e.target.closest('.seg-btn');if(!b)return;
  document.querySelectorAll('.seg-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');statusFilter=b.dataset.v;applyFilters();
});
document.getElementById('fAirline').addEventListener('change',applyFilters);
document.getElementById('fDest').addEventListener('change',applyFilters);

function fillSelect(id,opts){
  const s=document.getElementById(id),cur=s.value,has=new Set([...s.options].map(o=>o.value));
  opts.forEach(o=>{const v=typeof o==='string'?o:o.value,l=typeof o==='string'?o:o.label;if(!has.has(v)){const el=document.createElement('option');el.value=v;el.textContent=l;s.appendChild(el);has.add(v)}});
  s.value=cur;
}

async function load(){
  try{
    const[oR,sR]=await Promise.all([fetch('/api/offers'),fetch('/api/stats')]);
    offers=await oR.json();const st=await sR.json();
    document.getElementById('statFlights').textContent=st.available;
    document.getElementById('statDest').textContent=st.destinations.length;
    document.getElementById('statAirlines').textContent=st.airlines.length;
    document.getElementById('statGone').textContent=st.gone;
    document.getElementById('lastUpdate').textContent='Updated '+new Date().toLocaleTimeString();
    fillSelect('fAirline',st.airlines);
    fillSelect('fDest',st.destinations.map(d=>({value:d,label:d+' \\u2014 '+city(d)})));
    applyFilters();
  }catch(e){console.error(e)}
}
load();setInterval(load,30000);
</script>
</body>
</html>`;
}
