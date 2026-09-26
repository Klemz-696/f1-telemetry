/**
 * home.js v4 — Page d'accueil F1 Hub 2026
 * Correction : alignement noms de classes CSS
 */
import { store, onUpdate } from "../store.js";

const TEAM_COLORS = {
  "Mercedes":"#27F4D2","Red Bull":"#3671C6","Ferrari":"#E8002D","McLaren":"#FF8000",
  "Aston Martin":"#229971","Alpine":"#00A1E8","Haas":"#DEE1E2","Williams":"#1868DB",
  "Racing Bulls":"#6692FF","RB":"#6692FF","Audi":"#FF2D00","Cadillac":"#AAAAAD",
};

function isoToFlag(c){if(!c||c.length!==2)return"";return[...c.toUpperCase()].map(x=>String.fromCodePoint(x.charCodeAt(0)+127397)).join("");}
function resolveTeamColor(n){if(!n)return"#888";if(TEAM_COLORS[n])return TEAM_COLORS[n];for(const[k,v]of Object.entries(TEAM_COLORS)){if(n.toLowerCase().includes(k.toLowerCase()))return v;}return"#888";}
function formatCd(t){const d=new Date(t).getTime()-Date.now();if(d<=0)return"EN COURS";const dy=Math.floor(d/86400000),h=Math.floor((d%86400000)/3600000),m=Math.floor((d%3600000)/60000),s=Math.floor((d%60000)/1000);if(dy>0)return`${dy}j ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m`;if(h>0)return`${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;return`${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;}
function fmtShort(iso){try{return new Date(iso).toLocaleDateString("fr-FR",{day:"numeric",month:"short"});}catch{return iso;}}
function fmtDT(iso){try{return new Date(iso).toLocaleString("fr-FR",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}catch{return iso;}}
function findNextGP(cal){const now=Date.now();return cal.find(r=>{if(r.cancelled)return false;const rs=(r.sessions||[]).find(s=>s.name==="Course"||s.type==="Race");const t=rs?new Date(rs.date).getTime():new Date(r.date_end).getTime();return t>now;})||null;}
function findLastGP(cal){const now=Date.now();const past=cal.filter(r=>!r.cancelled&&new Date(r.date_end).getTime()<now);return past.length?past[past.length-1]:null;}
function findNextSession(gp){if(!gp?.sessions)return null;const now=Date.now();return gp.sessions.find(s=>new Date(s.date).getTime()>now)||null;}

let _lastRaceCache=null;
async function fetchLastRace(){
  if(_lastRaceCache)return _lastRaceCache;
  try{
    const h = window.location.hostname;
    const p = window.location.port;
    const PROXY = (p === "8080" || p === "80" || p === "443" || p === "" || (h !== "localhost" && h !== "127.0.0.1"))
      ? `${window.location.origin}/proxy`
      : "http://localhost:3001";
    const res=await fetch(`${PROXY}/jolpica/ergast/f1/${new Date().getFullYear()}/last/results.json`);
    if(!res.ok)throw new Error(res.status);
    const data=await res.json();
    const race=data?.MRData?.RaceTable?.Races?.[0]||null;
    if(race)_lastRaceCache=race;
    return race;
  }catch(e){console.warn("[home] fetchLastRace:",e);return null;}
}

let _heroCdInterval=null;
function renderHero(gp){
  const el=document.getElementById("home-hero");
  if(!el)return;
  if(!gp){el.innerHTML=`<div class="home-hero-empty"><span class="home-hero-empty-icon">🏁</span><p>Saison 2026 terminée</p></div>`;return;}
  const flag=isoToFlag(gp.country_code);
  const nextSess=findNextSession(gp);
  const raceSess=(gp.sessions||[]).find(s=>s.name==="Course"||s.type==="Race");
  const now=Date.now();
  const sessHTML=(gp.sessions||[]).map(s=>{
    const past=new Date(s.date).getTime()<=now;
    const isNext=nextSess&&s.date===nextSess.date;
    const isRace=s.name==="Course"||s.type==="Race";
    return`<div class="home-sess-row${past?" past":""}${isNext?" next":""}${isRace?" race":""}">
      <span class="home-sess-name">${s.name||s.type}</span>
      <span class="home-sess-date">${fmtDT(s.date)}</span>
      ${isNext?`<span class="home-sess-cd" id="home-next-sess-cd">${formatCd(s.date)}</span>`:""}
    </div>`;
  }).join("");
  const cdTarget=nextSess||raceSess;
  el.innerHTML=`
    <div class="home-hero-header">
      <div class="home-hero-meta">
        <span class="home-hero-round">MANCHE ${gp.round} / 22</span>
        ${gp.sprint?`<span class="home-hero-sprint-badge">SPRINT</span>`:""}
      </div>
      <div class="home-hero-title"><span class="home-hero-flag">${flag}</span><h1 class="home-hero-gp-name">${gp.name}</h1></div>
      <div class="home-hero-circuit">${gp.circuit} · ${fmtShort(gp.date_start)} – ${fmtShort(gp.date_end)}</div>
    </div>
    <div class="home-hero-body">
      <div class="home-hero-countdown-block">
        <div class="home-hero-cd-label">${nextSess?`Prochaine — ${nextSess.name||nextSess.type}`:"Prochain GP"}</div>
        <div class="home-hero-cd" id="home-main-cd">${cdTarget?formatCd(cdTarget.date):"—"}</div>
        ${nextSess?`<div class="home-hero-cd-sub">${fmtDT(nextSess.date)}</div>`:""}
      </div>
      <div>
        <div class="home-hero-sessions-title">Programme du week-end</div>
        ${sessHTML}
      </div>
    </div>`;
  if(_heroCdInterval)clearInterval(_heroCdInterval);
  if(cdTarget){
    _heroCdInterval=setInterval(()=>{
      const c=document.getElementById("home-main-cd");if(c)c.textContent=formatCd(cdTarget.date);
      const n=document.getElementById("home-next-sess-cd");if(n&&nextSess)n.textContent=formatCd(nextSess.date);
    },1000);
  }
}

function renderQuickNav(){
  const grid=document.getElementById("home-nav-grid");
  if(!grid||grid.childElementCount>0)return;
  const tiles=[
    {hash:"#results",icon:"🏁",title:"Résultats",sub:"Saison 2026, course par course"},
    {hash:"#calendar",icon:"📅",title:"Calendrier",sub:"Sessions, horaires, circuits"},
    {hash:"#standings",icon:"🏆",title:"Classements",sub:"Pilotes & constructeurs"},
    {hash:"#telemetry",icon:"📡",title:"Live / Télémétrie",sub:"Dashboard temps réel",warn:"⚠ Mode direct en pause"},
  ];
  grid.innerHTML=tiles.map(t=>`
    <a href="${t.hash}" class="home-nav-tile" data-hash="${t.hash}">
      <span class="home-tile-icon">${t.icon}</span>
      <span class="home-tile-title">${t.title}</span>
      <span class="home-tile-sub">${t.sub}</span>
      ${t.warn?`<span class="home-tile-notice">${t.warn}</span>`:""}
    </a>`).join("");
  grid.querySelectorAll(".home-nav-tile").forEach(a=>{
    a.addEventListener("click",e=>{e.preventDefault();const hash=a.dataset.hash;history.pushState(null,"",hash);window.dispatchEvent(new PopStateEvent("popstate"));});
  });
}

async function renderLastRace(cal){
  const el=document.getElementById("home-last-race");if(!el)return;
  const lastGP=findLastGP(cal);
  if(!lastGP){el.innerHTML=`<div class="home-section-empty">Aucune course disputée pour l'instant.</div>`;return;}
  const flag=isoToFlag(lastGP.country_code);
  el.innerHTML=`
    <div class="home-last-race-title">
      <span class="home-last-race-flag">${flag}</span>
      <span>${lastGP.name}</span>
      <span class="home-last-race-date">${fmtShort(lastGP.date_end)}</span>
    </div>
    <div id="home-podium-area"><div class="home-section-empty" style="padding:12px 0">Chargement résultats…</div></div>`;
  let results=null;
  if(store.last_race?.results?.length){
    results=store.last_race.results.map(r=>({code:r.acronym||r.code,name:r.name,team:r.team,pts:r.points,fl:r.fastest_lap,fl_time:r.fastest_lap_time}));
  }else{
    const ergast=await fetchLastRace();
    if(ergast?.Results?.length){
      results=ergast.Results.map(r=>({code:r.Driver?.code,name:`${r.Driver?.givenName} ${r.Driver?.familyName}`,team:r.Constructor?.name,pts:r.points,fl:r.FastestLap?.rank==="1",fl_time:r.FastestLap?.Time?.time}));
    }
  }
  const podArea=document.getElementById("home-podium-area");if(!podArea)return;
  if(!results?.length){podArea.innerHTML=`<div class="home-section-empty" style="padding:12px 0">Résultats pas encore disponibles.</div>`;return;}
  const [p1,p2,p3]=[results[0],results[1],results[2]];
  const fl=results.find(r=>r.fl);
  function card(r,pos){
    if(!r)return`<div class="home-podium-card" style="border-top-color:#444"><span class="home-podium-pos">P${pos}</span><span class="home-podium-dnf">—</span></div>`;
    const tc=resolveTeamColor(r.team||"");
    return`<div class="home-podium-card" style="border-top-color:${tc}">
      <span class="home-podium-pos">P${pos}</span>
      <span class="home-podium-acro">${r.code||"?"}</span>
      <span class="home-podium-name">${r.name||"—"}</span>
      <span class="home-podium-team" style="color:${tc}">${r.team||"—"}</span>
      <span class="home-podium-pts">+${r.pts||"0"} pts</span>
    </div>`;
  }
  podArea.innerHTML=`
    <div class="home-podium-row">${card(p2,2)}${card(p1,1)}${card(p3,3)}</div>
    ${fl?`<div class="home-fl-row">⚡ Fastest Lap — <strong>${fl.code}</strong>${fl.fl_time?` <span class="home-fl-time">${fl.fl_time}</span>`:""}</div>`:""}`;
}

function renderMiniStandings(){
  const dEl=document.getElementById("home-mini-drivers");
  const tEl=document.getElementById("home-mini-teams");
  if(!dEl||!tEl)return;
  const ds=(store.drivers_standings||[]).slice(0,5);
  const ts=(store.teams_standings||[]).slice(0,5);
  dEl.innerHTML=ds.length?ds.map(d=>{
    const tc=resolveTeamColor(d.team);
    return`<div class="home-mini-row">
      <span class="home-mini-pos">${d.position}</span>
      <span class="home-mini-flag">${d.flag||isoToFlag(d.nationality_code)||""}</span>
      <span class="home-mini-name" style="border-left-color:${tc}">${d.acronym||d.name}</span>
      <span class="home-mini-pts">${d.points} pts</span>
    </div>`;
  }).join(""):`<div class="home-section-empty">Chargement…</div>`;
  tEl.innerHTML=ts.length?ts.map(t=>{
    const tc=resolveTeamColor(t.name);
    return`<div class="home-mini-row">
      <span class="home-mini-pos">${t.position}</span>
      <span class="home-mini-name" style="border-left-color:${tc}">${t.name}</span>
      <span class="home-mini-pts">${t.points} pts</span>
    </div>`;
  }).join(""):`<div class="home-section-empty">Chargement…</div>`;
  document.querySelectorAll(".home-see-all").forEach(a=>{
    a.addEventListener("click",e=>{e.preventDefault();const h=a.getAttribute("href");history.pushState(null,"",h);window.dispatchEvent(new PopStateEvent("popstate"));});
  });
}

let _rendered=false;
function _tryRender(){
  const cal=store.calendar||[];
  if(!cal.length)return;
  const nextGP=findNextGP(cal);
  renderHero(nextGP);
  if(!_rendered){renderQuickNav();_rendered=true;}
  renderLastRace(cal);
  renderMiniStandings();
}

export function initHome(){
  // viewchange : déclenché par activateView() à chaque navigation
  window.addEventListener("viewchange", e => {
    if (e.detail?.view === "home") _tryRender();
  });
  window.addEventListener("popstate",()=>{
    if((location.hash||"#home")==="#home") _tryRender();
  });
  onUpdate(state=>{
    const cal=state.calendar||[];if(!cal.length)return;
    const nextGP=findNextGP(cal);
    renderHero(nextGP);
    if(!_rendered){renderQuickNav();_rendered=true;}
    renderLastRace(cal);
    renderMiniStandings();
  });
  if((store.calendar||[]).length){_tryRender();_rendered=true;}
}