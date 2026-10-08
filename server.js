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
  R.s = 'count';
  R.t = 3;
  R.el = 0;
  R.att = attOf(R.rd);
  const a = R.att, d = 1 - a;
  R.P[a] = mk(0, HW);
  R.P[d] = mk(0, 0);
  R.obs = [];
  R.lastAct = R.lastEvent = null;
}

function genObs(R) {
  if (R.obs.length < 5) {
    const maxZ = R.obs.reduce((m, o) => Math.max(m, o.z), Math.max(R.P[0].z, R.P[1].z));
    R.obs.push({
      id: Math.random(),
      x: rnd(-80, 80), // 道路幅半減に合わせて障害物の出現範囲を調整 (-80~80)
      z: maxZ + rnd(150, 250),
      w: 24,
      h: 24,
      type: Math.random() < 0.5 ? 'pylon' : 'oil'
    });
  }
}

function genCode() {
  let c;
  do { c = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(c));
  return c;
}

io.on('connection', socket => {
  let room = null, slot = -1;

  socket.on('joinBot', cb => {
    const code = 'BOT_' + socket.id.slice(0, 4);
    room = {
      code, isBot: true, players: [{ id: socket.id, slot: 0 }, { id: 'BOT', slot: 1 }],
      s: 'count', t: 3, rd: 0, att: 0, sc: [0, 0], hist: [], msg: '', sub: '', el: 0,
      P: [mk(0, HW), mk(0, 0)], obs: []
    };
    rooms.set(code, room);
    slot = 0;
    socket.join(code);
    newRound(room);
    if (typeof cb === 'function') cb({ ok: true, code });
    socket.emit('start', { slot: 0 });
  });

  socket.on('create', cb => {
    const code = genCode();
    room = {
      code, isBot: false, players: [{ id: socket.id, slot: 0 }],
      s: 'count', t: 3, rd: 0, att: 0, sc: [0, 0], hist: [], msg: '', sub: '', el: 0,
      P: [mk(0, HW), mk(0, 0)], obs: []
    };
    rooms.set(code, room);
    slot = 0;
    socket.join(code);
    if (typeof cb === 'function') cb({ ok: true, code });
  });

  socket.on('join', (code, cb) => {
    const R = rooms.get(code);
    if (!R || R.players.length >= 2) return cb && cb({ ok: false, err: '参加不可' });
    R.players.push({ id: socket.id, slot: 1 });
    room = R; slot = 1;
    socket.join(code);
    newRound(R);
    if (cb) cb({ ok: true });
    R.players.forEach(p => io.to(p.id).emit('start', { slot: p.slot }));
  });

  socket.on('inp', d => {
    if (!room || slot < 0) return;
    const p = room.P[slot];
    if (p) {
      // 道路の幅を半分にしたため移動範囲制限を修正 (-110 ~ 110)
      if (d.l) p.x = Math.max(-110, p.x - 4);
      if (d.r) p.x = Math.min(110, p.x + 4);
    }
  });

  socket.on('act', () => {
    if (!room || room.s !== 'play' || slot < 0) return;

    // 【追加要素】ラウンド開始から5秒間はアクション使用不可
    if (room.el < 5.0) return;

    const p = room.P[slot];
    const isAtt = room.att === slot;

    if (isAtt) {
      if (p.brakes > 0
