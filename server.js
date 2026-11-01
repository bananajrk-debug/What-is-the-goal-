// なにが目的なん？ ONLINE v3 — Express + Socket.io（サーバー権威型）
// 対戦（ルーム / CPU / フレンドのワンタップ参加）＋ エンドレスラン ＋ ランキング
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
// 障害物の大きさ（w=半幅 / l=半長）。新しい見た目のサイズに合わせた当たり判定
const OBS = { car: { w: 19, l: 26 }, bus: { w: 23, l: 58 }, cone: { w: 7, l: 7 }, cop: { w: 19, l: 27 } };
const BIKE_W = 5, BIKE_L = 10;
const COP_DX = 28, COP_BACK = -36, COP_FRONT = 40, COP_BLOCK = 70;

const rooms = new Map();
const attOf = r => (r < 3 ? 0 : r < 6 ? 1 : r % 2);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = n => Math.round(n * 10) / 10;

/* ===== 入力値の検証（見た目データは性能に一切影響しない） ===== */
const clean = (v, def) => (typeof v === 'string' && /^[\w-]{1,24}$/.test(v)) ? v : def;
const cleanUid = v => (typeof v === 'string' && /^[\w-]{8,64}$/.test(v)) ? v : '';
const cleanName = (v, def) => {
  if (typeof v !== 'string') return def;
  const s = v.replace(/[\u0000-\u001f<>&"'`\\]/g, '').trim().slice(0, 10);
  return s || def;
};
const cleanCourse = v => { v = parseInt(v, 10); return v >= 0 && v < 4 ? v : 0; };
const look = (d, defName) => {
  d = (d && typeof d === 'object') ? d : {};
  return { name: cleanName(d.name, defName), skin: clean(d.skin, 'default'), hair: clean(d.hair, 'default'), fit: clean(d.fit, 'default') };
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
function submitScore(id, name, score) {
  if (!id) return { best: score, rank: 0, improved: false };
  const i = ranking.findIndex(r => r.id === id);
  let best = score, improved = false;
  if (i >= 0) {
    if (score > ranking[i].score) { ranking[i] = { id, name, score, ts: Date.now() }; improved = true; }
    else { best = ranking[i].score; ranking[i].name = name; }
  } else { ranking.push({ id, name, score, ts: Date.now() }); improved = true; }
  ranking.sort((a, b) => b.score - a.score);
  ranking = ranking.slice(0, 100);
  saveRanking();
  return { best, rank: ranking.findIndex(r => r.id === id) + 1, improved };
}
const topN = n => ranking.slice(0, n).map(r => ({ id: r.id, name: r.name, score: r.score }));
app.get('/api/ranking', (req, res) => res.json({ top: topN(50) }));
// public/sounds に置いた音声ファイルの一覧（クライアントは存在するものだけ読み込む）
app.get('/api/sounds', (req, res) => {
  fs.readdir(path.join(__dirname, 'public', 'sounds'), (err, list) => {
    res.json({ files: err ? [] : list.filter(f => /^[\w-]+\.(mp3|m4a|ogg|wav)$/i.test(f)) });
  });
});

/* ===== 障害物 ===== */
function addObs(R, k, x, z, vz, c) {
  const s = OBS[k];
  R.obs.push({ id: R.nid++, k, x, z, vz, c: c || 0, w: s.w, l: s.l, passed: false });
}
const hitObs = (o, p) => Math.abs(o.x - p.x) < o.w + BIKE_W && Math.abs(o.z - p.z) < o.l + BIKE_L;
function copRule(o, p, isAtt) {
  const dx = Math.abs(o.x - p.x), gap = p.z - o.z;
  if (dx < COP_DX && gap > COP_BACK && gap < COP_FRONT) return true;               // 接触・割り込み
  if (isAtt && p.brk > 0 && dx < 30 && gap > 0 && gap < COP_BLOCK) return true;   // 急ブレーキで通行妨害
  return false;
}
const obsSnap = R => (R.obs || []).map(o => ({ id: o.id, k: o.k, x: r1(o.x), z: r1(o.z), c: o.c, vz: r1(o.vz) }));

/* =====================================================================
   対戦モード（攻守交代・4ポイント先取・サドンデス）
   ===================================================================== */
const mkRider = (R, i, x, z) => ({ x, z, v: BASE, brk: 0, brakes: 3, boost: 0, cd: 0, skin: R.skins[i], hair: R.hairs[i], fit: R.fits[i] });

function newRound(R) {
  R.att = attOf(R.round);
  const d = 1 - R.att;
  R.P = [];
  R.P[R.att] = mkRider(R, R.att, rnd(-30, 30), 60);
  R.P[d] = mkRider(R, d, rnd(-30, 30), 0);
  R.obs = []; R.nid = 1; R.fx = null;
  R.inp = [{ l: 0, r: 0 }, { l: 0, r: 0 }];
  R.act = [false, false]; R.actK = [null, null];
  R.state = 'count'; R.timer = 3; R.el = 0;
  R.nextCar = rnd(2, 3.5);
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
    return;
  }
  R.round++; newRound(R);
}

function updateCpuInp(R) {
  if (!R.isCpu || R.state !== 'play') return;
  const cpuSlot = 1, cpuP = R.P[cpuSlot], playerP = R.P[0];
  if (!cpuP) return;
  let targetX = cpuP.x;
  const aheadCars = R.obs.filter(o => o.k !== 'cop' && o.z > cpuP.z && o.z - cpuP.z < 260);
  const cop = R.obs.find(o => o.k === 'cop' && o.z < cpuP.z + 30 && cpuP.z - o.z < 320);
  if (cop && Math.abs(cop.x - cpuP.x) < 44) {
    targetX = cop.x > cpuP.x ? cop.x - 64 : cop.x + 64;
    if (Math.abs(targetX) > HW - 14) targetX = cop.x > cpuP.x ? cop.x + 64 : cop.x - 64;
  } else if (aheadCars.length > 0) {
    aheadCars.sort((a, b) => a.z - b.z);
    const danger = aheadCars[0];
    if (Math.abs(danger.x - cpuP.x) < 34) targetX = danger.x > 0 ? danger.x - 58 : danger.x + 58;
  } else if (playerP) {
    if (R.att === cpuSlot) targetX = playerP.x + Math.sin(R.el * 3) * 45;
    else {
      const zGap = playerP.z - cpuP.z;
      targetX = zGap < 50 ? playerP.x + (playerP.x > 0 ? -50 : 50) : playerP.x;
    }
  }
  targetX = clamp(targetX, -HW + 14, HW - 14);
  const dx = targetX - cpuP.x;
  R.inp[cpuSlot] = { l: dx < -4, r: dx > 4 };
  if (R.el >= 3) {
    if (R.att === cpuSlot) {
      if (!cop && playerP && Math.abs(playerP.x - cpuP.x) < 30 && (cpuP.z - playerP.z) < 40 && cpuP.brakes > 0 && cpuP.brk <= 0) {
        if (Math.random() < 0.35) R.act[cpuSlot] = true;
      }
    } else if (cpuP.cd <= 0 && cpuP.boost <= 0) R.act[cpuSlot] = true;
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
  for (const i of [0, 1]) {
    const p = R.P[i], inp = R.inp[i] || {};
    const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    p.x = clamp(p.x + dir * (i === att ? 285 : 230) * dt, -HW + 14, HW - 14);
  }
  if (R.el >= 3) {
    if (R.act[att] && A.brakes > 0 && A.brk <= 0) { A.brakes--; A.brk = 0.8; }
    if (R.act[d] && B.cd <= 0 && B.boost <= 0) { B.boost = 1; B.cd = 3.5; }
  }
  R.act = [false, false];

  if (A.brk > 0) { A.v = Math.max(0, A.v - 800 * dt); A.brk -= dt; } else A.v = Math.min(BASE, A.v + 120 * dt);
  if (B.boost > 0) { B.v = Math.min(220, B.v + 600 * dt); B.boost -= dt; } else B.v = Math.max(BASE, B.v - 300 * dt);
  B.cd = Math.max(0, B.cd - dt);
  A.z += A.v * dt; B.z += B.v * dt;

  const front = Math.max(A.z, B.z), back = Math.min(A.z, B.z);
  R.nextCar -= dt;
  if (R.nextCar <= 0) {
    R.nextCar = rnd(2, 3.8);
    addObs(R, 'car', rnd(-HW + 20, HW - 20), front + rnd(360, 420), -90, Math.floor(rnd(0, 6)));
  }
  if (R.el >= R.patrolAt) {
    R.patrolAt = 1e9;
    addObs(R, 'cop', rnd(-HW + 25, HW - 25), back - 260, 175);
  }
  for (const o of R.obs) o.z += o.vz * dt;
  R.obs = R.obs.filter(o => (o.k === 'car' ? o.z > back - 100 : o.z < front + 220));

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
  if (dx < 22 && gap < 18 && gap > -12) { R.fx = { who: [d], kind: 'bike' }; return endRound(R, att, -1, '攻撃側に激突！'); }
  if (B.z > A.z + 12) return endRound(R, d, -1, '追い抜き成功！');
  if (R.el >= LIMIT) endRound(R, att, -1, 'ブロック成功(時間切れ)');
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
    return { x: r1(p.x), z: r1(p.z), v: r1(p.v), brk: p.brk > 0 ? 1 : 0, brakes: p.brakes, boost: p.boost > 0 ? 1 : 0, cd: r1(p.cd), skin: p.skin, hair: p.hair, fit: p.fit };
  });
  return {
    mode: 'versus', s: R.state, t: r1(R.timer), rd: R.round, att: R.att, sc: R.sc, hist: R.hist, msg: R.msg, sub: R.sub, el: r1(R.el),
    course: R.course || 0, bgGap: r1(bgGap), bgBx: r1(bgBx), bgBoost, names: R.names, fx: R.fx, P, obs: obsSnap(R)
  };
}

/* =====================================================================
   エンドレスラン（1人・どこまで行けるか）
   ===================================================================== */
const EN = { BASE: 130, MAX: 330, ACC: 2.4, STEER: 260 };
const LANES = [-84, -28, 28, 84];
const laneOf = x => LANES.reduce((a, b, i) => Math.abs(b - x) < Math.abs(LANES[a] - x) ? i : a, 0);

function resetEndless(R) {
  R.P = [{ x: 0, z: 0, v: EN.BASE, brk: 0, bcd: 0, boost: 0, cd: 0, brakes: 0, skin: R.skins[0], hair: R.hairs[0], fit: R.fits[0] }];
  R.obs = []; R.nid = 1; R.fx = null;
  R.inp = [{ l: 0, r: 0 }, { l: 0, r: 0 }]; R.act = [false, false]; R.actK = [null, null];
  R.state = 'count'; R.timer = 3; R.el = 0;
  R.score = 0; R.bonus = 0; R.combo = 0; R.comboT = 0; R.ev = [];
  R.nextCar = 1.2; R.nextCop = rnd(9, 13); R.sentOver = false; R.msg = ''; R.sub = '';
}
function spawnWave(R, p) {
  const lvl = Math.min(1, R.el / 150);
  const z = p.z + rnd(560, 640);
  // 既に近くにいる障害物の車線を調べ、必ず1車線は通れるようにする
  const used = new Set(R.obs.filter(o => o.k !== 'cop' && Math.abs(o.z - z) < 170).map(o => laneOf(o.x)));
  const free = [0, 1, 2, 3].filter(i => !used.has(i));
  if (free.length < 2) return;
  const keep = free[Math.floor(Math.random() * free.length)];
  const cand = free.filter(i => i !== keep).sort(() => Math.random() - 0.5);
  const r = Math.random();
  if (r < 0.12 + lvl * 0.06) { // 工事中のコーン
    const li = cand[0];
    for (let i = 0; i < 3; i++) addObs(R, 'cone', LANES[li] + rnd(-6, 6), z + i * 26, 0);
    return;
  }
  if (r < 0.24) { addObs(R, 'bus', LANES[cand[0]] * 0.98, z, rnd(35, 55)); return; } // 同じ向きの低速バス
  const n = Math.min(cand.length, Math.random() < 0.35 + lvl * 0.4 ? (Math.random() < lvl * 0.5 ? 3 : 2) : 1);
  for (let k = 0; k < n; k++) {
    const same = Math.random() < 0.3; // 同じ向きにゆっくり走る車
    addObs(R, 'car', LANES[cand[k]] + rnd(-8, 8), z + rnd(-30, 30), same ? rnd(40, 70) : -rnd(60, 110), Math.floor(rnd(0, 6)));
  }
}
function overEndless(R, kind, reason) {
  const p = R.P[0];
  R.state = 'over'; R.fx = { who: [0], kind }; R.msg = 'GAME OVER'; R.sub = reason;
  R.score = Math.floor(p.z / 10) + R.bonus;
  const res = submitScore(R.hostId, R.names[0], R.score);
  const coins = Math.floor(R.score / 40);
  const sid = R.ids[0];
  if (coins > 0) io.to(sid).emit('reward', { gain: coins });
  io.to(sid).emit('endless_over', { score: R.score, dist: Math.floor(p.z / 10), bonus: R.bonus, reason, kind, coins, best: res.best, rank: res.rank, improved: res.improved, top: topN(10) });
}
function stepEndless(R, dt) {
  if (R.state === 'count') { R.timer -= dt; if (R.timer <= 0) R.state = 'play'; return; }
  if (R.state !== 'play') return;
  R.el += dt;
  const p = R.P[0], inp = R.inp[0] || {};
  const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
  p.x = clamp(p.x + dir * EN.STEER * dt, -HW + 14, HW - 14);
  if (R.act[0]) {
    if (R.actK[0] === 'brake') { if (p.bcd <= 0) { p.brk = 0.7; p.bcd = 1.3; } }
    else if (p.cd <= 0 && p.boost <= 0) { p.boost = 1.3; p.cd = 4; }
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
    addObs(R, 'cop', LANES[laneOf(p.x)], p.z - 330, p.v + 90); // 自分の車線を狙って後ろから来る
  }
  for (const o of R.obs) { if (o.k === 'cop') o.vz = Math.max(o.vz, p.v + 75); o.z += o.vz * dt; }
  R.obs = R.obs.filter(o => o.z > p.z - 420 && o.z < p.z + 900);

  for (const o of R.obs) {
    if (o.k === 'cop') { if (copRule(o, p, true)) return overEndless(R, 'cop', 'パトカーの進路妨害で逮捕！'); continue; }
    if (hitObs(o, p)) return overEndless(R, 'car', o.k === 'cone' ? '工事現場に突っ込んだ！' : o.k === 'bus' ? 'バスに激突！' : '車と衝突！');
    if (!o.passed && o.z + o.l < p.z - BIKE_L) {
      o.passed = true;
      if (o.k !== 'cone' && Math.abs(o.x - p.x) < o.w + BIKE_W + 20) { // ニアミスボーナス
        R.combo++; R.comboT = 3.5;
        const b = 15 * Math.min(R.combo, 8);
        R.bonus += b; R.ev.push({ t: 'near', n: R.combo, b });
      }
    }
  }
  R.score = Math.floor(p.z / 10) + R.bonus;
}
function snapE(R) {
  const p = R.P[0];
  const s = {
    mode: 'endless', s: R.state, t: r1(R.timer), el: r1(R.el), course: R.course, names: R.names, fx: R.fx,
    score: R.score, combo: R.combo, rd: 0, att: 0, sc: [0, 0], hist: [], msg: R.msg, sub: R.sub,
    P: [{ x: r1(p.x), z: r1(p.z), v: r1(p.v), brk: p.brk > 0 ? 1 : 0, brakes: 0, boost: p.boost > 0 ? 1 : 0, cd: r1(p.cd), bcd: r1(p.bcd), skin: p.skin, hair: p.hair, fit: p.fit }],
    obs: obsSnap(R), ev: R.ev
  };
  R.ev = [];
  return s;
}

/* ===== ゲームループ（30Hz） ===== */
setInterval(() => {
  for (const R of rooms.values()) {
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

/* ===== フレンド機能：在席管理 ===== */
const byId = new Map();   // NM-ID -> socket.id
const owners = new Map(); // NM-ID -> 端末UUID（なりすまし防止の簡易チェック）
function statusOf(id) {
  const sid = byId.get(id), sk = sid && io.sockets.sockets.get(sid);
  if (!sk) return 'offline';
  const R = sk.data && rooms.get(sk.data.code);
  if (!R) return 'online';
  return (R.mode === 'versus' && !R.isCpu && !R.ids[1]) ? 'waiting' : 'playing';
}
function newRoom(code, socket, d, extra) {
  const L = look(d, 'プレイヤー');
  return Object.assign({
    code, ids: [socket.id, null], names: [L.name, 'プレイヤー2'], skins: [L.skin, 'default'], hairs: [L.hair, 'default'], fits: [L.fit, 'default'],
    course: cleanCourse(d && d.course), hostId: clean(d && d.id, ''), mode: 'versus', isCpu: false,
    inp: [{ l: 0, r: 0 }, { l: 0, r: 0 }], act: [false, false], actK: [null, null], state: 'wait', sc: [0, 0], hist: [], round: 0, P: [], obs: [], nid: 1
  }, extra || {});
}
function leaveRoom(socket) {
  const R = rooms.get(socket.data && socket.data.code);
  if (R) {
    const other = R.ids[1 - socket.data.slot];
    if (other) {
      io.to(other).emit('left');
      const os = io.sockets.sockets.get(other);
      if (os) os.data = {};
    }
    rooms.delete(R.code);
  }
  socket.data = {};
}
function joinRoom(socket, R, d, reply) {
  if (!R) return reply({ ok: false, err: 'ルームが見つかりません' });
  if (R.mode !== 'versus' || R.ids[1] || R.isCpu) return reply({ ok: false, err: 'ルームに参加できません' });
  if (R.ids[0] === socket.id) return reply({ ok: false, err: '自分のルームには参加できません' });
  leaveRoom(socket);
  const L = look(d, 'プレイヤー2');
  R.ids[1] = socket.id; R.names[1] = L.name; R.skins[1] = L.skin; R.hairs[1] = L.hair; R.fits[1] = L.fit;
  socket.data = { code: R.code, slot: 1 };
  resetMatch(R);
  reply({ ok: true });
  for (const i of [0, 1]) io.to(R.ids[i]).emit('start', { slot: i, course: R.course, mode: 'versus' });
}

io.on('connection', socket => {
  socket.data = {};
  const rp = cb => (typeof cb === 'function' ? cb : () => {});

  socket.on('hello', d => {
    const id = clean(d && d.id, ''), uid = cleanUid(d && d.uid);
    if (!id) return;
    const owner = owners.get(id), sid = byId.get(id);
    if (owner && uid && owner !== uid && sid && sid !== socket.id && io.sockets.sockets.get(sid)) { socket.emit('id_conflict'); return; }
    if (uid) owners.set(id, uid);
    socket.nmId = id; byId.set(id, socket.id);
  });

  socket.on('friends_status', (ids, cb) => {
    const o = {};
    (Array.isArray(ids) ? ids.slice(0, 50) : []).forEach(id => { if (typeof id === 'string') o[id] = statusOf(id); });
    rp(cb)(o);
  });

  socket.on('ranking', (d, cb) => { if (typeof d === 'function') cb = d; rp(cb)({ top: topN(30) }); });

  socket.on('solo', d => {
    leaveRoom(socket);
    const code = 'SOLO_' + socket.id;
    const R = newRoom(code, socket, d, { isCpu: true });
    R.names[1] = 'CPU';
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    resetMatch(R);
    socket.emit('start', { slot: 0, course: R.course, mode: 'versus' });
  });

  socket.on('endless', d => {
    leaveRoom(socket);
    const code = 'RUN_' + socket.id;
    const R = newRoom(code, socket, d, { mode: 'endless' });
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    resetEndless(R);
    socket.emit('start', { slot: 0, course: R.course, mode: 'endless' });
  });

  socket.on('create', (d, cb) => {
    if (typeof d === 'function') { cb = d; d = {}; }
    leaveRoom(socket);
    let code; do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
    const R = newRoom(code, socket, d);
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    rp(cb)({ code });
  });

  socket.on('join', (d, cb) => {
    const code = (d && typeof d === 'object') ? d.code : d;
    joinRoom(socket, rooms.get(String(code)), d, rp(cb));
  });

  // フレンドの部屋にワンタップ参加（部屋コード不要）
  socket.on('join_friend', (d, cb) => {
    const t = clean(d && d.targetId, '');
    const R = [...rooms.values()].find(r => t && r.hostId === t && r.mode === 'versus' && !r.ids[1] && !r.isCpu && r.ids[0] !== socket.id);
    if (!R) return rp(cb)({ ok: false, err: 'フレンドは現在ルームを作成していません' });
    joinRoom(socket, R, d, rp(cb));
  });

  socket.on('inp', d => {
    const R = rooms.get(socket.data.code);
    if (R) R.inp[socket.data.slot] = { l: !!(d && d.l), r: !!(d && d.r) };
  });

  socket.on('act', d => {
    const R = rooms.get(socket.data.code);
    if (!R) return;
    R.act[socket.data.slot] = true;
    R.actK[socket.data.slot] = (d && d.k === 'brake') ? 'brake' : 'boost';
  });

  socket.on('again', () => {
    const R = rooms.get(socket.data.code);
    if (!R) return;
    if (R.mode === 'endless') { if (R.state === 'over') resetEndless(R); }
    else if (R.state === 'match') resetMatch(R);
  });

  socket.on('leave', () => leaveRoom(socket));

  socket.on('disconnect', () => {
    if (socket.nmId && byId.get(socket.nmId) === socket.id) byId.delete(socket.nmId);
    leaveRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('listening on ' + PORT));
