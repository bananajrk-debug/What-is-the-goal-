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

// ★障害物車両の速度を大幅に引き上げ (170~210)
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
    v: isCop ? 230 : 170 + Math.random() * 35, // スピードアップ
    k: isCop ? 'cop' : 'car',
    c: Math.floor(Math.random() * 5)
  });
}

// ★CPU (Bot) AIの強化：積極的に動くように改善
function updateBot(r) {
  if (!r.isBot || r.s !== 'play') return;
  const botIdx = r.botSlot;
  const me = r.P[botIdx];
  const enemy = r.P[1 - botIdx];
  if (!me || !enemy) return;

  const isAttacker = (r.att === botIdx);
  
  // 障害物の緊急回避
  let avoidX = 0;
  const dangerObs = r.obs.find(o => o.z > me.z && o.z - me.z < 220 && Math.abs(o.x - me.x) < 45);
  if (dangerObs) {
    avoidX = me.x > dangerObs.x ? 1 : -1;
  }

  if (isAttacker) {
    // 攻撃側：敵の正面を積極的に塞ぎに行く・急ブレーキをアグレッシブに使用
    if (avoidX !== 0) {
      me.inp.l = avoidX < 0 ? 1 : 0;
      me.inp.r = avoidX > 0 ? 1 : 0;
    } else {
      const targetX = enemy.x;
      const diffX = targetX - me.x;
      me.inp.l = diffX < -10 ? 1 : 0;
      me.inp.r = diffX > 10 ? 1 : 0;
    }

    const dist = me.z - enemy.z;
    const relX = Math.abs(me.x - enemy.x);
    // 敵が背後に迫ってきたら頻繁にブレーキをかける
    if (dist > 5 && dist < 90 && relX < 40 && me.brakes > 0 && !me.brk) {
      if (Math.random() < 0.25) {
        me.brk = true;
        me.brakes--;
        r.lastAct = 'brake';
        setTimeout(() => { me.brk = false; }, 600);
      }
    }
  } else {
    // 追越側：左右に振って隙を狙い、ブーストを積極的に使用
    const dist = enemy.z - me.z;
    const relX = me.x - enemy.x;

    if (avoidX !== 0) {
      me.inp.l = avoidX < 0 ? 1 : 0;
      me.inp.r = avoidX > 0 ? 1 : 0;
    } else {
      // 敵の真後ろ（ブレーキ撃墜ゾーン）を避け、ラインをズラす
      if (Math.abs(relX) < 35) {
        const side = (me.x >= 0) ? 1 : -1;
        me.inp.l = side < 0 ? 1 : 0;
        me.inp.r = side > 0 ? 1 : 0;
      } else {
        // 抜き去るために前に出るライン取り
        const offset = relX > 0 ? 45 : -45;
        const targetX = enemy.x + offset;
        me.inp.l = me.x > targetX ? 1 : 0;
        me.inp.r = me.x < targetX ? 1 : 0;
      }
    }

    // クールダウン完了で即座にブースト発動
    if (me.cd <= 0 && !me.boost) {
      if (dist > 30 && dist < 300) {
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
      return;
    }

    if (r.s === 'result') {
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
      return;
    }

    if (r.s === 'play') {
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
          return;
        }

        const distZ = Math.abs(A.z - B.z);
        const distX = Math.abs(A.x - B.x);

        if (distZ < 25 && distX < 28) {
          if (A.brk) {
            endRound(r, r.att, '撃墜成功！', 'BはAの急ブレーキに激突した！', 'crash');
          } else {
            endRound(r, r.att, '追突事故！', 'Bは回避せず真後ろから激突した！', 'crash');
          }
          return;
        }

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
  });
}, 1000 / 60);

io.on('connection', socket => {
  let curCode = null;

  socket.on('joinBot', cb => {
    curCode = 'BOT_' + socket.id.substr(0, 5);
    const r = initRoom(curCode);
    r.isBot = true;
    r.botSlot = 1;
    r.players = [socket.id, 'BOT'];
    r.sockets = [socket, null];
    rooms[curCode] = r;

    resetRound(r);
    cb({ ok: true });
    socket.emit('start', { slot: 0 });
  });

  socket.on('create', cb => {
    curCode = genCode();
    const r = initRoom(curCode);
    r.players.push(socket.id);
    r.sockets.push(socket);
    rooms[curCode] = r;
    cb({ code: curCode });
  });

  socket.on('join', (code, cb) => {
    const r = rooms[code];
    if (!r || r.players.length >= 2) return cb({ ok: false, err: 'ルームが存在しないか満員です' });
    curCode = code;
    r.players.push(socket.id);
    r.sockets.push(socket);
    resetRound(r);
    cb({ ok: true });
    
    r.sockets[0].emit('start', { slot: 0 });
    r.sockets[1].emit('start', { slot: 1 });
  });

  socket.on('inp', data => {
    const r = rooms[curCode];
    if (!r) return;
    const idx = r.players.indexOf(socket.id);
    if (idx !== -1 && r.P[idx]) {
      r.P[idx].inp = data;
    }
  });

  socket.on('act', () => {
    const r = rooms[curCode];
    if (!r || r.s !== 'play') return;
    const idx = r.players.indexOf(socket.id);
    if (idx === -1) return;
    const p = r.P[idx];

    if (idx === r.att) {
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
    const r = rooms[curCode];
    if (!r) return;
    if (r.s === 'result') {
      r.rd++;
      resetRound(r);
    } else if (r.s === 'match') {
      r.rd = 0;
      r.sc = [0, 0];
      r.hist = [];
      resetRound(r);
    }
  });

  socket.on('leave', () => {
    if (curCode && rooms[curCode]) {
      const r = rooms[curCode];
      delete rooms[curCode];
      if (r.sockets) {
        r.sockets.forEach(s => { if (s && s.id !== socket.id) s.emit('left'); });
      }
    }
  });

  socket.on('disconnect', () => {
    if (curCode && rooms[curCode]) {
      const r = rooms[curCode];
      delete rooms[curCode];
      if (r.sockets) {
        r.sockets.forEach(s => { if (s && s.id !== socket.id) s.emit('left'); });
      }
    }
  });
});

setInterval(() => {
  Object.keys(rooms).forEach(code => {
    const r = rooms[code];
    if (r && r.s !== 'lobby') {
      const state = {
        s: r.s, t: r.t, rd: r.rd, att: r.att, sc: r.sc, hist: r.hist,
        msg: r.msg, sub: r.sub, el: r.el, P: r.P, obs: r.obs,
        sound: r.sound, isBot: r.isBot, lastEvent: r.lastEvent, lastAct: r.lastAct
      };
      r.sockets.forEach(s => { if (s) s.emit('st', state); });
      r.lastAct = null;
    }
  });
}, 1000 / 60);

server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
