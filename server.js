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
  
  // ★車は「たまに現れる」程度に抑える（最初に1台のみ生成）
  spawnObs(r, 900);
}

// ★障害物の出現を「左側通行（X: -90 〜 -50）」に限定
function spawnObs(r, startZ) {
  const leftLanes = [-90, -50]; // 左車線のみ
  const x = leftLanes[Math.floor(Math.random() * leftLanes.length)];
  const maxZ = r.obs.length > 0 ? Math.max(...r.obs.map(o => o.z)) : Math.max(r.P[0]?.z || 0, r.P[1]?.z || 0);
  const z = startZ || (maxZ + 1000 + Math.random() * 600);
  const isCop = Math.random() < 0.2;
  r.obs.push({
    id: Math.random().toString(36).substr(2, 9),
    x,
    z,
    v: isCop ? 220 : 110 + Math.random() * 30,
    k: isCop ? 'cop' : 'car',
    c: Math.floor(Math.random() * 5)
  });
}

// NPC (BOT) AI
function updateBot(r) {
  if (!r.isBot || r.s !== 'play') return;
  const botIdx = r.botSlot;
  const me = r.P[botIdx];
  const enemy = r.P[1 - botIdx];
  if (!me || !enemy) return;

  const isAttacker = (r.att === botIdx);
  
  // 障害物回避
  let avoidX = 0;
  const dangerObs = r.obs.find(o => o.z > me.z && o.z - me.z < 180 && Math.abs(o.x - me.x) < 45);
  if (dangerObs) {
    avoidX = me.x > dangerObs.x ? 1 : -1;
  }

  if (isAttacker) {
    me.inp.l = avoidX < 0 ? 1 : 0;
    me.inp.r = avoidX > 0 ? 1 : 0;

    const dist = me.z - enemy.z;
    const relX = Math.abs(me.x - enemy.x);
    if (dist > 10 && dist < 70 && relX < 35 && me.brakes > 0 && !me.brk) {
      if (Math.random() < 0.15) {
        me.brk = true;
        me.brakes--;
        r.lastAct = 'brake';
        setTimeout(() => { me.brk = false; }, 600);
      }
    }
  } else {
    const dist = enemy.z - me.z;
    const relX = me.x - enemy.x;

    if (avoidX !== 0) {
      me.inp.l = avoidX < 0 ? 1 : 0;
      me.inp.r = avoidX > 0 ? 1 : 0;
    } else {
      if (Math.abs(relX) < 40) {
        const targetSide = me.x >= 0 ? 1 : -1;
        me.inp.l = targetSide < 0 ? 1 : 0;
        me.inp.r = targetSide > 0 ? 1 : 0;
      } else {
        me.inp.l = relX > 50 ? 1 : 0;
        me.inp.r = relX < -50 ? 1 : 0;
      }
    }

    if (me.cd <= 0 && !me.boost) {
      const isAlignedForPass = Math.abs(relX) >= 30;
      const safeDistance = dist > 40 && dist < 220;
      if (isAlignedForPass && safeDistance && !enemy.brk) {
        me.boost = true;
        me.cd = 3.5;
        r.lastAct = 'boost';
        setTimeout(() => { me.boost = false; }, 800);
      }
    }
  }
}

// ★ラウンド終了処理（結果表示から2.5秒後に自動で次のラウンドを開始）
function endRound(r, winner, msg, sub, sound) {
  if (r.s === 'result' || r.s === 'match') return;
  r.s = 'result';
  r.t = 2.5; // 次のラウンドまでの自動カウントダウン
  r.lastEvent = sound;
  r.sc[winner]++;
  r.hist.push(winner);
  r.msg = msg;
  r.sub = sub;
}

// ゲームメインループ (60fps)
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

    // ★ラウンド結果画面での自動進行処理
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
      
      // ★画面内に車が少なくなったらたまに1台だけ補充（同時存在数を最大2台に制限）
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
        if (p.inp.l) moveX -= 130;
        if (p.inp.r) moveX += 130;
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
        // ★追越成功判定
        if (B.z > A.z + 15) {
          endRound(r, 1 - r.att, '追越成功！', 'BがAを華麗に抜き去った！', 'win');
          return;
        }

        // ★衝突判定
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

        // 障害物クラッシュ判定
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
}, 1000 / 30);

server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
