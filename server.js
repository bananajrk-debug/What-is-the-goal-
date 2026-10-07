// なにが目的なん？ オンライン対戦サーバー (Express + Socket.io)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(__dirname + '/public'));
const server = http.createServer(app);
const io = new Server(server);

const BASE = 110, HW = 150, LIMIT = 25, TICK = 1 / 30;
const rooms = new Map();
const attOf = r => (r < 3 ? 0 : r < 6 ? 1 : r % 2);
const rnd = (a, b) => a + Math.random() * (b - a);
const mk = (x, z) => ({ x, z, v: BASE, brk: 0, brakes: 3, boost: 0, cd: 0 });

function newRound(R) {
  R.att = attOf(R.round);
  const d = 1 - R.att;
  R.P = [];
  R.P[R.att] = mk(rnd(-40, 40), 60);
  R.P[d] = mk(rnd(-40, 40), 0);
  R.obs = []; R.nid = 1;
  R.state = 'count'; R.timer = 3; R.el = 0;
  R.nextCar = rnd(2, 3.5);
  R.patrolAt = Math.random() < 0.7 ? rnd(5, 12) : 1e9;
  R.msg = ''; R.sub = '';
}

function resetMatch(R) {
  R.sc = [0, 0]; R.hist = []; R.round = 0; newRound(R);
}

function endRound(R, w, pen, text, eventType) {
  if (w >= 0) R.sc[w]++;
  if (pen >= 0) R.sc[pen] = Math.max(0, R.sc[pen] - 1);
  R.hist.push(w);
  R.msg = w >= 0 ? 'POINT GET!' : 'DRAW';
  R.sub = (w >= 0 ? 'プレイヤー' + (w + 1) + '  ' : '') + text;
  if(R.isBot && w === 1) R.sub = 'NPC(BOT)  ' + text;
  R.state = 'result'; R.timer = 2.5;
  R.lastEvent = eventType || 'crash';
}

function afterResult(R) {
  const w = R.hist[R.hist.length - 1];
  if (w >= 0 && (R.sc[w] >= 4 || R.round >= 6)) {
    R.state = 'match';
    R.msg = 'MATCH WINNER: ' + (w === 1 && R.isBot ? 'NPC(BOT)' : 'プレイヤー' + (w + 1));
    R.sub = R.round >= 6 ? 'サドンデス決着' : '';
    return;
  }
  R.round++; newRound(R);
}

// NPC (BOT) のAIロジック
function runBotAI(R) {
  if (R.state !== 'play' || !R.isBot) return;
  const botSlot = 1, pSlot = 0;
  const me = R.P[botSlot], opp = R.P[pSlot], inp = R.inp[botSlot];
  const isA = (R.att === botSlot);

  // 障害物回避
  let targetX = isA ? 0 : (opp.x > 0 ? opp.x - 40 : opp.x + 40);
  const threat = R.obs.find(o => o.z > me.z && o.z < me.z + 180 && Math.abs(o.x - me.x) < 30);
  if (threat) targetX = threat.x > 0 ? threat.x - 50 : threat.x + 50;

  inp.l = me.x > targetX + 5;
  inp.r = me.x < targetX - 5;

  // アクション判断
  if (isA) {
    const gap = me.z - opp.z;
    if (gap > 0 && gap < 70 && Math.abs(me.x - opp.x) < 25 && me.brakes > 0 && Math.random() < 0.05) R.act[botSlot] = true;
  } else {
    const gap = opp.z - me.z;
    if (gap > 10 && gap < 90 && Math.abs(me.x - opp.x) >= 20 && me.cd <= 0) R.act[botSlot] = true;
  }
}

function step(R, dt) {
  if (R.state === 'count') { R.timer -= dt; if (R.timer <= 0) R.state = 'play'; return; }
  if (R.state === 'result') { R.timer -= dt; if (R.timer <= 0) afterResult(R); return; }
  if (R.state !== 'play') return;
  
  runBotAI(R); // BOTの思考更新

  R.el += dt;
  const att = R.att, d = 1 - att, A = R.P[att], B = R.P[d];

  for (const i of [0, 1]) {
    const p = R.P[i], inp = R.inp[i];
    const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    p.x = Math.max(-HW + 14, Math.min(HW - 14, p.x + dir * (i === att ? 190 : 230) * dt));
  }
  if (R.act[att] && A.brakes > 0 && A.brk <= 0) { A.brakes--; A.brk = 0.8; R.lastAct = 'brake'; }
  if (R.act[d] && B.cd <= 0 && B.boost <= 0) { B.boost = 1; B.cd = 3.5; R.lastAct = 'boost'; }
  R.act = [false, false];

  if (A.brk > 0) { A.v = Math.max(0, A.v - 800 * dt); A.brk -= dt; } else A.v = Math.min(BASE, A.v + 120 * dt);
  if (B.boost > 0) { B.v = Math.min(220, B.v + 600 * dt); B.boost -= dt; } else B.v = Math.max(BASE, B.v - 300 * dt);
  B.cd = Math.max(0, B.cd - dt);
  A.z += A.v * dt; B.z += B.v * dt;

  const front = Math.max(A.z, B.z), back = Math.min(A.z, B.z);
  R.nextCar -= dt;
  if (R.nextCar <= 0) {
    R.nextCar = rnd(2, 3.8);
    R.obs.push({ id: R.nid++, k: 'car', x: rnd(-115, 115), z: front + rnd(360, 420), vz: -90, c: Math.floor(rnd(0, 5)) });
  }
  if (R.el >= R.patrolAt) {
    R.patrolAt = 1e9;
    R.obs.push({ id: R.nid++, k: 'cop', x: rnd(-100, 100), z: back - 260, vz: 175, c: 0 });
  }
  for (const o of R.obs) o.z += o.vz * dt;
  R.obs = R.obs.filter(o => (o.k === 'car' ? o.z > back - 100 : o.z < front + 220));

  const lost = [null, null];
  for (const o of R.obs) for (const i of [0, 1]) {
    const p = R.P[i], dx = Math.abs(o.x - p.x);
    if (o.k === 'car' && dx < 24 && Math.abs(o.z - p.z) < 14) lost[i] = lost[i] || 'car';
    if (o.k === 'cop') {
      const gap = p.z - o.z;
      const cutIn = dx < 28 && gap > -16 && gap < 30;
      const blocked = i === att && p.brk > 0 && dx < 30 && gap > 0 && gap < 70;
      if (cutIn || blocked) lost[i] = 'cop';
    }
  }
  if (lost[0] && lost[1]) return endRound(R, -1, -1, '相打ち！', 'crash');
  for (const i of [0, 1]) if (lost[i]) {
    return lost[i] === 'cop'
      ? endRound(R, 1 - i, i, (R.isBot && i===1 ? 'NPC' : 'プレイヤー' + (i + 1)) + ' 逮捕(-1pt)', 'siren')
      : endRound(R, 1 - i, -1, (R.isBot && i===1 ? 'NPC' : 'プレイヤー' + (i + 1)) + ' 車と衝突！', 'crash');
  }

  const gap = A.z - B.z, dx = Math.abs(A.x - B.x);
  if (dx < 22 && gap < 18 && gap > -12) {
    if (A.brk > 0 || B.boost > 0 || A.v < BASE * 0.6) {
      const reason = (A.brk > 0) ? '急ブレーキで撃墜！' : (B.boost > 0 ? 'ブースト追突事故！(横に避けて抜け)' : '前方車に激突！');
      return endRound(R, att, -1, reason, 'crash');
    }
    B.z = A.z - 18; B.v = Math.min(B.v, A.v);
  }

  if (B.z > A.z + 16) return endRound(R, d, -1, '追い抜き成功！', 'win');
  if (R.el >= LIMIT) endRound(R, att, -1, 'ブロック成功(時間切れ)', 'win');
}

const r1 = n => Math.round(n * 10) / 10;
function snap(R, slot) {
  const isA = (slot === R.att);
  const hide = (R.state === 'play' || R.state === 'count') && isA;
  const P = R.P.map((p, i) => (hide && i !== slot) ? null :
    { x: r1(p.x), z: r1(p.z), v: r1(p.v), brk: p.brk > 0 ? 1 : 0, brakes: p.brakes, boost: p.boost > 0 ? 1 : 0, cd: r1(p.cd) });

  let sound = null;
  if (isA && R.P[0] && R.P[1]) sound = { relX: r1(R.P[1 - R.att].x - R.P[R.att].x), dist: r1(R.P[R.att].z - R.P[1 - R.att].z), boosting: R.P[1 - R.att].boost > 0 };

  const snapData = {
    s: R.state, t: r1(R.timer), rd: R.round, att: R.att, sc: R.sc, hist: R.hist, msg: R.msg, sub: R.sub, el: r1(R.el),
    P, obs: R.obs.map(o => ({ id: o.id, k: o.k, x: r1(o.x), z: r1(o.z), c: o.c })),
    sound, lastAct: R.lastAct || null, lastEvent: R.lastEvent || null, isBot: R.isBot
  };
  if(slot === 0) { R.lastAct = null; R.lastEvent = null; }
  return snapData;
}

setInterval(() => {
  for (const [code, R] of rooms.entries()) {
    if (!R.ids[1]) continue;
    step(R, TICK);
    for (const i of [0, 1]) {
      if (R.ids[i] && R.ids[i] !== 'BOT') io.to(R.ids[i]).emit('st', snap(R, i));
    }
  }
}, TICK * 1000);

io.on('connection', socket => {
  socket.on('create', cb => {
    let code; do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
    rooms.set(code, { code, ids: [socket.id, null], inp: [{}, {}], act: [false, false], state: 'wait', sc: [0, 0], hist: [], round: 0, P: [], obs: [], isBot: false });
    socket.data = { code, slot: 0 };
    cb({ code });
  });
  
  socket.on('joinBot', cb => {
    let code; do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
    const R = { code, ids: [socket.id, 'BOT'], inp: [{}, {}], act: [false, false], state: 'wait', sc: [0, 0], hist: [], round: 0, P: [], obs: [], isBot: true };
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    resetMatch(R);
    cb({ ok: true });
    io.to(socket.id).emit('start', { slot: 0 });
  });

  socket.on('join', (code, cb) => {
    const R = rooms.get(String(code));
    if (!R) return cb({ ok: false, err: 'ルームが見つかりません' });
    if (R.ids[1]) return cb({ ok: false, err: 'ルームは満員です' });
    R.ids[1] = socket.id; socket.data = { code: R.code, slot: 1 };
    resetMatch(R);
    cb({ ok: true });
    for (const i of [0, 1]) io.to(R.ids[i]).emit('start', { slot: i });
  });

  socket.on('inp', d => {
    const R = rooms.get(socket.data?.code);
    if (R) R.inp[socket.data.slot] = { l: !!d?.l, r: !!d?.r };
  });
  socket.on('act', () => {
    const R = rooms.get(socket.data?.code);
    if (R) R.act[socket.data.slot] = true;
  });
  socket.on('again', () => {
    const R = rooms.get(socket.data?.code);
    if (R && R.state === 'match') resetMatch(R);
  });
  
  // ロビーに戻る処理
  socket.on('leave', () => {
    const R = rooms.get(socket.data?.code);
    if (R) {
      const other = R.ids[1 - socket.data.slot];
      if (other && other !== 'BOT') io.to(other).emit('left');
      rooms.delete(R.code);
    }
    socket.data = null;
  });

  socket.on('disconnect', () => {
    const R = rooms.get(socket.data?.code);
    if (R) {
      const other = R.ids[1 - socket.data.slot];
      if (other && other !== 'BOT') io.to(other).emit('left');
      rooms.delete(R.code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
