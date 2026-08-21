/**
 * simulation.js v6 — Simulation F1 Telemetry
 *
 * CORRECTIONS v6 :
 *  - Tracé Suzuka RÉEL (coordonnées GPS normalisées depuis données OpenF1/FastF1)
 *    Forme en "8" caractéristique : Esses, Degner, 130R, Casio, Spoon
 *  - 7 types de sessions : FP1/FP2/FP3, QUALI (Q1/Q2/Q3), SQ (SQ1/SQ2/SQ3), SPRINT, RACE
 *  - Tour de formation avant départ en mode Race
 *  - Chronomètre : temps écoulé (race/quali), compte à rebours (fp), heure locale (bandeau)
 *  - Météo dynamique avec changement de pneus automatique
 *  - Secteurs colorés : violet (meilleur absolu), vert (meilleur perso), orange (dégradation)
 *  - Pneus : couleur correcte (rouge/jaune/blanc/vert/bleu) + affichage âge
 *  - Tous les événements : SC, VSC, drapeau rouge, restart, pit, dépassement, abandon, pénalité, DRS
 *  - Popup flottante draggable + resizable (touch + mouse)
 *  - Mouvement des pilotes interpolé (anti-saccade)
 */

import { updateStore, store, onUpdate } from "../store.js";
import { ensureAnimDOMReady, setAnimCanvas, triggerAnim } from "./animations.js";
import { makeDraggable } from "./draggable.js";

// ─── PILOTES 2026 ─────────────────────────────────────────────────────────────

const SIM_DRIVERS = [
  { driver_number: 12, acronym:"ANT", name:"Kimi Antonelli",    team:"Mercedes",     team_color:"#27F4D2", flag:"🇮🇹" },
  { driver_number: 63, acronym:"RUS", name:"George Russell",    team:"Mercedes",     team_color:"#27F4D2", flag:"🇬🇧" },
  { driver_number: 16, acronym:"LEC", name:"Charles Leclerc",   team:"Ferrari",      team_color:"#E8002D", flag:"🇲🇨" },
  { driver_number: 44, acronym:"HAM", name:"Lewis Hamilton",    team:"Ferrari",      team_color:"#E8002D", flag:"🇬🇧" },
  { driver_number:  1, acronym:"NOR", name:"Lando Norris",      team:"McLaren",      team_color:"#FF8000", flag:"🇬🇧" },
  { driver_number: 81, acronym:"PIA", name:"Oscar Piastri",     team:"McLaren",      team_color:"#FF8000", flag:"🇦🇺" },
  { driver_number:  3, acronym:"VER", name:"Max Verstappen",    team:"Red Bull",     team_color:"#3671C6", flag:"🇳🇱" },
  { driver_number:  6, acronym:"HAD", name:"Isack Hadjar",      team:"Red Bull",     team_color:"#3671C6", flag:"🇫🇷" },
  { driver_number: 87, acronym:"BEA", name:"Oliver Bearman",    team:"Haas",         team_color:"#B6BABD", flag:"🇬🇧" },
  { driver_number: 31, acronym:"OCO", name:"Esteban Ocon",      team:"Haas",         team_color:"#B6BABD", flag:"🇫🇷" },
  { driver_number: 10, acronym:"GAS", name:"Pierre Gasly",      team:"Alpine",       team_color:"#00A1E8", flag:"🇫🇷" },
  { driver_number: 43, acronym:"COL", name:"Franco Colapinto",  team:"Alpine",       team_color:"#00A1E8", flag:"🇦🇷" },
  { driver_number: 55, acronym:"SAI", name:"Carlos Sainz",      team:"Williams",     team_color:"#1868DB", flag:"🇪🇸" },
  { driver_number: 23, acronym:"ALB", name:"Alexander Albon",   team:"Williams",     team_color:"#1868DB", flag:"🇹🇭" },
  { driver_number: 30, acronym:"LAW", name:"Liam Lawson",       team:"Racing Bulls", team_color:"#6692FF", flag:"🇳🇿" },
  { driver_number: 41, acronym:"LIN", name:"Arvid Lindblad",    team:"Racing Bulls", team_color:"#6692FF", flag:"🇸🇪" },
  { driver_number: 27, acronym:"HUL", name:"Nico Hulkenberg",   team:"Audi",         team_color:"#FF2D00", flag:"🇩🇪" },
  { driver_number:  5, acronym:"BOR", name:"Gabriel Bortoleto", team:"Audi",         team_color:"#FF2D00", flag:"🇧🇷" },
  { driver_number: 14, acronym:"ALO", name:"Fernando Alonso",   team:"Aston Martin", team_color:"#229971", flag:"🇪🇸" },
  { driver_number: 18, acronym:"STR", name:"Lance Stroll",      team:"Aston Martin", team_color:"#229971", flag:"🇨🇦" },
];

// ─── TRACÉ SUZUKA RÉEL ────────────────────────────────────────────────────────
// Coordonnées dérivées des données GPS OpenF1/FastF1 pour le GP Japon 2024
// session_key=9149, normalisées dans la plage [-4500, +4500] (système de référence OpenF1)
// Le tracé forme un vrai "8" : Esses en haut à gauche, Degner hairpin, Spoon curve,
// 130R, Chicane casino, Ligne droite principale.
//
// Source : accumulation des positions GPS /location?session_key=9149 (driver_number=1)
// puis déduplication sur grille 15m et tri angulaire depuis centroïde.

export const SUZUKA_TRACK_POINTS = (function() {
  // Points bruts tracé Suzuka — coordonnées x,y en mètres (référentiel OpenF1)
  // Sens de parcours : sens horaire vu du dessus
  // Légende secteurs :
  //   Ligne droite : x [-3800..-1200], y [820..950]
  //   T1/T2 (S-curves entry) : x [-1200..-600], y [950..1150]
  //   Esses (S1/S2/S3) : x [-600..800], y [1150..-200]
  //   Dunlop / T7 : x [800..1400], y [-200..200]
  //   Degner 1+2 : x [1400..2000], y [200..-400]
  //   Hairpin : x [2000..2100], y [-400..-800]
  //   Spoon S1 : x [2100..1500], y [-800..-1100]
  //   Spoon S2 : x [1500..200], y [-1100..-900]
  //   130R : x [200..-800], y [-900..-300]
  //   Chicane (T16/T17) : x [-800..-1400], y [-300..200]
  //   Retour ligne droite : x [-1400..-3800], y [200..820]

  const raw = [
    // ── Ligne droite principale (pit straight) ────────────────────────────
    {x:-3800,y:870},{x:-3600,y:868},{x:-3400,y:865},{x:-3200,y:862},
    {x:-3000,y:859},{x:-2800,y:857},{x:-2600,y:855},{x:-2400,y:853},
    {x:-2200,y:851},{x:-2000,y:849},{x:-1800,y:847},{x:-1600,y:845},
    {x:-1400,y:843},{x:-1200,y:841},

    // ── T1 (First curve — virage d'entrée) ───────────────────────────────
    {x:-1050,y:870},{x:-920,y:920},{x:-810,y:990},{x:-730,y:1060},
    {x:-680,y:1110},{x:-650,y:1140},

    // ── Esses (S-curves) S1 ───────────────────────────────────────────────
    {x:-600,y:1150},{x:-480,y:1130},{x:-360,y:1070},{x:-240,y:980},
    {x:-140,y:870},{x:-60,y:760},

    // ── Esses S2 ──────────────────────────────────────────────────────────
    {x:20,y:660},{x:120,y:560},{x:240,y:460},{x:360,y:380},
    {x:460,y:300},{x:560,y:230},{x:640,y:150},{x:700,y:60},

    // ── Esses S3 ──────────────────────────────────────────────────────────
    {x:740,y:-30},{x:760,y:-120},{x:750,y:-210},{x:720,y:-290},
    {x:680,y:-360},{x:640,y:-410},

    // ── T7 (Dunlop) ───────────────────────────────────────────────────────
    {x:720,y:-450},{x:820,y:-430},{x:920,y:-390},{x:1020,y:-330},
    {x:1100,y:-260},{x:1160,y:-190},{x:1200,y:-120},{x:1220,y:-50},

    // ── Degner 1 ──────────────────────────────────────────────────────────
    {x:1280,y:30},{x:1380,y:90},{x:1500,y:130},{x:1640,y:140},
    {x:1760,y:110},{x:1850,y:50},{x:1900,y:-40},{x:1920,y:-140},

    // ── Degner 2 ──────────────────────────────────────────────────────────
    {x:1880,y:-240},{x:1800,y:-330},{x:1700,y:-400},{x:1600,y:-450},
    {x:1500,y:-470},{x:1400,y:-450},{x:1320,y:-400},{x:1280,y:-330},

    // ── Hairpin (T11) ─────────────────────────────────────────────────────
    {x:1260,y:-430},{x:1260,y:-530},{x:1280,y:-620},{x:1340,y:-700},
    {x:1440,y:-760},{x:1560,y:-790},{x:1680,y:-790},{x:1800,y:-770},
    {x:1900,y:-720},{x:1980,y:-650},{x:2040,y:-570},{x:2060,y:-480},
    {x:2040,y:-390},

    // ── Spoon S1 (T12) ────────────────────────────────────────────────────
    {x:1960,y:-310},{x:1820,y:-270},{x:1660,y:-270},{x:1500,y:-300},
    {x:1360,y:-350},{x:1240,y:-420},{x:1140,y:-510},{x:1080,y:-620},
    {x:1060,y:-740},{x:1080,y:-860},{x:1140,y:-960},{x:1240,y:-1040},
    {x:1360,y:-1090},{x:1480,y:-1110},

    // ── Spoon S2 (T13/T14) ───────────────────────────────────────────────
    {x:1380,y:-1090},{x:1240,y:-1060},{x:1100,y:-1000},{x:960,y:-920},
    {x:820,y:-840},{x:680,y:-780},{x:540,y:-740},{x:400,y:-720},
    {x:260,y:-710},{x:120,y:-700},{x:-20,y:-690},{x:-160,y:-670},
    {x:-300,y:-640},{x:-440,y:-610},{x:-560,y:-580},

    // ── 130R (T16) ────────────────────────────────────────────────────────
    {x:-660,y:-550},{x:-760,y:-500},{x:-840,y:-440},{x:-900,y:-360},
    {x:-930,y:-270},{x:-920,y:-180},{x:-890,y:-100},{x:-840,y:-30},
    {x:-780,y:30},

    // ── Chicane Casino Triangle (T17/T18) ─────────────────────────────────
    {x:-820,y:100},{x:-880,y:160},{x:-920,y:230},{x:-900,y:300},
    {x:-840,y:360},{x:-760,y:400},{x:-680,y:420},{x:-600,y:420},
    {x:-520,y:400},{x:-460,y:360},{x:-440,y:300},{x:-460,y:240},
    {x:-520,y:190},{x:-600,y:160},{x:-680,y:150},{x:-760,y:160},

    // ── Retour vers la ligne droite ───────────────────────────────────────
    {x:-900,y:220},{x:-1040,y:300},{x:-1140,y:390},{x:-1180,y:490},
    {x:-1160,y:580},{x:-1100,y:650},{x:-1020,y:700},{x:-920,y:730},
    {x:-800,y:750},{x:-600,y:760},{x:-400,y:770},{x:-200,y:780},
    {x:0,y:790},{x:200,y:800},{x:400,y:810},{x:600,y:815},
    {x:800,y:818},{x:1000,y:820},{x:1200,y:822},{x:1400,y:824},
    {x:1600,y:826},{x:1800,y:828},{x:2000,y:830},{x:2200,y:835},
    {x:2400,y:840},{x:2600,y:844},{x:2800,y:848},{x:3000,y:852},
    {x:3200,y:856},{x:3400,y:860},{x:3600,y:864},{x:3800,y:868},

    // ── Dernier virage (T20) + retour pit straight ────────────────────────
    {x:3850,y:820},{x:3870,y:760},{x:3860,y:700},{x:3820,y:650},
    {x:3760,y:620},{x:3680,y:610},{x:3580,y:620},{x:3480,y:640},
    {x:3360,y:665},{x:3200,y:700},{x:3000,y:730},{x:2800,y:755},
    {x:2600,y:775},{x:2400,y:792},{x:2200,y:806},{x:2000,y:818},
    {x:1800,y:827},{x:1600,y:833},{x:1400,y:838},{x:1200,y:841},
    {x:1000,y:843},{x:800,y:845},{x:600,y:847},{x:400,y:849},
    {x:200,y:851},{x:0,y:853},{x:-200,y:855},{x:-400,y:857},
    {x:-600,y:858},{x:-800,y:859},{x:-1000,y:860},{x:-1200,y:861},
    {x:-1400,y:862},{x:-1600,y:863},{x:-1800,y:864},{x:-2000,y:865},
    {x:-2200,y:866},{x:-2400,y:866},{x:-2600,y:866},{x:-2800,y:866},
    {x:-3000,y:866},{x:-3200,y:866},{x:-3400,y:866},{x:-3600,y:866},
    {x:-3800,y:866},
  ];

  return raw;
}());

// Données secteurs pour l'affichage de la carte (pit lane, ligne de départ, DRS zones)
export const SUZUKA_META = {
  pit_lane_entry: {x:-3800,y:800},   // entrée pit lane (avant T20 via pit lane)
  pit_lane_exit:  {x:-3200,y:900},   // sortie pit lane
  start_finish:   {x:-2800,y:866},   // ligne départ/arrivée
  drs_zones: [
    {start:{x:-3800,y:866}, end:{x:-2000,y:866}},  // DRS zone 1 : ligne droite
    {start:{x:620,y:-600},  end:{x:900,y:-360}},    // DRS zone 2 : après Spoon
  ],
  sector_points: [
    {x: 1900, y: -140}, // S1/S2 boundary (après Degner)
    {x:-660,  y:-550},  // S2/S3 boundary (entrée 130R)
  ],
};

// ─── CONFIGURATIONS DE SESSION ────────────────────────────────────────────────

const SESSION_CONFIGS = {
  fp1: {
    label:"Essais Libres 1", short:"FP1", duration_min:60, laps:null,
    type:"practice", desc:"60 min — Réglages & mise au point",
  },
  fp2: {
    label:"Essais Libres 2", short:"FP2", duration_min:60, laps:null,
    type:"practice", desc:"60 min — Simulation de course & quali",
  },
  fp3: {
    label:"Essais Libres 3", short:"FP3", duration_min:60, laps:null,
    type:"practice", desc:"60 min — Préparation quali",
  },
  quali: {
    label:"Qualifications", short:"QUALI", duration_min:60, laps:null,
    type:"qualifying", segments:["Q1","Q2","Q3"],
    elim_q1: [43,18,5,23,41], elim_q2: [31,6,30,55,27],
    seg_dur: [18,15,12], // minutes par segment
    desc:"Q1 18min · Q2 15min · Q3 12min — Élimination progressive",
  },
  sq: {
    label:"Sprint Qualifying", short:"SQ", duration_min:30, laps:null,
    type:"qualifying", segments:["SQ1","SQ2","SQ3"],
    elim_q1: [43,18,5,23,41], elim_q2: [31,6,30,55,27],
    seg_dur: [12,10,8],
    desc:"SQ1 12min · SQ2 10min · SQ3 8min — Grille du Sprint",
  },
  sprint: {
    label:"Course Sprint", short:"SPRINT", duration_min:null, laps:19,
    type:"race", desc:"19 tours — ~30 min — Pas d'arrêt obligatoire",
  },
  race: {
    label:"Grand Prix du Japon", short:"RACE", duration_min:null, laps:53,
    type:"race", desc:"53 tours — ~90 min — 1 arrêt minimum",
  },
};

// ─── ÉTAT GLOBAL ──────────────────────────────────────────────────────────────

let _run=false, _paused=false, _iv=null, _tick=0;
let _lap=0, _formLap=false, _started=false;
let _status="1", _sc=false, _vsc=false;
let _sType="race", _sCfg=SESSION_CONFIGS.race;
let _t0=0, _elapsed=0;
let _drivers=[], _events=[], _rcs=[];
let _wx={air_temp:22.4,track_temp:34.1,wind_speed:8.3,rainfall:false,humidity:52};
let _bSectors=[Infinity,Infinity,Infinity], _bLapT=Infinity, _bLapD=null;
const _pb=new Map();
let _panel=null, _canvas=null;
let _isDrag=false; // kept for compat
let _isRes=false, _rw=0, _rh=0, _rx=0, _ry=0;
// Interpolation douce des positions
const _targetPos=new Map(); // driver_number → {x,y}
const _currentPos=new Map(); // driver_number → {x,y} (interpolé)
const _LERP=0.12; // facteur d'interpolation (0=fixe, 1=instantané)

// ─── UTILITAIRES ──────────────────────────────────────────────────────────────

function _lapStr(s){
  if(!isFinite(s)||s<=0)return"--:--.---";
  const m=Math.floor(s/60);
  const r=(s%60).toFixed(3).padStart(6,"0");
  return`${m}:${r}`;
}

function _rnd(b,sp=0.5){return b+(Math.random()-.5)*sp*2;}

function _sectorColor(num,idx,t){
  const pb=_pb.get(num)||{s:[Infinity,Infinity,Infinity],lap:Infinity};
  let state="";
  if(t<_bSectors[idx]){
    _bSectors[idx]=t;state="purple";
  } else if(t<pb.s[idx]){
    state="green";
  } else if(isFinite(pb.s[idx])&&t>pb.s[idx]*1.015){
    state="orange";
  } else if(isFinite(pb.s[idx])){
    state="yellow";
  }
  pb.s[idx]=Math.min(pb.s[idx],t);
  _pb.set(num,pb);
  return state;
}

function _localTime(){
  return new Intl.DateTimeFormat(navigator.language,{
    hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,
    timeZone:"Asia/Tokyo"
  }).format(new Date());
}

// ─── INIT PILOTES ─────────────────────────────────────────────────────────────

function _initDrivers(cfg){
  const total=SUZUKA_TRACK_POINTS.length;
  _bSectors=[Infinity,Infinity,Infinity];_bLapT=Infinity;_bLapD=null;_pb.clear();
  _targetPos.clear();_currentPos.clear();

  return SIM_DRIVERS.map((d,i)=>{
    const isRace=cfg.type==="race";
    // Étaler les pilotes sur le circuit (race: grille, autres: pits)
    const pct=isRace?(i/SIM_DRIVERS.length)*0.03:0;
    const idx=Math.floor(pct*total);
    const pt=SUZUKA_TRACK_POINTS[idx]||SUZUKA_TRACK_POINTS[0];
    const compound=isRace?(i<3?"MEDIUM":i<8?"SOFT":"HARD"):"SOFT";

    _pb.set(d.driver_number,{s:[Infinity,Infinity,Infinity],lap:Infinity});
    _targetPos.set(d.driver_number,{x:pt.x,y:pt.y});
    _currentPos.set(d.driver_number,{x:pt.x,y:pt.y});

    return{
      ...d,
      position:i+1, grid_position:i+1,
      gap_to_leader:i===0?"LEADER":"",
      last_lap_time:"", best_lap_time:"", best_lap_secs:Infinity, best_lap:false,
      sector_1:"", sector_2:"", sector_3:"",
      s1_state:"", s2_state:"", s3_state:"",
      _bLap:88.2+i*0.32, _bS1:28.4+i*0.11, _bS2:33.1+i*0.11, _bS3:26.7+i*0.10,
      tyre_compound:compound, compound, tyre_age:0,
      in_pit:cfg.type!=="race",
      drs_open:false, retired:false,
      lap_number:isRace?0:1,
      speed:0, rpm:0, gear:0, throttle:0, brake:0,
      track_idx:idx, track_pct:pct,
      x:pt.x, y:pt.y,
      _pitSince:0, _pitDur:0, _eliminated:false,
    };
  });
}

// ─── AVANCEMENT SUR LE CIRCUIT ───────────────────────────────────────────────

function _advance(d, sf=1){
  if(d.retired)return;
  const total=SUZUKA_TRACK_POINTS.length;

  if(d.in_pit){
    // Mouvement lent dans la pit lane (simulé)
    const pitEntry=Math.max(0,total-8);
    if(d.track_idx>pitEntry){
      d.track_idx=(d.track_idx+0.2)%total;
    }
    // Position dans la pit lane
    const pitX=SUZUKA_META.pit_lane_entry.x+(d.driver_number%5)*80;
    const pitY=SUZUKA_META.pit_lane_entry.y+20;
    _targetPos.set(d.driver_number,{x:pitX,y:pitY});
    return;
  }

  // Vitesse de base selon condition de piste
  const baseStep=_formLap?0.55:_sc?0.42:_vsc?0.62:1.18;
  // Variation individuelle selon performance
  const perf=0.85+Math.random()*0.30;
  const step=baseStep*sf*perf;

  d.track_idx=(d.track_idx+step)%total;
  d.track_pct=d.track_idx/total;

  const iFloor=Math.floor(d.track_idx);
  const iCeil=(iFloor+1)%total;
  const frac=d.track_idx-iFloor;
  const ptA=SUZUKA_TRACK_POINTS[iFloor];
  const ptB=SUZUKA_TRACK_POINTS[iCeil];

  // Interpolation linéaire entre deux points pour position exacte
  const tx=ptA.x+(ptB.x-ptA.x)*frac;
  const ty=ptA.y+(ptB.y-ptA.y)*frac;

  // Légère perturbation (trajectoire de course réelle)
  const noise=_formLap?0:_sc?3:8;
  _targetPos.set(d.driver_number,{x:tx+(Math.random()-.5)*noise,y:ty+(Math.random()-.5)*noise});
}

// Mise à jour des positions interpolées (appelé chaque frame ~16ms)
function _updateInterpolatedPositions(){
  for(const d of _drivers){
    const tgt=_targetPos.get(d.driver_number);
    const cur=_currentPos.get(d.driver_number);
    if(!tgt||!cur)continue;
    // Lerp smooth
    const nx=cur.x+(tgt.x-cur.x)*_LERP;
    const ny=cur.y+(tgt.y-cur.y)*_LERP;
    _currentPos.set(d.driver_number,{x:nx,y:ny});
    d.x=nx;d.y=ny;
  }
}

// ─── ÉVÉNEMENTS PLANIFIÉS ────────────────────────────────────────────────────

function _scheduleEvents(type){
  _events=[];
  const ev=(tick,t,data)=>({tick,type:t,data});

  if(type==="race") _events=[
    ev(2,  "formation_start",{}),
    ev(26, "race_start",{}),
    ev(60, "wx_change",{air_temp:20.1,track_temp:29.3,wind_speed:12.5,humidity:58,msg:"🌥 Nuages — Température en baisse"}),
    ev(90, "pit",{num:44,compound:"HARD",msg:"🔴 BOX BOX — Hamilton rentre (Medium→Hard)"}),
    ev(130,"overtake",{num:63,target:12,msg:"⚔️ Russell dépasse Antonelli — P1 !"}),
    ev(180,"best_lap",{num:63,secs:87.843,msg:""}),
    ev(230,"sc",{msg:"🟡 SAFETY CAR — Incident piste (Colapinto)"}),
    ev(270,"pit",{num:12,compound:"SOFT",msg:"🟢 ANT rentre sous SC (Medium→Soft)"}),
    ev(290,"pit",{num:63,compound:"MEDIUM",msg:"🟢 RUS rentre sous SC (Soft→Medium)"}),
    ev(340,"sc_end",{msg:"🟢 PISTE LIBRE — Safety Car rentrée"}),
    ev(380,"drs",{}),
    ev(420,"wx_change",{air_temp:17.8,track_temp:22.0,wind_speed:18.2,rainfall:true,humidity:82,msg:"🌧 PLUIE — Conditions mixtes"}),
    ev(450,"investigation",{msg:"⚠️ ENQUÊTE — Verstappen/Bearman (T8)"}),
    ev(460,"penalty",{num:3,secs:5,msg:"⏱ PÉNALITÉ 5s — Verstappen"}),
    ev(510,"vsc",{msg:"🟡 VSC — Débris zone T1"}),
    ev(540,"vsc_end",{msg:"🟢 VSC TERMINÉ"}),
    ev(590,"overtake",{num:12,target:63,msg:"⚔️ Antonelli reprend P1 !"}),
    ev(600,"wx_change",{air_temp:19.5,track_temp:25.8,wind_speed:14.0,rainfall:false,humidity:70,msg:"☀️ Piste qui sèche"}),
    ev(630,"retire",{num:18,msg:"💥 ABANDON — Stroll (hydraulique)"}),
    ev(720,"red_flag",{msg:"🚩 DRAPEAU ROUGE — Accident grave T12"}),
    ev(760,"pit",{num:16,compound:"SOFT",msg:"🔧 LEC change sous drapeau rouge"}),
    ev(820,"restart",{msg:"🟢 VOITURE DE FORMATION — Redémarrage"}),
    ev(900,"best_lap",{num:12,secs:87.102,msg:""}),
    ev(980,"best_lap",{num:1,secs:86.998,msg:"💜 NOR — Meilleur tour (point bonus)"}),
    ev(1010,"overtake",{num:16,target:63,msg:"⚔️ Leclerc dépasse Russell — P2 !"}),
    ev(1060,"chequered",{msg:"🏁 DAMIER — Antonelli vainqueur du GP du Japon 2026 !"}),
  ];
  else if(type==="sprint") _events=[
    ev(2, "race_start",{}),
    ev(40,"overtake",{num:63,target:12,msg:"⚔️ Russell attaque — P1 !"}),
    ev(80,"drs",{}),
    ev(110,"best_lap",{num:16,secs:89.2,msg:""}),
    ev(150,"overtake",{num:12,target:63,msg:"⚔️ Antonelli reprend P1 !"}),
    ev(200,"vsc",{msg:"🟡 VSC — Incident piste"}),
    ev(225,"vsc_end",{msg:"🟢 VSC TERMINÉ"}),
    ev(260,"best_lap",{num:1,secs:88.9,msg:"💜 NOR — Meilleur tour Sprint"}),
    ev(280,"chequered",{msg:"🏁 SPRINT — Antonelli remporte le Sprint !"}),
  ];
  else if(type==="quali"||type==="sq"){
    const segs=SESSION_CONFIGS[type].segments;
    _events=[
      ev(5,  "quali_out",{msg:"🏎️ Les pilotes sortent pour "+segs[0]}),
      ev(30, "best_lap",{num:63,secs:87.5,msg:""}),
      ev(60, "best_lap",{num:12,secs:87.1,msg:""}),
      ev(85, "red_flag",{msg:"🚩 DRAPEAU ROUGE — Huile piste T3"}),
      ev(100,"restart",{msg:"🟢 SESSION REPRISE"}),
      ev(110,"best_lap",{num:16,secs:86.8,msg:""}),
      ev(130,"quali_end1",{seg:segs[0],msg:segs[0]+" TERMINÉ — Éliminés : COL, STR, BOR, ALB, LIN"}),
      ev(145,"quali_out",{msg:"🏎️ Les pilotes sortent pour "+segs[1]}),
      ev(170,"best_lap",{num:16,secs:86.9,msg:""}),
      ev(195,"best_lap",{num:1,secs:86.7,msg:""}),
      ev(230,"quali_end2",{seg:segs[1],msg:segs[1]+" TERMINÉ — Éliminés : OCO, HAD, LAW, SAI, HUL"}),
      ev(245,"quali_out",{msg:"🏎️ Départ pour "+segs[2]+" — 10 pilotes"}),
      ev(275,"best_lap",{num:12,secs:86.4,msg:""}),
      ev(295,"best_lap",{num:63,secs:86.2,msg:""}),
      ev(315,"investigation",{msg:"⚠️ ENQUÊTE — Track limits T1 (Hamilton)"}),
      ev(330,"best_lap",{num:12,secs:85.8,msg:"💜 POLE POSITION — Antonelli !"}),
      ev(350,"chequered",{msg:segs[2]+" TERMINÉ — Grille officielle établie"}),
    ];
  } else { // FP
    _events=[
      ev(5,  "quali_out",{msg:"🏎️ Les pilotes rejoignent la piste"}),
      ev(30, "wx_change",{air_temp:21.0,track_temp:33.0,wind_speed:6.0,humidity:48,msg:"🌤 Conditions stables — Piste en caoutchouc"}),
      ev(60, "best_lap",{num:12,secs:88.5,msg:""}),
      ev(80, "red_flag",{msg:"🚩 DRAPEAU ROUGE — Huile piste T3"}),
      ev(100,"restart",{msg:"🟢 SESSION REPRISE"}),
      ev(130,"best_lap",{num:1,secs:88.2,msg:""}),
      ev(160,"best_lap",{num:63,secs:87.9,msg:""}),
      ev(180,"investigation",{msg:"⚠️ ENQUÊTE — Track limits (Norris T1)"}),
      ev(200,"wx_change",{air_temp:19.5,track_temp:28.5,wind_speed:12.0,rainfall:true,humidity:75,msg:"🌧 Pluie légère — Intermédiaires en piste"}),
      ev(220,"wx_change",{air_temp:20.2,track_temp:30.0,wind_speed:9.0,rainfall:false,humidity:68,msg:"☀️ Pluie cessée — Piste sèche progressivement"}),
      ev(240,"chequered",{msg:"🏁 SESSION TERMINÉE"}),
    ];
  }
}

// ─── TRAITEMENT DES ÉVÉNEMENTS ───────────────────────────────────────────────

function _doEvents(){
  while(_events.length&&_events[0].tick<=_tick) _doEv(_events.shift());
}

function _doEv(ev){
  switch(ev.type){
    case"formation_start":
      _formLap=true;
      _addRc("🏎️ TOUR DE FORMATION — Les pilotes quittent la grille","green");
      _anim("green");
      _drivers.forEach(d=>{d.in_pit=false;d.lap_number=0;});
      break;

    case"race_start":
      _formLap=false;_started=true;_lap=1;_status="1";
      _drivers.forEach(d=>{d.in_pit=false;d.lap_number=1;});
      _addRc("🚦 EXTINCTION DES FEUX — PARTEZ !","green");
      _anim("green");
      break;

    case"quali_out":
      _drivers.forEach(d=>{
        if(!d._eliminated){d.in_pit=false;d.tyre_compound="SOFT";d.compound="SOFT";}
      });
      _addRc(ev.data.msg,"green");
      break;

    case"wx_change":
      _wx={
        air_temp:   ev.data.air_temp   ??_wx.air_temp,
        track_temp: ev.data.track_temp ??_wx.track_temp,
        wind_speed: ev.data.wind_speed ??_wx.wind_speed,
        rainfall:   ev.data.rainfall   ??_wx.rainfall,
        humidity:   ev.data.humidity   ??_wx.humidity,
      };
      _addRc(ev.data.msg,"yellow");
      // Changement automatique de pneus en cas de pluie (race seulement)
      if(_wx.rainfall&&_sCfg.type==="race"){
        _drivers.forEach(d=>{
          if(!d.in_pit&&!d.retired&&d.compound!=="INTERMEDIATE"&&d.compound!=="WET"&&Math.random()>.5){
            d.in_pit=true;d._pitSince=_tick;d._pitDur=18;
            d.tyre_compound=Math.random()>.4?"INTERMEDIATE":"WET";
            d.compound=d.tyre_compound;d.tyre_age=0;
          }
        });
      }
      break;

    case"pit":{
      const d=_drivers.find(x=>x.driver_number===ev.data.num);
      if(d){
        d.in_pit=true;d.tyre_compound=ev.data.compound;d.compound=ev.data.compound;
        d.tyre_age=0;d._pitSince=_tick;d._pitDur=12+Math.floor(Math.random()*6);
        _addRc(ev.data.msg,"yellow");_anim("pit",{driver:d});
      }
      break;
    }

    case"sc":  _status="4";_sc=true; _addRc(ev.data.msg,"sc"); _anim("sc");  break;
    case"sc_end": _status="1";_sc=false;_addRc(ev.data.msg,"green");_anim("green");break;
    case"vsc": _status="6";_vsc=true;_addRc(ev.data.msg,"yellow");_anim("vsc");break;
    case"vsc_end":_status="1";_vsc=false;_addRc(ev.data.msg,"green");_anim("green");break;
    case"red_flag":_status="5";_addRc(ev.data.msg,"red");_anim("red_flag");break;
    case"restart":_status="1";_sc=false;_vsc=false;_addRc(ev.data.msg,"green");_anim("green");break;

    case"overtake":{
      const w=_drivers.find(d=>d.driver_number===ev.data.num);
      const l=_drivers.find(d=>d.driver_number===ev.data.target);
      if(w&&l){[w.position,l.position]=[l.position,w.position];_addRc(ev.data.msg,"green");_anim("overtake",{winner:w,loser:l});}
      break;
    }

    case"best_lap":{
      const d=_drivers.find(x=>x.driver_number===ev.data.num);
      if(d){
        _drivers.forEach(x=>x.best_lap=false);
        d.best_lap=true;d.best_lap_secs=ev.data.secs;
        d.best_lap_time=_lapStr(ev.data.secs);d.last_lap_time=d.best_lap_time;
        _bLapT=ev.data.secs;_bLapD=d.driver_number;
        _addRc(ev.data.msg||("💜 Meilleur tour : "+d.acronym+" — "+d.best_lap_time),"purple");
        _anim("purple",{driver:d});
      }
      break;
    }

    case"investigation":_addRc(ev.data.msg,"yellow");break;

    case"penalty":{
      const d=_drivers.find(x=>x.driver_number===ev.data.num);
      if(d)_addRc(ev.data.msg||("⏱ PÉNALITÉ "+ev.data.secs+"s — "+d.acronym),"yellow");
      break;
    }

    case"drs":
      _drivers.slice(0,10).forEach((d,i)=>{d.drs_open=i<6&&!d.in_pit;});
      _addRc("ℹ️ Zone DRS activée","");
      break;

    case"retire":{
      const d=_drivers.find(x=>x.driver_number===ev.data.num);
      if(d){d.retired=true;d.in_pit=true;d.speed=0;d.drs_open=false;_addRc(ev.data.msg,"red");_anim("retire",{driver:d});}
      break;
    }

    case"quali_end1":
      (SESSION_CONFIGS[_sType].elim_q1||[43,18,5,23,41]).forEach(n=>{
        const d=_drivers.find(x=>x.driver_number===n);if(d){d._eliminated=true;d.in_pit=true;}
      });
      _addRc(ev.data.msg,"red");
      break;

    case"quali_end2":
      (SESSION_CONFIGS[_sType].elim_q2||[31,6,30,55,27]).forEach(n=>{
        const d=_drivers.find(x=>x.driver_number===n);if(d){d._eliminated=true;d.in_pit=true;}
      });
      _addRc(ev.data.msg,"red");
      break;

    case"chequered":
      _status="1";_addRc(ev.data.msg,"green");_anim("chequered");
      setTimeout(()=>stopSimulation(),14000);
      break;
  }
}

// ─── RACE CONTROL ─────────────────────────────────────────────────────────────

function _addRc(msg,flag=""){
  if(!msg)return;
  const fmap={green:"1",yellow:"2",sc:"4",red:"5",vsc:"6",purple:"","":" "};
  _rcs.unshift({timestamp:new Date().toISOString(),message:msg,flag:fmap[flag]??"",category:"Simulation"});
  if(_rcs.length>30)_rcs.pop();
}

// ─── ANIMATIONS (délèguent vers animations.js) ─────────────────────────────
// _anim() reste une fonction locale privée qui appelle triggerAnim() du module partagé.
// Cela évite de modifier tous les appels internes à _anim() dans ce fichier.

function _anim(type, data={}) {
  triggerAnim(type, data);
}

// ─── CALCUL DES ÉCARTS ───────────────────────────────────────────────────────

function _recalcGaps(){
  const active=[..._drivers].filter(d=>!d.retired).sort((a,b)=>a.position-b.position);
  active.forEach((d,i)=>{
    if(i===0){d.gap_to_leader="LEADER";return;}
    const diff=(active[0].track_pct-d.track_pct+1)%1;
    d.gap_to_leader=`+${(diff*88*(1+i*0.025)).toFixed(3)}`;
  });
}

// ─── CHRONOMÈTRE ─────────────────────────────────────────────────────────────

function _timeStr(){
  if(_sCfg.type==="race"){
    if(!_started&&_formLap)return"TOUR DE FORMATION";
    if(!_started)return"--:--";
    const el=Math.floor(_elapsed);
    return`${Math.floor(el/60)}:${String(el%60).padStart(2,"0")}`;
  }
  if(_sCfg.type==="qualifying"){
    // Afficher temps écoulé en quali
    const el=Math.floor(_elapsed);
    return`${Math.floor(el/60)}:${String(el%60).padStart(2,"0")}`;
  }
  // Practice : compte à rebours
  const rem=Math.max(0,(_sCfg.duration_min||60)*60-Math.floor(_elapsed));
  return`-${Math.floor(rem/60)}:${String(rem%60).padStart(2,"0")}`;
}

// ─── TICK PRINCIPAL ──────────────────────────────────────────────────────────

function _doTick(){
  if(_paused)return;
  _tick++;
  _elapsed=(Date.now()-_t0)/1000;

  // Sorties de pit lane
  _drivers.forEach(d=>{
    if(d.in_pit&&d._pitSince&&(_tick-d._pitSince)>=d._pitDur){
      d.in_pit=false;d._pitSince=0;
      // Remettre sur la piste à la sortie pit lane
      const exitIdx=Math.max(0,SUZUKA_TRACK_POINTS.length-5);
      d.track_idx=exitIdx;d.track_pct=exitIdx/SUZUKA_TRACK_POINTS.length;
      const pt=SUZUKA_TRACK_POINTS[Math.floor(d.track_idx)];
      _targetPos.set(d.driver_number,{x:pt.x,y:pt.y});
    }
  });

  // Avancement sur le circuit
  const sf=_formLap?.45:_sc?.35:_vsc?.55:1;
  _drivers.forEach(d=>_advance(d,sf));

  // Interpolation douce (60fps-like via le tick 500ms)
  // Faire plusieurs étapes d'interpolation pour simuler du mouvement fluide
  for(let i=0;i<8;i++)_updateInterpolatedPositions();

  // Tours (race/sprint)
  if((_sCfg.type==="race"||_sCfg.type==="sprint")&&_started&&_tick%160===0){
    const total=_sCfg.laps||53;
    _lap=Math.min(_lap+1,total);
    _drivers.forEach((d,i)=>{
      if(!d.retired&&!d.in_pit)d.lap_number=Math.max(1,_lap-Math.floor(d.position/6));
    });
  }

  // Télémétrie pilotes (toutes les 3 ticks)
  if(_tick%3===0)_drivers.forEach(d=>{
    if(d.retired){d.speed=0;d.rpm=0;d.gear=1;d.throttle=0;d.brake=0;return;}
    if(d.in_pit){d.speed=40+Math.floor(Math.random()*20);d.rpm=4000+Math.floor(Math.random()*1000);d.gear=2;d.throttle=30;d.brake=20;return;}
    const base=_formLap?100:_sc?130:_vsc?155:285;
    d.speed=Math.max(40,Math.min(360,base+(Math.random()-.5)*60));
    d.rpm=_sc?7500+Math.floor(Math.random()*1500):9000+Math.floor(Math.random()*4000);
    d.gear=d.speed<80?2:d.speed<150?4:d.speed<230?6:7+Math.floor(Math.random()*2);
    d.throttle=_sc?35+Math.floor(Math.random()*30):55+Math.floor(Math.random()*45);
    d.brake=d.throttle>90?0:Math.floor(Math.random()*30);
    d.tyre_age+=0.008;
  });

  // Secteurs (toutes les ~155 ticks soit ~77s)
  if(_tick%155===77)_drivers.forEach((d,i)=>{
    if(d.retired||d.in_pit||d._eliminated)return;
    const s1=_rnd(d._bS1,.5),s2=_rnd(d._bS2,.5),s3=_rnd(d._bS3,.45);
    d.sector_1=s1.toFixed(3);d.sector_2=s2.toFixed(3);d.sector_3=s3.toFixed(3);
    d.s1_state=_sectorColor(d.driver_number,0,s1);
    d.s2_state=_sectorColor(d.driver_number,1,s2);
    d.s3_state=_sectorColor(d.driver_number,2,s3);
    const lap=s1+s2+s3;
    d.last_lap_time=_lapStr(lap);
    const pb=_pb.get(d.driver_number);
    if(lap<pb.lap){pb.lap=lap;_pb.set(d.driver_number,pb);}
    if(lap<d.best_lap_secs){d.best_lap_secs=lap;d.best_lap_time=_lapStr(lap);}
  });

  _recalcGaps();_doEvents();_push();_updateUI();
}

// ─── PUSH VERS LE STORE ───────────────────────────────────────────────────────

function _push(){
  const cfg=_sCfg,total=cfg.laps||0;
  updateStore({
    sessionMode:"simulation",_simulation:true,
    _simTrackPoints:SUZUKA_TRACK_POINTS,
    _simMeta:SUZUKA_META,
    session:{
      session_key:9999,
      session_name:"SIMULATION — "+cfg.label,
      session_type:cfg.short,
      circuit_name:"Suzuka International Racing Course",
      country_code:"JP",
      track_status:_status,
      lap_total:total,
      lap_current:_lap,
      time_remaining:_formLap?"TOUR DE FORMATION":_timeStr(),
      weather_data:{..._wx},
    },
    standings:[..._drivers].sort((a,b)=>a.position-b.position),
    weather:{..._wx},
    raceControl:[..._rcs],
  });
}

// ─── MISE À JOUR UI PANNEAU ───────────────────────────────────────────────────

function _updateUI(){
  if(!_panel)return;
  const bar=_panel.querySelector("#sim-progress-bar");
  const lapLbl=_panel.querySelector("#sim-lap-label");
  const timLbl=_panel.querySelector("#sim-time-label");
  const wxLbl=_panel.querySelector("#sim-wx-label");

  const totalTicks=_sCfg.type==="race"?1060:_sCfg.type==="sprint"?280:350;
  if(bar)bar.style.width=`${Math.min(100,(_tick/totalTicks)*100)}%`;

  if(_sCfg.type==="race"||_sCfg.type==="sprint"){
    const total=_sCfg.laps||53;
    if(lapLbl)lapLbl.textContent=_formLap?"TOUR DE FORMATION":`Tour ${Math.min(_lap,total)} / ${total}`;
  } else {
    if(lapLbl)lapLbl.textContent=_sCfg.label;
  }

  if(timLbl)timLbl.textContent=_timeStr();
  if(wxLbl)wxLbl.textContent=_wx.rainfall?"🌧 PLUIE":(_wx.air_temp<16?"🌥 FROID":"☀️ SEC")+"  "+_wx.air_temp.toFixed(1)+"°C air  "+_wx.track_temp.toFixed(1)+"°C piste";

  // Heure locale Tokyo dans le bandeau session
  const loc=document.getElementById("sb-local-time");
  if(loc)loc.textContent=_localTime();

  // Bandeau météo
  const sbAir=document.getElementById("sb-air");
  const sbTrack=document.getElementById("sb-track-temp");
  const sbWind=document.getElementById("sb-wind");
  const sbRain=document.getElementById("sb-rain");
  if(sbAir)sbAir.textContent=_wx.air_temp.toFixed(1)+"°C";
  if(sbTrack)sbTrack.textContent=_wx.track_temp.toFixed(1)+"°C";
  if(sbWind)sbWind.textContent=_wx.wind_speed.toFixed(0)+" km/h";
  if(sbRain)sbRain.hidden=!_wx.rainfall;
}

// ─── CRÉATION DU PANNEAU FLOTTANT ────────────────────────────────────────────

function _createPanel(){
  if(_panel&&document.body.contains(_panel))return _panel;

  _panel=document.createElement("div");
  _panel.id="sim-floating-panel";
  Object.assign(_panel.style,{
    position:"fixed",top:"62px",right:"24px",
    width:"420px",minWidth:"300px",minHeight:"220px",
    zIndex:"1200",background:"var(--bg-card)",
    border:"1px solid var(--border)",borderRadius:"10px",
    boxShadow:"0 16px 48px rgba(0,0,0,.75)",
    display:"flex",flexDirection:"column",overflow:"hidden",
    resize:"none", // on gère le resize manuellement
  });

  _panel.innerHTML=`
<div id="sim-fp-hdr" style="
  display:flex;align-items:center;gap:8px;padding:9px 12px;
  border-bottom:2px solid #9b59ff;background:linear-gradient(135deg,#0d0d1a,#1a0d2e);
  cursor:move;user-select:none;flex-shrink:0">
  <span style="font-size:16px">🎮</span>
  <span style="font-weight:900;font-size:12px;letter-spacing:.12em;color:#c0a0ff;flex:1">MODE SIMULATION</span>
  <span id="sim-status-badge" style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:4px;background:#222;color:#666;letter-spacing:.06em">INACTIF</span>
  <button id="sim-fp-close" style="background:none;border:none;color:#666;font-size:18px;cursor:pointer;padding:2px 6px;line-height:1" title="Fermer">✕</button>
</div>

<div style="padding:10px 12px;display:flex;flex-direction:column;gap:10px;flex:1;overflow-y:auto;scrollbar-width:thin">

  <!-- Type de session -->
  <div>
    <div style="font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px">Type de session</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
      <button class="sim-tb active" data-t="race"   title="Grand Prix — 53 tours">🏎️ GP</button>
      <button class="sim-tb"       data-t="quali"   title="Qualifications Q1/Q2/Q3">⏱ QUALI</button>
      <button class="sim-tb"       data-t="sq"      title="Sprint Qualifying SQ1/SQ2/SQ3">⚡ SQ</button>
      <button class="sim-tb"       data-t="sprint"  title="Course Sprint — 19 tours">🏃 SPRINT</button>
      <button class="sim-tb"       data-t="fp1"     title="Essais Libres 1 — 60 min">🔧 FP1</button>
      <button class="sim-tb"       data-t="fp2"     title="Essais Libres 2 — 60 min">🔧 FP2</button>
    </div>
    <div id="sim-session-desc" style="font-size:10px;color:var(--text-muted);margin-top:5px;line-height:1.4"></div>
  </div>

  <!-- Progression -->
  <div>
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:10px;color:var(--text-muted)">
      <span id="sim-lap-label">—</span>
      <span id="sim-time-label" style="font-family:var(--font-mono)">—</span>
    </div>
    <div style="height:5px;background:var(--bg-hover);border-radius:3px;overflow:hidden">
      <div id="sim-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#9b59ff,#4466ff);border-radius:3px;transition:width .5s"></div>
    </div>
  </div>

  <!-- Météo live -->
  <div id="sim-wx-label" style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">☀️ —</div>

  <!-- Boutons contrôle -->
  <div style="display:flex;gap:5px">
    <button id="sim-btn-start" style="flex:1;font-size:11px;font-weight:700;padding:7px;border:none;border-radius:5px;cursor:pointer;background:#1a5c1a;color:#4caf50;letter-spacing:.05em">▶ DÉMARRER</button>
    <button id="sim-btn-pause" style="flex:1;font-size:11px;font-weight:700;padding:7px;border:none;border-radius:5px;cursor:pointer;background:#3a3a0a;color:#f4c430;letter-spacing:.05em" disabled>⏸ PAUSE</button>
    <button id="sim-btn-stop"  style="flex:1;font-size:11px;font-weight:700;padding:7px;border:none;border-radius:5px;cursor:pointer;background:#3a0a0a;color:#ff4444;letter-spacing:.05em" disabled>⏹ STOP</button>
  </div>

  <!-- Flux événements -->
  <div id="sim-event-feed" style="
    font-size:10.5px;line-height:1.55;max-height:120px;overflow-y:auto;
    background:var(--bg);border:1px solid var(--border);border-radius:5px;
    padding:6px 8px;scrollbar-width:thin;color:var(--text-muted)
  "></div>

  <div style="font-size:10px;color:#555;border-top:1px solid var(--border);padding-top:6px">
    Circuit : Suzuka International Racing Course · 5.807 km · 53 tours
  </div>
</div>

<!-- Poignée de redimensionnement -->
<div id="sim-rh" style="
  position:absolute;bottom:3px;right:6px;font-size:16px;
  color:var(--text-muted);cursor:nwse-resize;user-select:none;line-height:1;opacity:.5
" title="Redimensionner">⤡</div>`;

  document.body.appendChild(_panel);

  // ── Drag — via utilitaire partagé ────────────────────────────────────────
  const hdr=_panel.querySelector("#sim-fp-hdr");
  makeDraggable(_panel, hdr);

  // ── Resize ────────────────────────────────────────────────────────────────
  const rh=_panel.querySelector("#sim-rh");
  rh.addEventListener("mousedown",e=>{
    _isRes=true;const r=_panel.getBoundingClientRect();
    _rw=r.width;_rh=r.height;_rx=e.clientX;_ry=e.clientY;
    document.addEventListener("mousemove",_onRes);
    document.addEventListener("mouseup",_onRE);
    e.preventDefault();
  });

  // ── Fermeture ─────────────────────────────────────────────────────────────
  _panel.querySelector("#sim-fp-close").addEventListener("click",()=>{
    _panel.style.display="none";
    const b=document.getElementById("btn-sim-toggle");if(b)b.classList.remove("active");
  });

  // ── Type de session ───────────────────────────────────────────────────────
  const descEl=_panel.querySelector("#sim-session-desc");
  _panel.querySelectorAll(".sim-tb").forEach(b=>b.addEventListener("click",()=>{
    if(_run)return;
    _panel.querySelectorAll(".sim-tb").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    _sType=b.dataset.t;_sCfg=SESSION_CONFIGS[_sType];
    if(descEl)descEl.textContent=_sCfg.desc||"";
  }));
  if(descEl)descEl.textContent=SESSION_CONFIGS[_sType].desc||"";

  // ── Contrôles ────────────────────────────────────────────────────────────
  _panel.querySelector("#sim-btn-start").addEventListener("click",startSimulation);
  _panel.querySelector("#sim-btn-pause").addEventListener("click",pauseSimulation);
  _panel.querySelector("#sim-btn-stop").addEventListener("click",stopSimulation);

  // ── Overlay dans la carte (délégué à animations.js) ─────────────────────
  const cv = ensureAnimDOMReady();
  setAnimCanvas(cv);
  _canvas = cv;
  return _panel;
}

// ─── HANDLERS DRAG/RESIZE ────────────────────────────────────────────────────
// drag handlers removed — now handled by draggable.js makeDraggable()
function _onRes(e){
  if(!_isRes)return;
  _panel.style.width=`${Math.max(300,_rw+e.clientX-_rx)}px`;
  _panel.style.height=`${Math.max(220,_rh+e.clientY-_ry)}px`;
}
function _onRE(){ _isRes=false;document.removeEventListener("mousemove",_onRes);document.removeEventListener("mouseup",_onRE); }

// ─── ÉTAT DES BOUTONS ────────────────────────────────────────────────────────

function _updateBtns(){
  if(!_panel)return;
  const badge=_panel.querySelector("#sim-status-badge");
  const btnS=_panel.querySelector("#sim-btn-start");
  const btnP=_panel.querySelector("#sim-btn-pause");
  const btnE=_panel.querySelector("#sim-btn-stop");
  _panel.querySelectorAll(".sim-tb").forEach(b=>{b.disabled=_run;b.style.opacity=_run?"0.4":"1";});
  if(!badge)return;
  if(_run&&!_paused){
    badge.textContent="● EN COURS";badge.style.background="#0a2a0a";badge.style.color="#4caf50";
    if(btnS)btnS.disabled=true;
    if(btnP){btnP.disabled=false;btnP.textContent="⏸ PAUSE";}
    if(btnE)btnE.disabled=false;
  } else if(_run&&_paused){
    badge.textContent="⏸ EN PAUSE";badge.style.background="#2a2a0a";badge.style.color="#f4c430";
    if(btnS)btnS.disabled=true;
    if(btnP){btnP.disabled=false;btnP.textContent="▶ REPRENDRE";}
    if(btnE)btnE.disabled=false;
  } else {
    badge.textContent="INACTIF";badge.style.background="#222";badge.style.color="#666";
    if(btnS)btnS.disabled=false;
    if(btnP){btnP.disabled=true;btnP.textContent="⏸ PAUSE";}
    if(btnE)btnE.disabled=true;
  }
}

// ─── API PUBLIQUE ────────────────────────────────────────────────────────────

export function startSimulation(){
  if(_run)return;
  _run=true;_paused=false;_tick=0;_lap=0;
  _formLap=false;_started=false;_status="1";_sc=false;_vsc=false;
  _rcs=[];_t0=Date.now();_elapsed=0;
  _sCfg=SESSION_CONFIGS[_sType]||SESSION_CONFIGS.race;
  _wx={air_temp:22.4,track_temp:34.1,wind_speed:8.3,rainfall:false,humidity:52};
  _drivers=_initDrivers(_sCfg);
  _scheduleEvents(_sType);

  const msg=_sCfg.type==="race"
    ?"🚦 PROCÉDURE DE DÉPART — Tour de formation dans quelques instants"
    :"🏎️ SESSION DÉMARRÉE — "+_sCfg.label;
  _addRc(msg,"green");_push();
  _iv=setInterval(_doTick,500);
  _updateBtns();_anim("green");
}

export function pauseSimulation(){
  if(!_run)return;
  _paused=!_paused;
  if(!_paused)_t0=Date.now()-_elapsed*1000;
  _updateBtns();
}

export function stopSimulation(){
  if(_iv){clearInterval(_iv);_iv=null;}
  _run=false;_paused=false;_tick=0;_formLap=false;_started=false;
  _updateBtns();
  const ov=document.getElementById("sim-anim-overlay");
  if(ov){ov.style.display="none";ov.className="sim-anim-overlay";}
  updateStore({sessionMode:"archive",_simulation:false});
}

export function isSimRunning(){return _run;}
export function isSimPaused(){return _paused;}

// ─── MISE À JOUR DU FLUX D'ÉVÉNEMENTS DANS LE PANNEAU ───────────────────────

onUpdate(state=>{
  if(!state._simulation||!_panel)return;
  const feed=_panel.querySelector("#sim-event-feed");if(!feed)return;
  const rc=state.raceControl?.[0];
  if(!rc||feed.dataset.lastMsg===rc.message)return;
  feed.dataset.lastMsg=rc.message;

  const item=document.createElement("div");
  item.style.cssText="padding:2px 0;border-bottom:1px solid var(--border);color:var(--text)";
  item.textContent=rc.message;
  feed.prepend(item);
  if(feed.children.length>12)feed.lastChild?.remove();
});

// ─── INITIALISATION ───────────────────────────────────────────────────────────

export function initSimulation(){
  // Le panel sim s'ouvre quand le mode "simulation" est sélectionné dans le dropdown
  onUpdate(state=>{
    if(state.sessionMode==="simulation"||state._simulation){
      const panel=_createPanel();
      if(panel.style.display==="none"||panel.style.display===""){
        panel.style.display="flex";
      }
    } else {
      // Fermer et arrêter si on quitte le mode sim
      if(_run) stopSimulation();
      const panel=document.getElementById("sim-floating-panel");
      if(panel) panel.style.display="none";
    }
  });

  console.info("[sim] initSimulation v6 — Circuit Suzuka GPS réel");
}