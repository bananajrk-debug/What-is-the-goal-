const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const rooms = {};

function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function initRoom(code) {
  return {
    code,
    players: [],
    sockets: [],
    s: 'lobby',
    t: 0,
    rd: 0,
    att: 0,
    sc: [0, 0],
    hist: [],
    msg: '',
    sub: '',
    el: 0,
    obs: [],
    isBot: false,
    botSlot: -1,
    lastEvent: null
  };
}

function resetRound(r) {
  r.att = r.rd % 2;
  const def = 1 - r.att;
  r.P = [];
  r.P[r.att] = { x: 0, z: 300, v: 220, brk: false, brakes: 3, boost: false, cd: 0, inp: { l: 0, r: 0 } };
  r.P[def] = { x: 0, z: 0, v: 220, brk: false, brakes: 3, boost: false, cd: 0, inp: { l: 0, r: 0 } };
  r.obs = [];
  r.s = 'count';
  r.t = 3;
  r.el = 0;
  r.lastEvent = null;
  
  spawnObs(r, 900);
}

function spawnObs(r, startZ) {
  const leftLanes = [-90, -50];
  const x = leftLanes[Math.floor(Math.random() * leftLanes.length)];
  const maxZ = r.obs.length > 0 ? Math.max(...r.obs.map(o => o.z)) : Math.max(r.P[0]?.z || 0, r.P[1]?.z || 0);
  const z = startZ || (maxZ + 1100 + Math.random() * 600);
  const isCop = Math.random() < 0.25;
  r.obs.push({
    id: Math.random().toString(36).substr(2, 9),
    x,
    z,
    v: isCop ? 230 : 170 + Math.random() * 35,
    k: isCop ? 'cop' : 'car',
    c: Math.floor(Math.random() * 5)
  });
}

function updateBot(r) {
  if (!r.isBot || r.s !== 'play') return;
  const botIdx = r.botSlot;
  const me = r.P[botIdx];
  const enemy = r.P[1 - botIdx];
  if (!me || !enemy) return;

  const isAttacker = (r.att === botIdx);
  
  let avoidX = 0;
  const dangerObs = r.obs.find(o => o.z > me.z && o.z - me.z < 220 && Math.abs(o.x - me.x) < 45);
  if (dangerObs) {
    avoidX = me.x > dangerObs.x ? 1 : -1;
  }

  if (avoidX !== 0) {
    me.inp.l = avoidX < 0 ? 1 : 0;
    me.inp.r = avoidX > 0 ? 1 : 0;
    return;
  }

  if (isAttacker) {
    const wave = Math.sin(r.el * 3.5) * 55;
    const targetX = enemy.x + wave;
    
    me.inp.l = me.x > targetX + 8 ? 1 : 0;
    me.inp.r = me.x < targetX - 8 ? 1 : 0;

    const dist = me.z - enemy.z;
    const relX = Math.abs(me.x - enemy.x);
    if (dist > 5 && dist < 100 && relX < 45 && me.brakes > 0 && !me.brk) {
      if (Math.random() < 0.22) {
        me.brk = true;
        me.brakes--;
        r.lastAct = 'brake';
        setTimeout(() => { me.brk = false; }, 600);
      }
    }
  } else {
    const wave = Math.cos(r.el * 2.8) * 80;
    const dodge = (enemy.x >= 0 ? -60 : 60);
    const targetX = enemy.x + dodge + wave;

    me.inp.l = me.x > targetX + 8 ? 1 : 0;
    me.inp.r = me.x < targetX - 8 ? 1 : 0;

    const dist = enemy.z - me.z;
    if (me.cd <= 0 && !me.boost) {
      if (dist > 20 && dist < 320) {
        me.boost = true;
        me.cd = 3.5;
        r.lastAct = 'boost';
        setTimeout(() => { me.boost = false; }, 800);
      }
    }
  }
}

function endRound(r, winner, msg, sub, sound) {
  if (r.s === 'result' || r.s === 'match') return;
  r.s = 'result';
  r.t = 2.5;
  r.lastEvent = sound;
  r.sc[winner]++;
  r.hist.push(winner);
  r.msg = msg;
  r.sub = sub;
}

io.on('connection', socket => {
  socket.on('joinBot', cb => {
    const code = genCode();
    const r = initRoom(code);
    r.isBot = true;
    r.botSlot = 1;
    r.sockets = [socket];
    rooms[code] = r;
    socket.join(code);
    socket.roomCode = code;
    socket.playerSlot = 0;

    resetRound(r);
    cb({ ok: true });
    socket.emit('start', { slot: 0 });
  });

  socket.on('create', cb => {
    const code = genCode();
    const r = initRoom(code);
    r.sockets = [socket];
    rooms[code] = r;
    socket.join(code);
    socket.roomCode = code;
    socket.playerSlot = 0;
    cb({ ok: true, code });
  });

  socket.on('join', (code, cb) => {
    const r = rooms[code];
    if (!r || r.sockets.length >= 2 || r.s !== 'lobby') {
      return cb({ ok: false, err: 'ルームが見つからないか満員です' });
    }
    r.sockets.push(socket);
    socket.join(code);
    socket.roomCode = code;
    socket.playerSlot = 1;
    cb({ ok: true });

    resetRound(r);
    r.sockets[0].emit('start', { slot: 0 });
    r.sockets[1].emit('start', { slot: 1 });
  });

  socket.on('inp', d => {
    const r = rooms[socket.roomCode];
    if (!r || r.s !== 'play') return;
    const p = r.P[socket.playerSlot];
    if (p) p.inp = d;
  });

  socket.on('act', () => {
    const r = rooms[socket.roomCode];
    if (!r || r.s !== 'play') return;
    const p = r.P[socket.playerSlot];
    if (!p) return;

    if (r.att === socket.playerSlot) {
      if (p.brakes > 0 && !p.brk) {
        p.brk = true;
        p.brakes--;
        r.lastAct = 'brake';
        setTimeout(() => { p.brk = false; }, 600);
      }
    } else {
      if (p.cd <= 0 && !p.boost) {
        p.boost = true;
        p.cd = 3.5;
        r.lastAct = 'boost';
        setTimeout(() => { p.boost = false; }, 800);
      }
    }
  });

  socket.on('again', () => {
    const r = rooms[socket.roomCode];
    if (!r || r.s !== 'match') return;
    r.sc = [0, 0];
    r.hist = [];
    r.rd = 0;
    resetRound(r);
  });

  socket.on('leave', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      socket.to(code).emit('left');
      delete rooms[code];
    }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      socket.to(code).emit('left');
      delete rooms[code];
    }
  });
});

setInterval(() => {
  const dt = 1 / 60;
  Object.keys(rooms).forEach(code => {
    const r = rooms[code];
    if (!r || r.s === 'lobby') return;

    if (r.s === 'count') {
      r.t -= dt;
      if (r.t <= 0) {
        r.s = 'play';
        r.el = 0;
      }
    } else if (r.s === 'result') {
      r.t -= dt;
      if (r.t <= 0) {
        if (r.sc[0] >= 4 || r.sc[1] >= 4 || r.rd >= 7) {
          r.s = 'match';
          const winner = r.sc[0] >= r.sc[1] ? 0 : 1;
          r.msg = (winner === 0 ? 'P1' : 'P2') + ' の勝利！';
          r.sub = '最終スコア: ' + r.sc[0] + ' - ' + r.sc[1];
        } else {
          r.rd++;
          resetRound(r);
        }
      }
    } else if (r.s === 'play') {
      r.el += dt;
      updateBot(r);

      r.obs.forEach(o => { o.z += o.v * dt; });
      r.obs = r.obs.filter(o => o.z < Math.max(...r.P.map(p => p ? p.z : 0)) + 1200);
      
      if (r.obs.length < 2) spawnObs(r);

      r.P.forEach((p) => {
        if (!p) return;
        if (p.cd > 0) p.cd -= dt;

        let targetV = 220;
        if (p.brk) targetV = 60;
        if (p.boost) targetV = 360;

        p.v += (targetV - p.v) * dt * 6;
        p.z += p.v * dt;

        let moveX = 0;
        if (p.inp.l) moveX -= 140;
        if (p.inp.r) moveX += 140;
        p.x += moveX * dt;
        p.x = Math.max(-130, Math.min(130, p.x));
      });

      const attP = r.P[r.att];
      const defP = r.P[1 - r.att];
      if (attP && defP) {
        r.sound = {
          dist: attP.z - defP.z,
          relX: defP.x - attP.x,
          boosting: defP.boost
        };
      }

      const A = r.P[r.att], B = r.P[1 - r.att];
      if (A && B) {
        if (B.z > A.z + 15) {
          endRound(r, 1 - r.att, '追越成功！', 'BがAを華麗に抜き去った！', 'win');
        } else {
          const distZ = Math.abs(A.z - B.z);
          const distX = Math.abs(A.x - B.x);

          if (distZ < 25 && distX < 28) {
            if (A.brk) {
              endRound(r, r.att, '撃墜成功！', 'BはAの急ブレーキに激突した！', 'crash');
            } else {
              endRound(r, r.att, '追突事故！', 'Bは回避せず真後ろから激突した！', 'crash');
            }
          } else {
            [A, B].forEach((p, idx) => {
              r.obs.forEach(o => {
                if (Math.abs(p.z - o.z) < 22 && Math.abs(p.x - o.x) < 26) {
                  const winner = 1 - idx;
                  endRound(r, winner, 'クラッシュ！', (idx === r.att ? 'A' : 'B') + 'が障害物に激突！', 'crash');
                }
              });
            });
          }
        }
      }
    }

    io.to(code).emit('st', r);
    r.lastAct = null;
  });
}, 1000 / 60);

server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
