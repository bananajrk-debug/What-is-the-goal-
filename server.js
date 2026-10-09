const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(__dirname + '/public'));
const server = http.createServer(app);
const io = new Server(server);

const BASE = 110, HW = 112.5, LIMIT = 25, TICK = 1 / 30;
const rooms = new Map();
const attOf = r => (r < 3 ? 0 : r < 6 ? 1 : r % 2);
const rnd = (a, b) => a + Math.random() * (b - a);
const mk = (x, z) => ({ x, z, v: BASE, brk: 0, brakes: 3, boost: 0, cd: 0 });

function newRound(R) {
  R.att = attOf(R.round);
  const d = 1 - R.att;
  R.P = [];
  R.P[R.att] = mk(rnd(-30, 30), 60);
  R.P[d] = mk(rnd(-30, 30), 0);
  R.obs = []; R.nid = 1;
  R.inp = [{ l: 0, r: 0 }, { l: 0, r: 0 }];
  R.act = [false, false];
  R.state = 'count'; R.timer = 3; R.el = 0;
  R.nextCar = rnd(2, 3.5);
  R.patrolAt = Math.random() < 0.7 ? rnd(5, 12) : 1e9;
  R.msg = ''; R.sub = '';
}

function resetMatch(R) {
  R.sc = [0, 0]; R.hist = []; R.round = 0; newRound(R);
}

function endRound(R, w, pen, text) {
  if (w >= 0) R.sc[w]++;
  if (pen >= 0) R.sc[pen] = Math.max(0, R.sc[pen] - 1);
  R.hist.push(w);
  R.msg = w >= 0 ? 'POINT GET!' : 'DRAW';
  const name = R.names ? R.names[w] : ('プレイヤー' + (w + 1));
  R.sub = (w >= 0 ? name + '  ' : '') + text;
  R.state = 'result'; R.timer = 2.5;
}

function afterResult(R) {
  const w = R.hist[R.hist.length - 1];
  if (w >= 0 && (R.sc[w] >= 4 || R.round >= 6)) {
    R.state = 'match';
    const wName = R.names ? R.names[w] : ('プレイヤー' + (w + 1));
    R.msg = 'MATCH WINNER: ' + wName;
    R.sub = R.round >= 6 ? 'サドンデス決着' : '';
    return;
  }
  R.round++; newRound(R);
}

function updateCpuInp(R) {
  if (!R.isCpu || R.state !== 'play') return;
  const cpuSlot = 1;
  const cpuP = R.P[cpuSlot];
  const playerP = R.P[0];
  if (!cpuP) return;

  let targetX = cpuP.x;

  const aheadCars = R.obs.filter(o => o.z > cpuP.z && o.z - cpuP.z < 260);
  if (aheadCars.length > 0) {
    aheadCars.sort((a, b) => a.z - b.z);
    const danger = aheadCars[0];
    if (Math.abs(danger.x - cpuP.x) < 32) {
      targetX = danger.x > 0 ? danger.x - 55 : danger.x + 55;
      targetX = Math.max(-HW + 14, Math.min(HW - 14, targetX));
    }
  } else if (playerP) {
    const isAtt = R.att === cpuSlot;
    if (isAtt) {
      const sway = Math.sin(R.el * 3) * 45;
      targetX = playerP.x + sway;
      targetX = Math.max(-HW + 14, Math.min(HW - 14, targetX));
    } else {
      const zGap = playerP.z - cpuP.z;
      if (zGap < 50) {
        const side = playerP.x > 0 ? -50 : 50;
        targetX = playerP.x + side;
      } else {
        targetX = playerP.x;
      }
      targetX = Math.max(-HW + 14, Math.min(HW - 14, targetX));
    }
  }

  const dx = targetX - cpuP.x;
  R.inp[cpuSlot] = { l: dx < -4, r: dx > 4 };

  if (R.el >= 3) {
    const isAtt = R.att === cpuSlot;
    if (isAtt) {
      if (playerP && Math.abs(playerP.x - cpuP.x) < 30 && (cpuP.z - playerP.z) < 40 && cpuP.brakes > 0 && cpuP.brk <= 0) {
        if (Math.random() < 0.35) R.act[cpuSlot] = true;
      }
    } else {
      if (cpuP.cd <= 0 && cpuP.boost <= 0) {
        R.act[cpuSlot] = true;
      }
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

  for (const i of [0, 1]) {
    const p = R.P[i], inp = R.inp[i] || {};
    const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    p.x = Math.max(-HW + 14, Math.min(HW - 14, p.x + dir * (i === att ? 285 : 230) * dt));
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
    R.obs.push({ id: R.nid++, k: 'car', x: rnd(-HW + 20, HW - 20), z: front + rnd(360, 420), vz: -90, c: Math.floor(rnd(0, 5)) });
  }
  if (R.el >= R.patrolAt) {
    R.patrolAt = 1e9;
    R.obs.push({ id: R.nid++, k: 'cop', x: rnd(-HW + 25, HW - 25), z: back - 260, vz: 175, c: 0 });
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
  if (lost[0] && lost[1]) return endRound(R, -1, -1, '相打ち！');
  for (const i of [0, 1]) if (lost[i]) {
    const name = R.names ? R.names[i] : ('プレイヤー' + (i + 1));
    return lost[i] === 'cop'
      ? endRound(R, 1 - i, i, name + ' パトカー違反で逮捕！(-1pt)')
      : endRound(R, 1 - i, -1, name + ' 車と衝突！');
  }

  const gap = A.z - B.z, dx = Math.abs(A.x - B.x);
  if (dx < 22 && gap < 18 && gap > -12) {
    return endRound(R, att, -1, '攻撃側に激突！');
  }

  if (B.z > A.z + 12) return endRound(R, d, -1, '追い抜き成功！');
  if (R.el >= LIMIT) endRound(R, att, -1, 'ブロック成功(時間切れ)');
}

const r1 = n => Math.round(n * 10) / 10;
function snap(R, slot) {
  const att = R.att, d = 1 - att;
  const bgGap = (R.P && R.P[att] && R.P[d]) ? Math.max(0, R.P[att].z - R.P[d].z) : 999;
  const bgBx = (R.P && R.P[d]) ? R.P[d].x : 0;
  const bgBoost = (R.P && R.P[d]) ? R.P[d].boost > 0 : false;

  const P = (R.P || []).map((p, i) => {
    if (!p) return null;
    const isAttacker = slot === att;
    const isTargetOpponent = i !== slot;
    if ((R.state === 'play' || R.state === 'count') && isAttacker && isTargetOpponent && p.boost <= 0) {
      return null;
    }
    return { x: r1(p.x), z: r1(p.z), v: r1(p.v), brk: p.brk > 0 ? 1 : 0, brakes: p.brakes, boost: p.boost > 0 ? 1 : 0, cd: r1(p.cd) };
  });

  return { 
    s: R.state, t: r1(R.timer), rd: R.round, att: R.att, sc: R.sc, hist: R.hist, msg: R.msg, sub: R.sub, el: r1(R.el),
    bgGap: r1(bgGap), bgBx: r1(bgBx), bgBoost, names: R.names,
    P, obs: (R.obs || []).map(o => ({ id: o.id, k: o.k, x: r1(o.x), z: r1(o.z), c: o.c })) 
  };
}

setInterval(() => {
  for (const R of rooms.values()) {
    if (!R.isCpu && !R.ids[1]) continue;
    step(R, TICK);
    for (const i of [0, 1]) {
      if (R.ids[i]) io.to(R.ids[i]).emit('st', snap(R, i));
    }
  }
}, TICK * 1000);

io.on('connection', socket => {
  socket.on('solo', d => {
    let code = 'SOLO_' + socket.id;
    const pName = (d && d.name) ? d.name : 'プレイヤー';
    const R = { code, ids: [socket.id, null], names: [pName, 'CPU'], isCpu: true, inp: [{ l: 0, r: 0 }, { l: 0, r: 0 }], act: [false, false], state: 'wait', sc: [0, 0], hist: [], round: 0, P: [], obs: [] };
    rooms.set(code, R);
    socket.data = { code, slot: 0 };
    resetMatch(R);
    socket.emit('start', { slot: 0 });
  });

  socket.on('create', (d, cb) => {
    if (typeof d === 'function') { cb = d; d = {}; }
    let code; do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
    const pName = (d && d.name) ? d.name : 'プレイヤー1';
    rooms.set(code, { code, ids: [socket.id, null], names: [pName, 'プレイヤー2'], isCpu: false, inp: [{ l: 0, r: 0 }, { l: 0, r: 0 }], act: [false, false], state: 'wait', sc: [0, 0], hist: [], round: 0, P: [], obs: [] });
    socket.data = { code, slot: 0 };
    if (typeof cb === 'function') cb({ code });
  });

  socket.on('join', (d, cb) => {
    const code = (typeof d === 'object') ? d.code : d;
    const pName = (typeof d === 'object' && d.name) ? d.name : 'プレイヤー2';
    const R = rooms.get(String(code));
    if (!R) { if (typeof cb === 'function') cb({ ok: false, err: 'ルームが見つかりません' }); return; }
    if (R.ids[1] || R.isCpu) { if (typeof cb === 'function') cb({ ok: false, err: 'ルームに参加できません' }); return; }
    R.ids[1] = socket.id;
    R.names[1] = pName;
    socket.data = { code: R.code, slot: 1 };
    resetMatch(R);
    if (typeof cb === 'function') cb({ ok: true });
    for (const i of [0, 1]) io.to(R.ids[i]).emit('start', { slot: i });
  });

  socket.on('inp', d => {
    const R = rooms.get(socket.data && socket.data.code);
    if (R && socket.data) R.inp[socket.data.slot] = { l: !!(d && d.l), r: !!(d && d.r) };
  });

  socket.on('act', () => {
    const R = rooms.get(socket.data && socket.data.code);
    if (R && socket.data) R.act[socket.data.slot] = true;
  });

  socket.on('again', () => {
    const R = rooms.get(socket.data && socket.data.code);
    if (R && R.state === 'match') resetMatch(R);
  });

  socket.on('leave', () => {
    const R = rooms.get(socket.data && socket.data.code);
    if (!R) return;
    const other = R.ids[1 - socket.data.slot];
    if (other) io.to(other).emit('left');
    rooms.delete(R.code);
  });

  socket.on('disconnect', () => {
    const R = rooms.get(socket.data && socket.data.code);
    if (!R) return;
    const other = R.ids[1 - socket.data.slot];
    if (other) io.to(other).emit('left');
    rooms.delete(R.code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('listening on ' + PORT));
