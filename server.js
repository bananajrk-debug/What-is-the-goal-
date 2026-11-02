// なにが目的なん？ ONLINE v6 — Express + Socket.io（サーバー権威型）
// 対戦（ルームロビー / CPU / フレンドIDでワンタップ参加）＋ ランクマッチ（チャリランク）＋ エンドレスラン ＋ ランキング ＋ チャット/エモート
// ログインID（端末アカウント・非公開）とフレンドID（F-XXXX-XXXX・公開用）は別物として扱う
'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

/* ===== 共通定数 ===== */
const BASE = 110, HW = 112.5, LIMIT = 25, TICK = 1 / 30;
const OBS = { car: { w: 19, l: 26 }, bus: { w: 23, l: 58 }, cone: { w: 7, l: 7 }, cop: { w: 19, l: 27 } };
const BIKE_W = 5, BIKE_L = 10;
const COP_DX = 28, COP_BACK = -36, COP_FRONT = 40, COP_BLOCK = 70;
// 日本は左側通行：左2車線＝自分と同じ向き、右2車線＝対向車。車は自分の向きの車線しか走らない（逆走しない）
const SAME = [-84, -28], ONC = [28, 84], LANES = [-84, -28, 28, 84];
const STEER_ACC = 1500;  // 横移動の加速度（指の動きになめらかに追従）
const DRIFT = 0.28;      // カーブで外側へ流される強さ
const EMOTES = ['wave', 'thumbs', 'laugh', 'wheelie', 'dance', 'clap', 'bow', 'angry', 'cry', 'heart', 'sleep', 'gg',
  'think', 'shock', 'cool', 'peace', 'flex', 'fire', 'party', 'crowne', 'rocket', 'hofe'];
const BOT_AFTER = 18;    // ランクマッチ：この秒数だけ相手が見つからなければランクCPUと対戦
const BOT_NAMES = ['チャリ太郎', 'ペダル姫', '坂道キング', 'ママチャリ番長', '立ちこぎ仮面', '風のミナト', 'ギア3速', 'サドル侍', '向かい風', 'ベル鳴らし'];
const CPU_LINES = ['よろしく！', '負けないよ', 'ナイス！', 'GG！', '手加減しないよ', 'まだまだ！', 'いいね！'];

/* ===== コースの形（クライアントと共通。[長さ, 曲がる角度(度)] の繰り返し） ===== */
const PATHS = [
  [[1400, 0], [900, 60], [1000, 0], [900, -60], [800, 0], [700, -40], [600, 0], [700, 40]],
  [[900, 0], [1000, 40], [500, 0], [1000, -70], [400, 0], [900, 50], [600, 0], [900, -20]],
  [[1200, 0], [1300, 90], [900, 0], [1300, -90], [700, 0]],
  [[700, 0], [500, -30], [300, 0], [500, 30], [900, 0], [600, 35], [300, 0], [600, -35]],
  [[600, 0], [650, 75], [200, 0], [650, -75], [300, 0], [500, -60], [150, 0], [500, 60], [400, 0], [700, 90], [250, 0], [700, -90]]
];
const PATH = PATHS.map(def => {
  let L = 0;
  const P = def.map(([len, deg]) => { const o = { s0: L, len, k: deg * Math.PI / 180 / len }; L += len; return o; });
  return { P, L };
});
function curv(ci, s) {
  const pa = PATH[ci] || PATH[0];
  let r = s % pa.L; if (r < 0) r += pa.L;
  for (const p of pa.P) if (r < p.s0 + p.len) return p.k;
  return 0;
}

const rooms = new Map();
const attOf = r => (r < 3 ? 0 : r < 6 ? 1 : r % 2);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = n => Math.round(n * 10) / 10;

/* ===== 入力値の検証（見た目データは性能に一切影響しない） ===== */
const clean = (v, def) => (typeof v === 'string' && /^[\w-]{1,24}$/.test(v)) ? v : def;
const cleanUid = v => (typeof v === 'string' && /^[\w-]{8,64}$/.test(v)) ? v : '';
const cleanFid = v => (typeof v === 'string' && /^F-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(v)) ? v : '';   // フレンドID
const isLoginId = v => typeof v === 'string' && /^NM-[\w-]{3,20}$/.test(v);
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').trim().slice(0, max) : '');
const cleanName = (v, def) => cleanText(v, 10) || def;
const cleanCourse = v => { v = parseInt(v, 10); return v >= 0 && v < PATHS.length ? v : 0; };
const look = (d, defName) => {
  d = (d && typeof d === 'object') ? d : {};
  return {
    name: cleanName(d.name, defName), skin: clean(d.skin, 'default'), hair: clean(d.hair, 'default'), fit: clean(d.fit, 'default'),
    acc: clean(d.acc, 'none'), trail: clean(d.trail, 'none'), lv: clamp(parseInt(d.lv, 10) || 1, 1, 99), pid: clean(d.id, ''),
    ttl: clean(d.ttl, 'rookie'), pl: clean(d.pl, 'normal'), rp: clamp(parseInt(d.rp, 10) || 0, 0, 99999), fid: cleanFid(d.fid)
  };
};

/* ===== ランキング（ranking.json に保存） ===== */
const RANK_FILE = process.env.RANK_FILE || path.join(__dirname, 'ranking.json');
let ranking = [];
try {
  const j = JSON.parse(fs.readFileSync(RANK_FILE, 'utf8'));
  if (Array.isArray(j)) ranking = j.filter(r => r && typeof r.id === 'string' && Number.isFinite(r.score)).slice(0, 100);
} catch (e) { /* 初回はファイルなし */ }
let saveTimer = null;
function saveRanking() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(RANK_FILE, JSON.stringify(ranking), err => { if (err) console.warn('ranking save failed:', err.message); });
  }, 1500);
}
function submitScore(id, name, score, lv) {
  if (!id) return { best: score, rank: 0, improved: false };
  const i = ranking.findIndex(r => r.id === id);
  let best = score, improved = false;
  if (i >= 0) {
    if (score > ranking[i].score) { ranking[i] = { id, name, score, lv, ts: Date.now() }; improved = true; }
    else { best = ranking[i].score; ranking[i].name = name; ranking[i].lv = lv; }
  } else { ranking.push({ id, name, score, lv, ts: Date.now() }); improved = true; }
  ranking.sort((a, b) => b.score - a.score);
  ranking = ranking.slice(0, 100);
  saveRanking();
  return { best, rank: ranking.findIndex(r => r.id === id) + 1, improved };
}
// 公開するランキングにはログインIDを含めない（自分の行だけ me:true を付ける）
const topN = (n, me) => ranking.slice(0, n).map(r => ({ name: r.name, score: r.score, lv: r.lv || 1, me: !!me && r.id === me }));
// チャリランク（RP）ランキング：ランクマッチ終了直後の1回だけ報告を受け付け、1試合で増やせる量にも上限をかける
const RP_FILE = process.env.RP_FILE || path.join(__dirname, 'ranking_rp.json');
let rpBoard = [];
try { const j = JSON.parse(fs.readFileSync(RP_FILE, 'utf8')); if (Array.isArray(j)) rpBoard = j.filter(r => r && typeof r.id === 'string' && Number.isFinite(r.rp)).slice(0, 100); } catch (e) { /* 初回 */ }
let rpTimer = null;
function saveRp() { if (rpTimer) return; rpTimer = setTimeout(() => { rpTimer = null; fs.writeFile(RP_FILE, JSON.stringify(rpBoard), () => {}); }, 1500); }
function submitRp(id, name, rp, lv, ttl) {
  const i = rpBoard.findIndex(r => r.id === id);
  if (i >= 0) { rp = Math.min(rp, rpBoard[i].rp + 60); rpBoard[i] = { id, name, rp, lv, ttl, ts: Date.now() }; }
  else rpBoard.push({ id, name, rp, lv, ttl, ts: Date.now() });
  rpBoard.sort((a, b) => b.rp - a.rp); rpBoard = rpBoard.slice(0, 100); saveRp();
  return rpBoard.findIndex(r => r.id === id) + 1;
}
const rpTop = (n, me) => rpBoard.slice(0, n).map(r => ({ name: r.name, rp: r.rp, lv: r.lv || 1, ttl: r.ttl || 'rookie', me: !!me && r.id === me }));
app.get('/api/ranking', (req, res) => res.json({ top: topN(50), rp: rpTop(50) }));
app.get('/api/sounds', (req, res) => {
  fs.readdir(path.join(__dirname, 'public', 'sounds'), (err, list) => {
    res.json({ files: err ? [] : list.filter(f => /^[\w-]+\.(mp3|m4a|ogg|wav)$/i.test(f)) });
  });
});

/* =====================================================================
   障害物（車線を守る交通AI：追い越し・減速・車間距離。すり抜けなし）
   ===================================================================== */
function addObs(R, k, x, z, v0, dir, c) {
  const s = OBS[k];
  const o = { id: R.nid++, k, x, z, d: dir, v0, vz: v0 * dir, c: c || 0, w: s.w, l: s.l, passed: false, cp: {}, tx: null, lock: 0 };
  R.obs.push(o);
  return o;
}
const clearAt = (R, x, z, w, l) => !R.obs.some(q => Math.abs(q.x - x) < q.w + w + 4 && Math.abs(q.z - z) < q.l + l + 40);
const hitObs = (o, p) => Math.abs(o.x - p.x) < o.w + BIKE_W && Math.abs(o.z - p.z) < o.l + BIKE_L;
const nearestLane = (x, lanes) => lanes.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a);
const laneIdx = x => LANES.indexOf(nearestLane(x, LANES));
function copRule(o, p, isAtt) {
  const dx = Math.abs(o.x - p.x), gap = p.z - o.z;
  if (dx < COP_DX && gap > COP_BACK && gap < COP_FRONT) return true;               // 接触・割り込み
  if (isAtt && p.brk > 0 && dx < 30 && gap > 0 && gap < COP_BLOCK) return true;   // 急ブレーキで通行妨害
  return false;
}
function laneOpen(R, o, lx, riders) {
  for (const q of R.obs) {
    if (q === o || Math.abs(q.x - lx) >= o.w + q.w + 2) continue;
    const d = (q.z - o.z) * o.d;
    if (d > -(o.l + q.l + 60) && d < o.l + q.l + 170) return false;
  }
  for (const p of riders) {     // 自転車のすぐ前に割り込まない（理不尽な接触を防ぐ）
    if (!p || Math.abs(p.x - lx) >= o.w + BIKE_W + 16) continue;
    const d = (p.z - o.z) * o.d;
    if (d > -(o.l + 40) && d < o.l + 240) return false;
  }
  return true;
}
function separate(R, riders) {
  const vs = R.obs;
  for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) {
    const o = vs[a], q = vs[b];
    if (Math.abs(o.x - q.x) >= o.w + q.w - 1) continue;
    const lim = o.l + q.l + 2;
    if (Math.abs(q.z - o.z) >= lim) continue;
    let front, back;
    if (o.k === 'cone') { front = o; back = q; }
    else if (q.k === 'cone') { front = q; back = o; }
    else if (o.d === q.d) { if ((q.z - o.z) * o.d > 0) { front = q; back = o; } else { front = o; back = q; } }
    else continue;
    if (back.k === 'cone') continue;
    back.z = front.z - back.d * lim;
    if (back.vz * back.d > front.vz * back.d) back.vz = front.vz;
  }
  // 同じ向きの車は自転車に後ろから突っ込まない（パトカーを除く）
  for (const o of vs) {
    if (o.k === 'cone' || o.k === 'cop' || o.d < 0) continue;
    for (const p of riders) {
      if (!p || Math.abs(o.x - p.x) >= o.w + BIKE_W) continue;
      const g = p.z - o.z;
      if (g > 0 && g < o.l + BIKE_L + 1) { o.z = p.z - (o.l + BIKE_L + 1); if (o.vz > p.v) o.vz = p.v; }
    }
  }
}
function traffic(R, dt, riders) {
  for (const o of R.obs) {
    if (o.k === 'cone') continue;
    const dir = o.d;
    let gap = 1e9, leadV = 0, found = false;
    const chk = (qx, qz, qw, ql, qv) => {
      if (Math.abs(qx - o.x) >= o.w + qw - 2) return;
      const d = (qz - o.z) * dir - (o.l + ql);
      if (d > -(o.l + ql) && d < gap) { gap = d; leadV = qv * dir; found = true; }
    };
    for (const q of R.obs) if (q !== o) chk(q.x, q.z, q.w, q.l, q.vz);
    if (dir > 0 && o.k !== 'cop') for (const p of riders) if (p) chk(p.x, p.z, BIKE_W, BIKE_L, p.v);
    let target = o.v0;
    if (found && gap < 260 && leadV < o.v0 - 3) {
      if (o.k !== 'bus' && !o.lock && o.tx == null) {           // 遅い車がいたら隣の車線へ追い越し
        const lanes = dir > 0 ? SAME : ONC, cur = nearestLane(o.x, lanes);
        const alt = lanes.find(l => l !== cur && laneOpen(R, o, l, riders));
        if (alt != null) { o.tx = alt; o.lock = 2; }
      }
      target = Math.min(target, Math.max(0, leadV + Math.max(0, gap - 12) * 1.4)); // 追い越せなければ減速して車間をとる
    }
    const cur = o.vz * dir;
    o.vz = (cur + clamp(target - cur, -340 * dt, 150 * dt)) * dir;
    if (o.tx != null) {
      const dx = o.tx - o.x, st = (o.k === 'cop' ? 120 : 70) * dt;
      o.x += clamp(dx, -st, st);
      if (Math.abs(dx) < 0.6) { o.x = o.tx; o.tx = null; }
    }
    if (o.lock) o.lock = Math.max(0, o.lock - dt);
  }
  for (const o of R.obs) o.z += o.vz * dt;
  separate(R, riders);
}
const obsSnap = R => (R.obs || []).map(o => ({ id: o.id, k: o.k, x: r1(o.x), z: r1(o.z), c: o.c, vz: r1(o.vz), d: o.d }));

/* ===== 自転車の横移動（アナログ入力＋加速度でなめらかに） ===== */
const inS = inp => (inp && Number.isFinite(inp.s)) ? clamp(inp.s, -1, 1) : ((inp && inp.r) ? 1 : 0) - ((inp && inp.l) ? 1 : 0);
function steerRider(R, p, inp, maxV, dt) {
  const tv = inS(inp) * maxV;
  p.vx = (p.vx || 0) + clamp(tv - (p.vx || 0), -STEER_ACC * dt, STEER_ACC * dt);
  const drift = -curv(R.course, p.z) * p.v * p.v * DRIFT;
  const nx = clamp(p.x + (p.vx + drift) * dt, -HW + 14, HW - 14);
  if ((nx <= -HW + 14 && p.vx < 0) || (nx >= HW - 14 && p.vx > 0)) p.vx = 0;
  p.x = nx;
}
function prog(R, i, k, extra) { if (R.ids[i]) io.to(R.ids[i]).emit('prog', Object.assign({ k, cpu: !!R.isCpu }, extra || {})); }
function copPasses(R) {
  for (const o of R.obs) if (o.k === 'cop') R.P.forEach((p, i) => {
    if (p && !o.cp[i] && o.z - o.l > p.z + BIKE_L) { o.cp[i] = 1; prog(R, i, 'cop_pass'); }
  });
}

/* =====================================================================
   対戦モード（攻守交代・4ポイント先取・サドンデス）
   ===================================================================== */
const mkRider = (R, i, x, z) => ({ x, z, v: BASE, vx: 0, brk: 0, brakes: 3, boost: 0, cd: 0, skin: R.skins[i], hair: R.hairs[i], fit: R.fits[i], acc: R.accs[i], trail: R.trails[i] });
function newRound(R) {
  R.att = attOf(R.round);
  const d = 1 - R.att;
  R.P = [];
  R.P[R.att] = mkRider(R, R.att, rnd(-30, 30), 60);
  R.P[d] = mkRider(R, d, rnd(-30, 30), 0);
  R.obs = []; R.nid = 1; R.fx = null;
  R.inp = [{ s: 0 }, { s: 0 }];
  R.act = [false, false]; R.actK = [null, null];
  R.state = 'count'; R.timer = 3; R.el = 0;
  R.nextCar = rnd(1.6, 3);
  R.patrolAt = Math.random() < 0.7 ? rnd(5, 12) : 1e9;
  R.msg = ''; R.sub = '';
}
function resetMatch(R) { R.sc = [0, 0]; R.hist = []; R.round = 0; newRound(R); }
function endRound(R, w, pen, text) {
  if (w >= 0) {
    R.sc[w]++;
    if (R.ids[w]) io.to(R.ids[w]).emit('reward', { gain: 10 });
  }
  if (pen >= 0) R.sc[pen] = Math.max(0, R.sc[pen] - 1);
  for (const i of [0, 1]) prog(R, i, 'round', { win: w === i, dist: Math.max(0, Math.floor((R.P[i] ? R.P[i].z : 0) / 10)) });
  R.hist.push(w);
  R.msg = w >= 0 ? 'POINT GET!' : 'DRAW';
  R.sub = (w >= 0 ? R.names[w] + '  ' : '') + text;
  R.state = 'result'; R.timer = 2.8;
}
function afterResult(R) {
  const w = R.hist[R.hist.length - 1];
  if (w >= 0 && (R.sc[w] >= 4 || R.round >= 6)) {
    R.state = 'match';
    R.msg = 'MATCH WINNER: ' + R.names[w];
    R.sub = R.round >= 6 ? 'サドンデス決着' : '';
    for (const i of [0, 1]) {
      prog(R, i, 'match', { win: w === i, ranked: !!R.ranked, bot: !!R.bot, oppRp: R.rps[1 - i] || 0 });
      const sk = R.ranked && R.ids[i] && io.sockets.sockets.get(R.ids[i]); if (sk) sk.rkOk = true;   // RPランキングへの報告を1回だけ許可
    }
    return;
  }
  R.round++; newRound(R);
}
function updateCpuInp(R) {
  if (!R.isCpu || R.state !== 'play') return;
  const cpuSlot = 1, cpuP = R.P[cpuSlot], playerP = R.P[0];
  if (!cpuP) return;
  let targetX = cpuP.x;
  const sk = R.skill == null ? 0.5 : R.skill;   // ランクCPUは相手のランクが高いほど上手くなる
  const ahead = R.obs.filter(o => o.k !== 'cop' && (o.z - cpuP.z) > -20 && o.z - cpuP.z < 200 + sk * 160 && Math.abs(o.x - cpuP.x) < 60);
  const cop = R.obs.find(o => o.k === 'cop' && o.z < cpuP.z + 30 && cpuP.z - o.z < 320);
  if (cop && Math.abs(cop.x - cpuP.x) < 46) {
    targetX = cop.x > cpuP.x ? cop.x - 66 : cop.x + 66;
    if (Math.abs(targetX) > HW - 14) targetX = cop.x > cpuP.x ? cop.x + 66 : cop.x - 66;
  } else if (ahead.length) {
    ahead.sort((a, b) => a.z - b.z);
    const dg = ahead[0];
    if (Math.abs(dg.x - cpuP.x) < 36) targetX = dg.x > 0 ? dg.x - 60 : dg.x + 60;
  } else if (playerP) {
    if (R.att === cpuSlot) targetX = playerP.x + Math.sin(R.el * 3) * 45;
    else targetX = (playerP.z - cpuP.z) < 50 ? playerP.x + (playerP.x > 0 ? -50 : 50) : playerP.x;
  }
  targetX = clamp(targetX, -HW + 14, HW - 14);
  R.inp[cpuSlot] = { s: clamp((targetX - cpuP.x) / (52 - sk * 22), -1, 1) };
  if (R.el >= 3) {
    if (R.att === cpuSlot) {
      if (!cop && playerP && Math.abs(playerP.x - cpuP.x) < 26 + sk * 10 && (cpuP.z - playerP.z) < 30 + sk * 20 && cpuP.brakes > 0 && cpuP.brk <= 0 && Math.random() < 0.15 + sk * 0.35) R.act[cpuSlot] = true;
    } else if (cpuP.cd <= 0 && cpuP.boost <= 0) {
      // 上手いCPUは前の攻撃側と横にずれたタイミングでブースト
      if (sk < 0.45 || !playerP || Math.abs(playerP.x - cpuP.x) > 34 - sk * 10 || Math.random() < 0.03) R.act[cpuSlot] = true;
    }
  }
}
function step(R, dt) {
  if (R.state === 'count') { R.timer -= dt; if (R.timer <= 0) R.state = 'play'; return; }
  if (R.state === 'result') { R.timer -= dt; if (R.timer <= 0) afterResult(R); return; }
  if (R.state !== 'play') return;
  R.el += dt;
  if (R.isCpu) updateCpuInp(R);

  const att = R.att, d = 1 - att, A = R.P[att], B = R.P[d];
  if (!A || !B) return;
  steerRider(R, A, R.inp[att], 285, dt);
  steerRider(R, B, R.inp[d], 230, dt);
  if (R.el >= 3) {
    if (R.act[att] && A.brakes > 0 && A.brk <= 0) { A.brakes--; A.brk = 0.8; prog(R, att, 'brake'); }
    if (R.act[d] && B.cd <= 0 && B.boost <= 0) { B.boost = 1; B.cd = 3.5; prog(R, d, 'boost'); }
  }
  R.act = [false, false];
  if (A.brk > 0) { A.v = Math.max(0, A.v - 800 * dt); A.brk -= dt; } else A.v = Math.min(BASE, A.v + 120 * dt);
  if (B.boost > 0) { B.v = Math.min(220, B.v + 600 * dt); B.boost -= dt; } else B.v = Math.max(BASE, B.v - 300 * dt);
  B.cd = Math.max(0, B.cd - dt);
  A.z += A.v * dt; B.z += B.v * dt;

  const front = Math.max(A.z, B.z), back = Math.min(A.z, B.z);
  R.nextCar -= dt;
  if (R.nextCar <= 0) {
    R.nextCar = rnd(2, 3.6);
    if (Math.random() < 0.62) {
      const x = ONC[Math.random() < 0.5 ? 0 : 1] + rnd(-6, 6), z = front + rnd(560, 660);
      if (clearAt(R, x, z, 19, 26)) addObs(R, 'car', x, z, rnd(70, 110), -1, Math.floor(rnd(0, 6)));
    } else {
      const x = SAME[Math.random() < 0.5 ? 0 : 1] + rnd(-6, 6), z = front + rnd(420, 560);
      if (clearAt(R, x, z, 19, 26)) addObs(R, 'car', x, z, rnd(40, 65), 1, Math.floor(rnd(0, 6)));
    }
  }
  if (R.el >= R.patrolAt) { R.patrolAt = 1e9; addObs(R, 'cop', SAME[Math.random() < 0.5 ? 0 : 1], back - 260, 175, 1); }
  traffic(R, dt, R.P);
  R.obs = R.obs.filter(o => o.z > back - 360 && o.z < front + 900);
  copPasses(R);

  const lost = [null, null];
  for (const o of R.obs) for (const i of [0, 1]) {
    const p = R.P[i];
    if (o.k === 'cop') { if (copRule(o, p, i === att)) lost[i] = 'cop'; }
    else if (hitObs(o, p)) lost[i] = lost[i] || 'car';
  }
  if (lost[0] && lost[1]) { R.fx = { who: [0, 1], kind: lost[0] }; return endRound(R, -1, -1, '相打ち！'); }
  for (const i of [0, 1]) if (lost[i]) {
    R.fx = { who: [i], kind: lost[i] };
    return lost[i] === 'cop'
      ? endRound(R, 1 - i, i, R.names[i] + ' パトカー違反で逮捕！(-1pt)')
      : endRound(R, 1 - i, -1, R.names[i] + ' 車と衝突！');
  }
  const gap = A.z - B.z, dx = Math.abs(A.x - B.x);
  if (dx < 22 && gap < 18 && gap > -12) { R.fx = { who: [d], kind: 'bike' }; prog(R, att, 'brake_hit'); return endRound(R, att, -1, '攻撃側に激突！'); }
  if (B.z > A.z + 12) { prog(R, d, 'overtake'); return endRound(R, d, -1, '追い抜き成功！'); }
  if (R.el >= LIMIT) endRound(R, att, -1, 'ブロック成功(時間切れ)');
}
function riderSnap(p) {
  return { x: r1(p.x), z: r1(p.z), v: r1(p.v), vx: r1(p.vx || 0), brk: p.brk > 0 ? 1 : 0, brakes: p.brakes, boost: p.boost > 0 ? 1 : 0, cd: r1(p.cd), bcd: r1(p.bcd || 0), skin: p.skin, hair: p.hair, fit: p.fit, acc: p.acc, trail: p.trail };
}
function snapV(R, slot) {
  const att = R.att, d = 1 - att;
  const bgGap = (R.P && R.P[att] && R.P[d]) ? Math.max(0, R.P[att].z - R.P[d].z) : 999;
  const bgBx = (R.P && R.P[d]) ? R.P[d].x : 0;
  const bgBoost = (R.P && R.P[d]) ? R.P[d].boost > 0 : false;
  const P = (R.P || []).map((p, i) => {
    if (!p) return null;
    // 攻撃側には後ろ（追越側）の位置を送らない（ブースト中のみ見える）
    if ((R.state === 'play' || R.state === 'count') && slot === att && i !== slot && p.boost <= 0) return null;
    return riderSnap(p);
  });
  return {
    mode: 'versus', s: R.state, t: r1(R.timer), rd: R.round, att: R.att, sc: R.sc, hist: R.hist, msg: R.msg, sub: R.sub, el: r1(R.el),
    course: R.course || 0, bgGap: r1(bgGap), bgBx: r1(bgBx), bgBoost, names: R.names, lvs: R.lvs, ranked: !!R.ranked, fx: R.fx, P, obs: obsSnap(R)
  };
}

/* =====================================================================
   エンドレスラン（1人・どこまで行けるか）
   ===================================================================== */
const EN = { BASE: 130, MAX: 330, ACC: 2.4, STEER: 260 };
function resetEndless(R) {
  R.P = [{ x: 0, z: 0, v: EN.BASE, vx: 0, brk: 0, bcd: 0, boost: 0, cd: 0, brakes: 0, skin: R.skins[0], hair: R.hairs[0], fit: R.fits[0], acc: R.accs[0], trail: R.trails[0] }];
  R.obs = []; R.nid = 1; R.fx = null;
  R.inp = [{ s: 0 }, { s: 0 }]; R.act = [false, false]; R.actK = [null, null];
  R.state = 'count'; R.timer = 3; R.el = 0;
  R.score = 0; R.bonus = 0; R.combo = 0; R.comboT = 0; R.nearN = 0; R.ev = [];
  R.nextCar = 1.2; R.nextCop = rnd(9, 13); R.sentOver = false; R.msg = ''; R.sub = '';
}
function spawnWave(R, p) {
  const lvl = Math.min(1, R.el / 150), z = p.z + rnd(580, 660);
  // 近くの障害物の車線を調べ、必ず1車線は通れるようにする
  const used = new Set(R.obs.filter(o => o.k !== 'cop' && Math.abs(o.z - z) < 200).map(o => laneIdx(o.x)));
  const free = [0, 1, 2, 3].filter(i => !used.has(i));
  if (free.length < 2) return;
  const keep = free[Math.floor(Math.random() * free.length)];
  const cand = free.filter(i => i !== keep).sort(() => Math.random() - 0.5);
  const r = Math.random();
  if (r < 0.12 + lvl * 0.06) { const li = cand[0]; for (let i = 0; i < 3; i++) addObs(R, 'cone', LANES[li] + rnd(-5, 5), z + i * 26, 0, 1); return; }
  const sameC = cand.filter(i => i < 2);
  if (r < 0.24 && sameC.length) { addObs(R, 'bus', LANES[sameC[0]] * 0.98, z, rnd(35, 50), 1); return; }
  const n = Math.min(cand.length, Math.random() < 0.35 + lvl * 0.4 ? (Math.random() < lvl * 0.5 ? 3 : 2) : 1);
  for (let k = 0; k < n; k++) {
    const li = cand[k], onc = li >= 2;
    addObs(R, 'car', LANES[li] + rnd(-6, 6), z + rnd(-30, 30), onc ? rnd(60, 110) : rnd(40, 70), onc ? -1 : 1, Math.floor(rnd(0, 6)));
  }
}
function overEndless(R, kind, reason) {
  const p = R.P[0];
  R.state = 'over'; R.fx = { who: [0], kind }; R.msg = 'GAME OVER'; R.sub = reason;
  R.score = Math.floor(p.z / 10) + R.bonus;
  const res = submitScore(R.hostId, R.names[0], R.score, R.lvs[0]);
  const coins = Math.floor(R.score / 40), sid = R.ids[0];
  if (coins > 0) io.to(sid).emit('reward', { gain: coins });
  prog(R, 0, 'run', { score: R.score, dist: Math.floor(p.z / 10) });
  io.to(sid).emit('endless_over', { score: R.score, dist: Math.floor(p.z / 10), bonus: R.bonus, reason, kind, coins, best: res.best, rank: res.rank, improved: res.improved, top: topN(10, R.hostId) });
}
function stepEndless(R, dt) {
  if (R.state === 'count') { R.timer -= dt; if (R.timer <= 0) R.state = 'play'; return; }
  if (R.state !== 'play') return;
  R.el += dt;
  const p = R.P[0];
  steerRider(R, p, R.inp[0], EN.STEER, dt);
  if (R.act[0]) {
    if (R.actK[0] === 'brake') { if (p.bcd <= 0) { p.brk = 0.7; p.bcd = 1.3; prog(R, 0, 'brake'); } }
    else if (p.cd <= 0 && p.boost <= 0) { p.boost = 1.3; p.cd = 4; prog(R, 0, 'boost'); }
  }
  R.act = [false, false];
  const target = Math.min(EN.MAX, EN.BASE + R.el * EN.ACC);
  if (p.brk > 0) { p.brk -= dt; p.v = Math.max(target * 0.35, p.v - 420 * dt); }
  else if (p.boost > 0) { p.boost -= dt; p.v = Math.min(target + 160, p.v + 520 * dt); }
  else { const df = target - p.v; p.v += Math.sign(df) * Math.min(Math.abs(df), 170 * dt); }
  p.cd = Math.max(0, p.cd - dt); p.bcd = Math.max(0, p.bcd - dt);
  p.z += p.v * dt;
  R.comboT -= dt; if (R.comboT <= 0) R.combo = 0;

  const lvl = Math.min(1, R.el / 150);
  R.nextCar -= dt;
  if (R.nextCar <= 0) { R.nextCar = rnd(1.3, 2.1) - lvl * 0.85; spawnWave(R, p); }
  R.nextCop -= dt;
  if (R.nextCop <= 0) {
    R.nextCop = rnd(11, 17) - lvl * 5;
    const x = nearestLane(p.x, SAME);   // 自分に近い車線を後ろから走ってくる（サイレンで予告）
    if (clearAt(R, x, p.z - 330, 19, 27)) addObs(R, 'cop', x, p.z - 330, p.v + 90, 1);
  }
  for (const o of R.obs) if (o.k === 'cop') o.v0 = Math.max(o.v0, p.v + 75);
  traffic(R, dt, R.P);
  R.obs = R.obs.filter(o => o.z > p.z - 420 && o.z < p.z + 900);
  copPasses(R);

  for (const o of R.obs) {
    if (o.k === 'cop') { if (copRule(o, p, true)) return overEndless(R, 'cop', 'パトカーの進路妨害で逮捕！'); continue; }
    if (hitObs(o, p)) return overEndless(R, 'car', o.k === 'cone' ? '工事現場に突っ込んだ！' : o.k === 'bus' ? 'バスに激突！' : '車と衝突！');
    if (!o.passed && (o.z + o.l < p.z - BIKE_L)) {
      o.passed = true;
      if (o.k !== 'cone' && Math.abs(o.x - p.x) < o.w + BIKE_W + 20) {   // ニアミスボーナス
        R.combo++; R.comboT = 3.5; R.nearN++;
        const b = 15 * Math.min(R.combo, 8);
        R.bonus += b; R.ev.push({ t: 'near', n: R.combo, b });
      }
    }
  }
  R.score = Math.floor(p.z / 10) + R.bonus;
}
function snapE(R) {
  const s = {
    mode: 'endless', s: R.state, t: r1(R.timer), el: r1(R.el), course: R.course, names: R.names, lvs: R.lvs, fx: R.fx,
    score: R.score, combo: R.combo, rd: 0, att: 0, sc: [0, 0], hist: [], msg: R.msg, sub: R.sub,
    P: [riderSnap(R.P[0])], obs: obsSnap(R), ev: R.ev
  };
  R.ev = [];
  return s;
}

/* ===== ゲームループ（30Hz） ===== */
setInterval(() => {
  for (const R of rooms.values()) {
    if (R.state === 'lobby') continue;
    if (R.mode === 'endless') {
      if (R.state === 'over' && R.sentOver) continue;
      stepEndless(R, TICK);
      if (R.state === 'over') R.sentOver = true;
      io.to(R.ids[0]).emit('st', snapE(R));
      continue;
    }
    if (!R.isCpu && !R.ids[1]) continue;
    step(R, TICK);
    for (const i of [0, 1]) if (R.ids[i]) io.to(R.ids[i]).emit('st', snapV(R, i));
  }
}, TICK * 1000);

/* =====================================================================
   ルーム・フレンド・チャット
   ===================================================================== */
const byId = new Map();   // ログインID(NM-…) -> socket.id
const owners = new Map(); // ログインID -> 端末UUID（なりすまし防止の簡易チェック）
const byFid = new Map();  // フレンドID(F-XXXX-XXXX) -> socket.id
const fidOwners = new Map(); // フレンドID -> 端末UUID
const sockOf = sid => sid && io.sockets.sockets.get(sid);
function statusOf(sid) {
  const sk = sockOf(sid);
  if (!sk) return 'offline';
  if (rankQ.some(q => q.sid === sid)) return 'playing';
  const R = sk.data && rooms.get(sk.data.code);
  if (!R) return 'online';
  return (R.mode === 'versus' && !R.isCpu && !R.ids[1]) ? 'waiting' : 'playing';
}
function setLook(R, i, L) { R.names[i] = L.name; R.skins[i] = L.skin; R.hairs[i] = L.hair; R.fits[i] = L.fit; R.accs[i] = L.acc; R.trails[i] = L.trail; R.lvs[i] = L.lv; R.pids[i] = L.pid; R.fids[i] = L.fid; R.ttls[i] = L.ttl; R.pls[i] = L.pl; R.rps[i] = L.rp; }
function newRoom(code, socket, d, extra) {
  const R = Object.assign({
    code, ids: [socket.id, null], names: ['プレイヤー', 'プレイヤー2'], skins: ['default', 'default'], hairs: ['default', 'default'], fits: ['default', 'default'],
    accs: ['none', 'none'], trails: ['none', 'none'], lvs: [1, 1], pids: ['', ''], fids: ['', ''], ttls: ['rookie', 'rookie'], pls: ['normal', 'normal'], rps: [0, 0], ready: [false, false],
    course: cleanCourse(d && d.course), hostId: clean(d && d.id, ''), hostFid: cleanFid(d && d.fid), mode: 'versus', isCpu: false,
    inp: [{ s: 0 }, { s: 0 }], act: [false, false], actK: [null, null], state: 'wait', sc: [0, 0], hist: [], round: 0, P: [], obs: [], nid: 1
  }, extra || {});
  setLook(R, 0, look(d, 'プレイヤー'));
  return R;
}
function roomInfo(R, me) {
  return {
    code: R.code, me, course: R.course, state: R.state,
    players: [0, 1].map(i => R.ids[i] ? { name: R.names[i], fid: R.fids[i], skin: R.skins[i], hair: R.hairs[i], fit: R.fits[i], acc: R.accs[i], trail: R.trails[i], lv: R.lvs[i], ttl: R.ttls[i], pl: R.pls[i], rp: R.rps[i], ready: !!R.ready[i] } : null)
  };
}
function sendRoom(R) { for (const i of [0, 1]) if (R.ids[i]) io.to(R.ids[i]).emit('room', roomInfo(R, i)); }
function leaveRoom(socket) {
  const R = rooms.get(socket.data && socket.data.code);
  if (R) {
    const slot = socket.data.slot;
    if (R.mode === 'versus' && !R.isCpu && !R.ranked && slot === 1 && R.ids[0]) {
      // ゲストが抜けた → ホストはルームロビーへ戻って次の相手を待つ
      R.ids[1] = null; R.ready = [false, false]; R.state = 'lobby'; R.P = []; R.obs = []; R.names[1] = 'プレイヤー2';
      io.to(R.ids[0]).emit('room_note', { t: 'guest_left' });
      sendRoom(R);
    } else {
      const other = R.ids[1 - slot];
      if (other) {
        if (R.ranked && R.state !== 'match') {
          // ランクマッチ中に相手が抜けた → 残った側の勝ち（抜けた側はクライアントで敗北扱い）
          io.to(other).emit('rank_forfeit', { oppRp: R.rps[slot] || 0 });
          const os2 = io.sockets.sockets.get(other); if (os2) os2.rkOk = true;
        } else io.to(other).emit('left');
        const os = io.sockets.sockets.get(other); if (os) os.data = {};
      }
      rooms.delete(R.code);
    }
  }
  socket.data = {};
}
function joinRoom(socket, R, d, reply) {
  if (!R) return reply({ ok: false, err: 'ルームが見つかりません' });
  if (R.mode !== 'versus' || R.ids[1] || R.isCpu) return reply({ ok: false, err: 'ルームに参加できません' });
  if (R.state !== 'lobby') return reply({ ok: false, err: 'ルームは対戦中です' });
  if (R.ids[0] === socket.id) return reply({ ok: false, err: '自分のルームには参加できません' });
  leaveRoom(socket);
  R.ids[1] = socket.id; R.ready = [false, false];
  setLook(R, 1, look(d, 'プレイヤー2'));
  socket.data = { code: R.code, slot: 1 };
  reply({ ok: true });
  sendRoom(R);
}
const oppInfo = (R, i) => ({ name: R.names[i], fid: (R.isCpu && i === 1) ? '' : R.fids[i], lv: R.lvs[i], rp: R.rps[i], ttl: R.ttls[i], pl: R.pls[i], skin: R.skins[i], hair: R.hairs[i], fit: R.fits[i], acc: R.accs[i], trail: R.trails[i], bot: !!(R.bot && i === 1), cpu: !!(R.isCpu && i === 1) });
function startRoomMatch(R) {
  resetMatch(R);
  for (const i of [0, 1]) io.to(R.ids[i]).emit('start', { slot: i, course: R.course, mode: 'versus', room: true, opp: oppInfo(R, 1 - i) });
}

/* =====================================================================
   ランクマッチ（RPが近い相手と自動マッチング。見つからなければランクCPU）
   ===================================================================== */
const rankQ = [];   // { sid, rp, t0, d }
const qRemove = sid => { const i = rankQ.findIndex(q => q.sid === sid); if (i >= 0) rankQ.splice(i, 1); };
let rkSeq = 1;
function startRanked(a, b) {
  const sa = io.sockets.sockets.get(a.sid); if (!sa) return;
  const code = 'RK_' + (rkSeq++);
  const R = newRoom(code, sa, a.d, b ? { ranked: true } : { ranked: true, bot: true, isCpu: true });
  R.course = Math.floor(Math.random() * PATHS.length);
  R.rps[0] = a.rp;
  if (b) {
    const sb = io.sockets.sockets.get(b.sid); if (!sb) { rankQ.push(a); return; }
    R.ids[1] = b.sid; setLook(R, 1, look(b.d, 'プレイヤー2')); R.rps[1] = b.rp;
    sb.data = { code, slot: 1 };
  } else {
    const lv = R.lvs[0] || 1, pick = arr => arr[Math.floor(Math.random() * arr.length)];
    setLook(R, 1, {
      name: pick(BOT_NAMES), skin: pick(['default', 'gold', 'cyber', 'ocean', 'neon', 'tiger', 'mint', 'sunset']), hair: pick(['helmet', 'short_b', 'spiky', 'pony', 'mohawk', 'bob']),
      fit: pick(['jersey', 'racer', 'hoodie', 'happi', 'aloha', 'suit']), acc: pick(['none', 'cap', 'sunglass', 'goggles', 'headphone']), trail: pick(['none', 'fire', 'spark', 'bubble']),
      lv: clamp(lv + Math.floor(rnd(-3, 4)), 1, 99), pid: '', fid: '', ttl: 'rookie', pl: 'normal', rp: clamp(Math.round(a.rp + rnd(-60, 60)), 0, 99999)
    });
    R.skill = clamp(0.25 + a.rp / 1700, 0.25, 0.95);
  }
  rooms.set(code, R);
  sa.data = { code, slot: 0 };
  resetMatch(R);
  for (const i of [0, 1]) if (R.ids[i]) io.to(R.ids[i]).emit('start', { slot: i, course: R.course, mode: 'versus', room: false, ranked: true, opp: oppInfo(R, 1 - i) });
}
function tryMatch() {
  const now = Date.now();
  for (let i = rankQ.length - 1; i >= 0; i--) if (!io.sockets.sockets.get(rankQ[i].sid)) rankQ.splice(i, 1);
  rankQ.sort((a, b) => a.t0 - b.t0);
  for (let i = 0; i < rankQ.length; i++) {
    const a = rankQ[i], wa = (now - a.t0) / 1000;
    let best = -1, bd = 1e9;
    for (let j = i + 1; j < rankQ.length; j++) {
      const b = rankQ[j], w = Math.max(wa, (now - b.t0) / 1000), win = 150 + w * 25, d = Math.abs(a.rp - b.rp);
      if (d <= win && d < bd) { bd = d; best = j; }
    }
    if (best >= 0) { const b = rankQ[best]; rankQ.splice(best, 1); rankQ.splice(i, 1); startRanked(a, b); return tryMatch(); }
  }
}
setInterval(() => {
  tryMatch();
  const now = Date.now();
  for (const q of rankQ.slice()) {
    const w = (now - q.t0) / 1000;
    if (w >= BOT_AFTER) { qRemove(q.sid); startRanked(q, null); continue; }
    io.to(q.sid).emit('rank_wait', { t: Math.floor(w), n: rankQ.length, bot: BOT_AFTER });
  }
}, 1000);

io.on('connection', socket => {
  socket.data = {};
  const rp = cb => (typeof cb === 'function' ? cb : () => {});
  const myRoom = () => rooms.get(socket.data && socket.data.code);

  // 接続のたびに：ログインID（非公開）＋フレンドID（公開用）を登録
  socket.on('hello', d => {
    const id = clean(d && d.id, ''), uid = cleanUid(d && d.uid), fid = cleanFid(d && d.fid);
    if (!id) return;
    const owner = owners.get(id), sid = byId.get(id);
    if (owner && uid && owner !== uid && sid && sid !== socket.id && sockOf(sid)) { socket.emit('id_conflict'); return; }
    if (uid) owners.set(id, uid);
    socket.nmId = id; byId.set(id, socket.id);
    socket.nmName = cleanName(d && d.name, 'プレイヤー'); socket.nmLv = clamp(parseInt(d && d.lv, 10) || 1, 1, 99);
    if (fid) {
      const fo = fidOwners.get(fid), fs = byFid.get(fid);
      if (fo && uid && fo !== uid && fs && fs !== socket.id && sockOf(fs)) { socket.emit('fid_conflict'); return; }   // 別の端末が使用中 → 再発行してもらう
      if (socket.nmFid && socket.nmFid !== fid && byFid.get(socket.nmFid) === socket.id) byFid.delete(socket.nmFid);
      if (uid) fidOwners.set(fid, uid);
      socket.nmFid = fid; byFid.set(fid, socket.id);
    }
  });
  // フレンドの在席状況（フレンドIDで問い合わせ。旧バージョンのログインID登録は新しいフレンドIDへ自動移行）
  socket.on('friends_status', (list, cb) => {
    const o = {};
    (Array.isArray(list) ? list.slice(0, 50) : []).forEach(f => {
      if (cleanFid(f)) { const sid = byFid.get(f), sk = sockOf(sid); o[f] = { s: statusOf(sid), name: sk ? sk.nmName : undefined, lv: sk ? sk.nmLv : undefined }; }
      else if (isLoginId(f)) { const sid = byId.get(f), sk = sockOf(sid); o[f] = { s: statusOf(sid), fid: sk && sk.nmFid ? sk.nmFid : undefined, name: sk ? sk.nmName : undefined }; }
    });
    rp(cb)(o);
  });
  // フレンドID検索（オンラインのプレイヤーのみ名前がわかる）
  socket.on('friend_lookup', (fid, cb) => {
    fid = cleanFid(fid); const sid = fid && byFid.get(fid), sk = sockOf(sid);
    rp(cb)(sk ? { found: true, name: sk.nmName, lv: sk.nmLv, s: statusOf(sid), me: sid === socket.id } : { found: false });
  });
  socket.on('ranking', (d, cb) => { if (typeof d === 'function') cb = d; rp(cb)({ top: topN(30, socket.nmId) }); });
  socket.on('pg', (d, cb) => rp(cb)(1));   // 通信の遅れを測る（操作の先読み補正に使用）
  socket.on('rank_top', (d, cb) => { if (typeof d === 'function') cb = d; rp(cb)({ top: rpTop(30, socket.nmId) }); });
  socket.on('rank_report', (d, cb) => {
    if (!socket.rkOk || !d) return rp(cb)({ ok: false });
    socket.rkOk = false;
    const id = clean(d.id, ''); if (!id) return rp(cb)({ ok: false });
    rp(cb)({ ok: true, rank: submitRp(id, cleanName(d.name, 'プレイヤー'), clamp(parseInt(d.rp, 10) || 0, 0, 99999), clamp(parseInt(d.lv, 10) || 1, 1, 99), clean(d.ttl, 'rookie')) });
  });
  // ランクマッチの待ち行列に入る／抜ける
  socket.on('rank_q', d => {
    leaveRoom(socket); qRemove(socket.id);
    const L = look(d, 'プレイヤー');
    rankQ.push({ sid: socket.id, rp: L.rp, t0: Date.now(), d });
    socket.emit('rank_wait', { t: 0, n: rankQ.length, bot: BOT_AFTER });
    tryMatch();
  });
  socket.on('rank_cancel', () => qRemove(socket.id));

  socket.on('solo', d => {
    leaveRoom(socket); qRemove(socket.id);
    const code = 'SOLO_' + socket.id, R = newRoom(code, socket, d, { isCpu: true });
    setLook(R, 1, { name: 'CPU', skin: ['default', 'gold', 'cyber', 'ocean'][Math.floor(Math.random() * 4)], hair: ['helmet', 'short_b', 'spiky'][Math.floor(Math.random() * 3)], fit: ['jersey', 'racer', 'hoodie'][Math.floor(Math.random() * 3)], acc: 'none', trail: 'none', lv: clamp((R.lvs[0] || 1) + Math.floor(rnd(-2, 3)), 1, 99), pid: '', fid: '', ttl: 'rookie', pl: 'normal', rp: 0 });
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    resetMatch(R);
    socket.emit('start', { slot: 0, course: R.course, mode: 'versus', room: false, opp: oppInfo(R, 1) });
  });
  socket.on('endless', d => {
    leaveRoom(socket); qRemove(socket.id);
    const code = 'RUN_' + socket.id, R = newRoom(code, socket, d, { mode: 'endless' });
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    resetEndless(R);
    socket.emit('start', { slot: 0, course: R.course, mode: 'endless', room: false });
  });
  socket.on('create', (d, cb) => {
    if (typeof d === 'function') { cb = d; d = {}; }
    leaveRoom(socket); qRemove(socket.id);
    let code; do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
    const R = newRoom(code, socket, d);
    R.state = 'lobby';
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    rp(cb)({ code });
    sendRoom(R);
  });
  socket.on('join', (d, cb) => {
    const code = (d && typeof d === 'object') ? d.code : d;
    joinRoom(socket, rooms.get(String(code)), d, rp(cb));
  });
  // フレンドの部屋にワンタップ参加（部屋コード不要）
  socket.on('join_friend', (d, cb) => {
    const tf = cleanFid(d && d.targetFid), tl = isLoginId(d && d.targetId) ? d.targetId : '';
    const R = [...rooms.values()].find(r => (tf ? r.hostFid === tf : (tl && r.hostId === tl)) && r.mode === 'versus' && r.state === 'lobby' && !r.ids[1] && !r.isCpu && r.ids[0] !== socket.id);
    if (!R) return rp(cb)({ ok: false, err: 'フレンドは今ルームで待っていません' });
    joinRoom(socket, R, d, rp(cb));
  });
  socket.on('room_ready', v => { const R = myRoom(); if (!R || R.state !== 'lobby' || socket.data.slot !== 1) return; R.ready[1] = !!v; sendRoom(R); });
  socket.on('room_course', v => { const R = myRoom(); if (!R || R.state !== 'lobby' || socket.data.slot !== 0) return; R.course = cleanCourse(v); sendRoom(R); });
  socket.on('room_look', d => { const R = myRoom(); if (!R || R.state !== 'lobby') return; setLook(R, socket.data.slot, look(d, R.names[socket.data.slot])); sendRoom(R); });
  socket.on('room_start', () => {
    const R = myRoom();
    if (!R || R.state !== 'lobby' || socket.data.slot !== 0) return;
    if (!R.ids[1]) return socket.emit('room_note', { t: 'need_guest' });
    if (!R.ready[1]) return socket.emit('room_note', { t: 'need_ready' });
    startRoomMatch(R);
  });
  socket.on('toroom', () => {
    const R = myRoom();
    if (!R || R.isCpu || R.mode !== 'versus' || R.state !== 'match') return;
    R.state = 'lobby'; R.ready = [false, false]; R.P = []; R.obs = [];
    sendRoom(R);
  });
  // チャット・エモート（ルーム内の2人に配信）
  socket.on('chat', d => {
    const R = myRoom(); if (!R || R.mode === 'endless') return;
    const nowT = Date.now(); if (nowT - (socket.lastChat || 0) < 600) return; socket.lastChat = nowT;
    const t = d && d.t; let v = d && d.v;
    if (t === 'e') { if (!EMOTES.includes(v)) return; }
    else if (t === 'x') { v = cleanText(v, 30); if (!v) return; }
    else return;
    const slot = socket.data.slot, msg = { from: slot, name: R.names[slot], t, v };
    for (const i of [0, 1]) if (R.ids[i]) io.to(R.ids[i]).emit('chat', msg);
    if (R.isCpu && Math.random() < 0.6) setTimeout(() => {
      if (!rooms.has(R.code) || !R.ids[0]) return;
      const emo = Math.random() < 0.4;
      io.to(R.ids[0]).emit('chat', { from: 1, name: 'CPU', t: emo ? 'e' : 'x', v: emo ? EMOTES[Math.floor(Math.random() * 6)] : CPU_LINES[Math.floor(Math.random() * CPU_LINES.length)] });
    }, 900 + Math.random() * 900);
  });
  socket.on('inp', d => {
    const R = myRoom(); if (!R) return;
    R.inp[socket.data.slot] = (d && Number.isFinite(d.s)) ? { s: clamp(d.s, -1, 1) } : { l: !!(d && d.l), r: !!(d && d.r) };
  });
  socket.on('act', d => {
    const R = myRoom(); if (!R) return;
    R.act[socket.data.slot] = true;
    R.actK[socket.data.slot] = (d && d.k === 'brake') ? 'brake' : 'boost';
  });
  socket.on('again', () => {
    const R = myRoom(); if (!R) return;
    if (R.mode === 'endless') { if (R.state === 'over') resetEndless(R); }
    else if (R.state === 'match' && !R.ranked) resetMatch(R);   // ランクマッチは毎回マッチングし直す
  });
  socket.on('leave', () => { qRemove(socket.id); leaveRoom(socket); });
  socket.on('disconnect', () => {
    if (socket.nmId && byId.get(socket.nmId) === socket.id) byId.delete(socket.nmId);
    if (socket.nmFid && byFid.get(socket.nmFid) === socket.id) byFid.delete(socket.nmFid);
    qRemove(socket.id); leaveRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('listening on ' + PORT));
