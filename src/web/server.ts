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
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#f8f9fb;--white:#fff;--border:#e5e7eb;--border2:#d1d5db;
  --text:#111827;--text2:#4b5563;--text3:#9ca3af;
  --blue:#2563eb;--blue-light:#eff6ff;--blue-dark:#1d4ed8;
  --green:#059669;--green-light:#ecfdf5;--green-tag:#d1fae5;
  --red:#dc2626;--red-light:#fef2f2;--red-tag:#fee2e2;
  --orange:#d97706;--orange-tag:#fef3c7;
  --purple:#7c3aed;--purple-light:#f5f3ff;
  --radius:12px;--radius-sm:8px;
}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased}

/* NAV */
.nav{background:var(--white);border-bottom:1px solid var(--border);padding:0 max(24px,calc((100vw - 1200px)/2));display:flex;align-items:center;height:64px;gap:24px;position:sticky;top:0;z-index:100}
.logo{font-size:20px;font-weight:800;letter-spacing:-0.5px;color:var(--blue);display:flex;align-items:center;gap:8px}
.logo svg{width:28px;height:28px}
.nav-right{margin-left:auto;display:flex;align-items:center;gap:16px}
.live-badge{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--green);background:var(--green-light);padding:4px 10px;border-radius:20px}
.live-badge::before{content:'';width:6px;height:6px;background:var(--green);border-radius:50%;animation:blink 2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.update-text{font-size:12px;color:var(--text3)}

/* HERO */
.hero{background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 50%,#7c3aed 100%);padding:48px max(24px,calc((100vw - 1200px)/2)) 56px;color:#fff;position:relative;overflow:hidden}
.hero::after{content:'';position:absolute;top:-40%;right:-5%;width:500px;height:500px;background:radial-gradient(circle,rgba(255,255,255,.08) 0%,transparent 70%);pointer-events:none}
.hero h1{font-size:32px;font-weight:800;letter-spacing:-0.5px;margin-bottom:6px}
.hero p{font-size:15px;opacity:.85;max-width:500px}
.hero-stats{display:flex;gap:32px;margin-top:28px}
.hero-stat{display:flex;flex-direction:column}
.hero-stat-val{font-size:36px;font-weight:800}
.hero-stat-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.7;margin-top:2px}

/* FILTERS */
.filters-bar{background:var(--white);border-bottom:1px solid var(--border);padding:12px max(24px,calc((100vw - 1200px)/2));display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.filter-pill{display:flex;align-items:center;gap:4px}
.filter-pill label{font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.filter-pill select{border:1px solid var(--border);background:var(--white);padding:6px 28px 6px 10px;border-radius:var(--radius-sm);font-size:13px;color:var(--text);font-family:inherit;cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%239CA3AF' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}
.filter-pill select:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.seg-btns{display:flex;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden}
.seg-btn{padding:6px 14px;font-size:12px;font-weight:600;color:var(--text2);background:var(--white);border:none;cursor:pointer;font-family:inherit;transition:all .15s}
.seg-btn:not(:last-child){border-right:1px solid var(--border)}
.seg-btn.active{background:var(--blue);color:#fff}
.seg-btn:hover:not(.active){background:var(--blue-light)}

/* CONTENT */
.main{padding:24px max(24px,calc((100vw - 1200px)/2)) 64px;max-width:100%}
.date-section{margin-bottom:32px}
.date-label{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.date-label h2{font-size:15px;font-weight:700;color:var(--text)}
.date-label .badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--blue-light);color:var(--blue)}

/* CARD */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}
.card{background:var(--white);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;transition:box-shadow .2s,border-color .2s}
.card:hover{box-shadow:0 4px 24px rgba(0,0,0,.06);border-color:var(--border2)}
.card.gone{opacity:.55}
.card-accent{height:4px}
.card-accent.available{background:var(--green)}
.card-accent.gone{background:var(--red)}
.card-accent.elal{background:linear-gradient(90deg,#1e3a5f,#2563eb)}
.card-accent.arkia{background:linear-gradient(90deg,#0369a1,#38bdf8)}
.card-accent.israir{background:linear-gradient(90deg,#7c3aed,#a78bfa)}

.card-body{padding:16px 18px 14px}
.card-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.airline-tag{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:4px}
.airline-tag.elal{background:#eff6ff;color:#1d4ed8}
.airline-tag.arkia{background:#f0f9ff;color:#0369a1}
.airline-tag.israir{background:#f5f3ff;color:#7c3aed}
.airline-tag.airhaifa{background:#ecfdf5;color:#059669}
.status-pill{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;padding:3px 8px;border-radius:20px}
.status-pill.available{background:var(--green-tag);color:var(--green)}
.status-pill.gone{background:var(--red-tag);color:var(--red)}

/* BOARDING PASS ROUTE */
.route-block{display:flex;align-items:center;gap:0;margin-bottom:16px}
.route-end{display:flex;flex-direction:column;min-width:80px}
.route-code{font-size:26px;font-weight:800;letter-spacing:1px;line-height:1}
.route-city{font-size:11px;color:var(--text3);margin-top:3px}
.route-mid{flex:1;display:flex;flex-direction:column;align-items:center;padding:0 12px;position:relative}
.route-line{width:100%;height:1px;background:var(--border2);position:relative}
.route-line::before{content:'';position:absolute;left:0;top:-3px;width:7px;height:7px;border-radius:50%;background:var(--border2)}
.route-line::after{content:'';position:absolute;right:0;top:-3px;width:7px;height:7px;border-radius:50%;border:2px solid var(--border2);background:var(--white)}
.route-flight{font-size:10px;color:var(--text3);margin-top:6px;font-weight:600;letter-spacing:.3px}
.route-time{font-size:11px;color:var(--text2);font-weight:600}

/* PRICE / SEATS */
.info-row{display:flex;justify-content:space-between;align-items:flex-end;padding-top:14px;border-top:1px dashed var(--border)}
.price-block .label{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.price-block .val{font-size:24px;font-weight:800;color:var(--text);line-height:1.1;margin-top:2px}
.price-block .val .cur{font-size:14px;font-weight:600;color:var(--text3)}
.price-block .detail{font-size:11px;color:var(--text3);margin-top:2px}
.price-block.seats-only .val{color:var(--blue);font-size:20px}

.seats-block{text-align:right}
.seats-num{font-size:20px;font-weight:800;line-height:1}
.seats-num.low{color:var(--red)}
.seats-num.mid{color:var(--orange)}
.seats-num.high{color:var(--green)}
.seats-label{font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;font-weight:600}

/* CARD FOOTER */
.card-footer{display:flex;justify-content:space-between;align-items:center;padding:10px 18px;background:var(--bg);border-top:1px solid var(--border)}
.card-footer .meta{font-size:11px;color:var(--text3)}
.book-link{font-size:12px;font-weight:700;color:var(--blue);text-decoration:none;display:flex;align-items:center;gap:4px}
.book-link:hover{text-decoration:underline}

/* EMPTY */
.empty{text-align:center;padding:80px 20px;color:var(--text3)}
.empty .icon{font-size:48px;margin-bottom:12px}
.empty p{font-size:15px}
.empty .sub{font-size:13px;margin-top:6px}

/* MOBILE */
@media(max-width:768px){
  .hero{padding:32px 20px 40px}
  .hero h1{font-size:24px}
  .hero-stats{gap:20px}
  .hero-stat-val{font-size:28px}
  .nav,.filters-bar,.main{padding-left:16px;padding-right:16px}
  .grid{grid-template-columns:1fr}
  .route-code{font-size:22px}
}
</style>
</head>
<body>

<nav class="nav">
  <div class="logo">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
    FlyTLV
  </div>
  <div class="nav-right">
    <div class="live-badge" id="liveBadge">LIVE</div>
    <span class="update-text" id="lastUpdate"></span>
  </div>
</nav>

<div class="hero">
  <h1>Last-Minute Flights from Israel</h1>
  <p>Real-time seat availability and pricing on Israeli carriers. Scraped directly from airline sites every 5 minutes.</p>
  <div class="hero-stats">
    <div class="hero-stat">
      <span class="hero-stat-val" id="statFlights">-</span>
      <span class="hero-stat-label">Flights Found</span>
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
    <button class="seg-btn" data-v="available">Available</button>
    <button class="seg-btn" data-v="gone">Sold Out</button>
  </div>
</div>

<div class="main" id="main">
  <div class="empty"><div class="icon">&#9992;</div><p>Loading flight data...</p><p class="sub">Data populates after the first scrape cycle</p></div>
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
function aclass(n){const l=n.toLowerCase();if(l.includes('el al'))return'elal';if(l.includes('arkia'))return'arkia';if(l.includes('israir'))return'israir';return'airhaifa'}
function fmtDate(d){const dt=new Date(d+'T00:00:00'),now=new Date();now.setHours(0,0,0,0);const diff=Math.round((dt-now)/864e5);const wd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];const mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()];const lbl=wd+', '+dt.getDate()+' '+mn;if(diff===0)return'Today \u2014 '+lbl;if(diff===1)return'Tomorrow \u2014 '+lbl;return'In '+diff+' days \u2014 '+lbl}
function ago(s){if(!s)return'';const m=Math.floor((Date.now()-new Date(s).getTime())/6e4);if(m<1)return'just now';if(m<60)return m+'m ago';const h=Math.floor(m/60);if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago'}

function render(list){
  const el=document.getElementById('main');
  if(!list.length){el.innerHTML='<div class="empty"><div class="icon">&#128269;</div><p>No flights match your filters</p><p class="sub">Try widening your search or check back soon</p></div>';return}
  const byDate={};list.forEach(o=>{(byDate[o.departure_date]=byDate[o.departure_date]||[]).push(o)});
  let h='';
  for(const[date,items]of Object.entries(byDate)){
    const av=items.filter(o=>o.status==='available').length;
    h+='<div class="date-section"><div class="date-label"><h2>'+fmtDate(date)+'</h2><span class="badge">'+av+' available</span></div><div class="grid">';
    for(const o of items){
      const ac=aclass(o.airline), gone=o.status==='gone', seatsOnly=o.total_price===0;
      const sn=o.seats_available, sc=sn===null?'':'seats-num '+(sn<=5?'low':sn<=20?'mid':'high');
      h+='<div class="card'+(gone?' gone':'')+'">';
      h+='<div class="card-accent '+ac+(gone?' gone':' available')+'"></div>';
      h+='<div class="card-body">';
      h+='<div class="card-top"><span class="airline-tag '+ac+'">'+o.airline+'</span><span class="status-pill '+o.status+'">'+(gone?'Sold Out':'Available')+'</span></div>';
      // route
      h+='<div class="route-block">';
      h+='<div class="route-end"><span class="route-code">'+o.origin+'</span><span class="route-city">'+city(o.origin)+'</span>'+(o.departure_time?'<span class="route-time">'+o.departure_time+'</span>':'')+'</div>';
      h+='<div class="route-mid"><div class="route-line"></div><span class="route-flight">'+o.flight_number+'</span></div>';
      h+='<div class="route-end" style="text-align:right"><span class="route-code">'+o.destination+'</span><span class="route-city">'+city(o.destination)+'</span>'+(o.arrival_time?'<span class="route-time">'+o.arrival_time+'</span>':'')+'</div>';
      h+='</div>';
      // info row
      h+='<div class="info-row">';
      if(seatsOnly){
        h+='<div class="price-block seats-only"><span class="label">Seat Availability</span><span class="val">'+((sn!==null)?sn+' seats':'Check site')+'</span><span class="detail">Price on elal.com</span></div>';
      }else{
        h+='<div class="price-block"><span class="label">Total (2A+1C)</span><span class="val"><span class="cur">'+o.currency+'</span> '+o.total_price.toFixed(0)+'</span><span class="detail">'+o.price_per_adult+'/adult \u00b7 '+o.price_per_child+'/child</span></div>';
      }
      if(!seatsOnly && sn!==null){
        h+='<div class="seats-block"><span class="'+sc+'">'+sn+'</span><span class="seats-label">Seats Left</span></div>';
      }
      h+='</div></div>';
      // footer
      h+='<div class="card-footer"><span class="meta">'+(gone?'Gone '+ago(o.gone_at):'Updated '+ago(o.last_seen))+(o.conditions?' \u00b7 '+o.conditions:'')+'</span>';
      if(o.booking_url&&!gone)h+='<a class="book-link" href="'+o.booking_url+'" target="_blank" rel="noopener">Book \u2197</a>';
      h+='</div></div>';
    }
    h+='</div></div>';
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
    fillSelect('fDest',st.destinations.map(d=>({value:d,label:d+' \u2014 '+city(d)})));
    applyFilters();
  }catch(e){console.error(e)}
}
load();setInterval(load,30000);
</script>
</body>
</html>`;
}
