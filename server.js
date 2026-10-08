const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const BASE = 110, HW = 150, TICK = 1 / 30;
const rooms = new Map();

const attOf = r => (r < 3 ? 0 : r < 6 ? 1 : r % 2);
const mk = (x, z) => ({ x, z, vx: 0, v: BASE, brk: 0, brakes: 3, boost: 0, cd: 0, inpL: false, inpR: false });

function newRound(R) {
  R.s = 'count';
  R.t = 3;
  R.el = 0;
  R.att = attOf(R.rd);
  const a = R.att, d = 1 - a;
  R.P[a] = mk(0, HW);
  R.P[d] = mk(0, 0);
  R.obs = []; // 車（障害物）は生成しない
  R.lastAct = R.lastEvent = null;
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
    if (!R || R.players.length >= 2) return typeof cb === 'function' && cb({ ok: false, err: '参加できません' });
    R.players.push({ id: socket.id, slot: 1 });
    room = R; slot = 1;
    socket.join(code);
    newRound(R);
    if (typeof cb === 'function') cb({ ok: true });
    R.players.forEach(p => io.to(p.id).emit('start', { slot: p.slot }));
  });

  // 左右キー状態の保持（滑らかな移動用）
  socket.on('inp', d => {
    if (!room || slot < 0) return;
    const p = room.P[slot];
    if (p) {
      p.inpL = !!d.l;
      p.inpR = !!d.r;
    }
  });

  socket.on('act', () => {
    if (!room || room.s !== 'play' || slot < 0) return;

    // ラウンド開始から5秒間はスキル使用不可
    if (room.el < 5.0) return;

    const p = room.P[slot];
    const isAtt = room.att === slot;

    if (isAtt) {
      // 攻撃側：ブレーキが残っていればブレーキ優先、使い切っていれば/またはブースト発動可能
      if (p.brakes > 0 && !p.brk) {
        p.brakes--; p.brk = 1;
        setTimeout(() => { if (p) p.brk = 0; }, 400);
        room.lastAct = 'brake';
      } else if (p.cd <= 0 && !p.boost) {
        p.boost = 1; p.cd = 3.5;
        setTimeout(() => { if (p) p.boost = 0; }, 800);
        room.lastAct = 'boost';
      }
    } else {
      // 守る側：ブースト
      if (p.cd <= 0 && !p.boost) {
        p.boost = 1; p.cd = 3.5;
        setTimeout(() => { if (p) p.boost = 0; }, 800);
        room.lastAct = 'boost';
      }
    }
  });

  socket.on('again', () => {
    if (room && room.s === 'match') {
      room.rd = 0; room.sc = [0, 0]; room.hist = [];
      newRound(room);
    }
  });

  const leave = () => {
    if (room) {
      socket.to(room.code).emit('left');
      rooms.delete(room.code);
      room = null;
    }
  };

  socket.on('leave', leave);
  socket.on('disconnect', leave);
});

setInterval(() => {
  rooms.forEach(R => {
    if (R.s === 'count') {
      R.t -= TICK;
      if (R.t <= 0) { R.s = 'play'; R.t = 0; }
    } else if (R.s === 'play') {
      R.el += TICK;

      R.P.forEach((p, idx) => {
        if (!p) return;
        if (p.cd > 0) p.cd = Math.max(0, p.cd - TICK);

        // 【変更点】左右移動の慣性ステアリング（滑らかな動作）
        p.vx = p.vx || 0;
        if (p.inpL) p.vx -= 1.8;
        else if (p.inpR) p.vx += 1.8;
        else p.vx *= 0.72; // キーを離した時の滑らかな減衰

        p.vx = Math.max(-7, Math.min(7, p.vx));
        p.x = Math.max(-65, Math.min(65, p.x + p.vx));

        // 前後速度制御
        let targetV = BASE;
        if (p.brk) targetV = 20;
        if (p.boost) targetV = 220;
        p.v += (targetV - p.v) * 0.1;
        p.z += p.v * TICK;

        // BOT（NPC）思考ロジック
        if (R.isBot && idx === 1) {
          const target = R.P[0];
          if (target) {
            if (p.x < target.x - 4) { p.inpL = false; p.inpR = true; }
            else if (p.x > target.x + 4) { p.inpL = true; p.inpR = false; }
            else { p.inpL = false; p.inpR = false; }

            if (R.el >= 5.0) {
              if (R.att === 1 && p.brakes > 0 && Math.abs(p.z - target.z) < 40 && !p.brk) {
                p.brakes--; p.brk = 1;
                setTimeout(() => { if (p) p.brk = 0; }, 400);
                R.lastAct = 'brake';
              } else if (p.cd <= 0 && !p.boost) {
                p.boost = 1; p.cd = 3.5;
                setTimeout(() => { if (p) p.boost = 0; }, 800);
                R.lastAct = 'boost';
              }
            }
          }
        }
      });

      // 勝敗・接触判定
      const attP = R.P[R.att], defP = R.P[1 - R.att];
      if (attP && defP) {
        const dx = Math.abs(attP.x - defP.x);
        const dz = Math.abs(attP.z - defP.z);

        // 【変更点】衝突判定（接触時）
        if (dx < 22 && dz < 30) {
          // 攻撃側が「ブレーキ中」または「ブースト中」に衝突した場合 ➜ 攻撃側の勝利（守る側の負け）
          if (attP.brk || attP.boost) {
            R.s = 'result'; R.t = 3;
            const winSlot = R.att; // 攻撃側の勝利
            R.sc[winSlot]++;
            R.hist.push(winSlot);
            R.msg = attP.boost ? 'ブースト撃墜！' : 'ブレーキ撃墜！';
            R.sub = (winSlot === 0 ? 'あなた' : '相手') + 'の勝利';
            R.lastEvent = 'crash';
          }
        }

        // 追越判定（守る側が追い抜いた場合）
        if (R.s === 'play' && defP.z > attP.z) {
          R.s = 'result'; R.t = 3;
          const winSlot = 1 - R.att; // 守る側の勝利
          R.sc[winSlot]++;
          R.hist.push(winSlot);
          R.msg = '追越成功！';
          R.sub = (winSlot === 0 ? 'あなた' : '相手') + 'の勝利';
        }
      }
    } else if (R.s === 'result') {
      R.t -= TICK;
      if (R.t <= 0) {
        R.rd++;
        if (R.sc[0] >= 3 || R.sc[1] >= 3) {
          R.s = 'match';
          R.msg = R.sc[0] >= 3 ? 'VICTORY!' : 'DEFEAT...';
          R.sub = `最終スコア ${R.sc[0]} - ${R.sc[1]}`;
        } else {
          newRound(R);
        }
      }
    }

    const me0 = R.P[0], me1 = R.P[1];
    if (me0 && me1) {
      R.sound = {
        dist: Math.abs(me0.z - me1.z),
        relX: me1.x - me0.x,
        boosting: !!me1.boost
      };
    }

    io.to(R.code).emit('st', R);
    R.lastAct = R.lastEvent = null;
  });
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
