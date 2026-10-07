const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = new Map();

function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function createRoomState(roomCode, isBot = false) {
  return {
    code: roomCode,
    isBot: isBot,
    players: [],
    s: 'count', // 'count', 'play', 'result', 'match'
    t: 3,
    rd: 0,
    att: 0, // 0: Player 0 attack, 1: Player 1 attack
    sc: [0, 0],
    hist: [],
    msg: '',
    sub: '',
    el: 0,
    P: [
      { x: 0, z: 0, v: 0, brk: false, brakes: 3, boost: false, cd: 0 },
      { x: 0, z: -100, v: 0, brk: false, brakes: 3, boost: false, cd: 0 }
    ],
    obs: [],
    lastAct: null,
    lastEvent: null
  };
}

function initRound(room) {
  room.s = 'count';
  room.t = 3;
  room.el = 0;
  room.att = room.rd % 2;
  
  // 位置のリセット
  const attSlot = room.att;
  const defSlot = 1 - attSlot;

  room.P[attSlot] = { x: 0, z: 150, v: 12, brk: false, brakes: 3, boost: false, cd: 0 };
  room.P[defSlot] = { x: 0, z: 0, v: 12, brk: false, brakes: 3, boost: false, cd: 0 };
  room.obs = [];
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerSlot = -1;

  // VS NPC (ソロ)
  socket.on('joinBot', (cb) => {
    const code = 'BOT_' + socket.id.substring(0, 4);
    const room = createRoomState(code, true);
    
    room.players.push({ id: socket.id, slot: 0 });
    room.players.push({ id: 'BOT', slot: 1 });
    
    rooms.set(code, room);
    currentRoom = room;
    playerSlot = 0;

    socket.join(code);
    initRound(room);

    if (typeof cb === 'function') cb({ ok: true, code });
    socket.emit('start', { slot: 0 });
  });

  // ルーム作成
  socket.on('create', (cb) => {
    const code = genCode();
    const room = createRoomState(code, false);
    
    room.players.push({ id: socket.id, slot: 0 });
    rooms.set(code, room);
    currentRoom = room;
    playerSlot = 0;

    socket.join(code);
    if (typeof cb === 'function') cb({ ok: true, code });
  });

  // ルーム参加
  socket.on('join', (code, cb) => {
    const room = rooms.get(code);
    if (!room) {
      if (typeof cb === 'function') cb({ ok: false, err: '部屋が存在しません' });
      return;
    }
    if (room.players.length >= 2) {
      if (typeof cb === 'function') cb({ ok: false, err: '満員です' });
      return;
    }

    room.players.push({ id: socket.id, slot: 1 });
    currentRoom = room;
    playerSlot = 1;

    socket.join(code);
    initRound(room);

    if (typeof cb === 'function') cb({ ok: true });
    
    // 両プレイヤーにスタート通知
    room.players.forEach(p => {
      io.to(p.id).emit('start', { slot: p.slot });
    });
  });

  // キー入力
  socket.on('inp', (data) => {
    if (!currentRoom || playerSlot < 0) return;
    const p = currentRoom.P[playerSlot];
    if (p) {
      if (data.l) p.x -= 3;
      if (data.r) p.x += 3;
    }
  });

  // アクション (W / Space / Up)
  socket.on('act', () => {
    if (!currentRoom || currentRoom.s !== 'play' || playerSlot < 0) return;
    const p = currentRoom.P[playerSlot];
    const isAtt = currentRoom.att === playerSlot;

    if (isAtt) {
      if (p.brakes > 0) {
        p.brakes--;
        p.brk = true;
        p.v = Math.max(0, p.v - 8);
        currentRoom.lastAct = 'brake';
        setTimeout(() => { p.brk = false; }, 400);
      }
    } else {
      if (p.cd <= 0) {
        p.boost = true;
        p.cd = 3.5;
        p.v += 10;
        currentRoom.lastAct = 'boost';
        setTimeout(() => { p.boost = false; }, 600);
      }
    }
  });

  // 退出・切断
  const handleLeave = () => {
    if (currentRoom) {
      socket.to(currentRoom.code).emit('left');
      rooms.delete(currentRoom.code);
      currentRoom = null;
    }
  };

  socket.on('leave', handleLeave);
  socket.on('disconnect', handleLeave);
});

// ループ処理 (20FPSで状態を送信)
setInterval(() => {
  rooms.forEach((room) => {
    const dt = 0.05;
    
    if (room.s === 'count') {
      room.t -= dt;
      if (room.t <= 0) {
        room.s = 'play';
        room.t = 0;
      }
    } else if (room.s === 'play') {
      room.el += dt;
      
      // プレイヤー移動処理
      room.P.forEach((p, idx) => {
        if (!p) return;
        if (p.cd > 0) p.cd = Math.max(0, p.cd - dt);
        p.z += p.v;
        
        // NPCの自動操作
        if (room.isBot && idx === 1) {
          const target = room.P[0];
          if (target) {
            if (p.x < target.x - 5) p.x += 2;
            else if (p.x > target.x + 5) p.x -= 2;
          }
        }
      });

      // 判定処理 (簡易版)
      const p0 = room.P[0];
      const p1 = room.P[1];
      if (p0 && p1) {
        const attP = room.P[room.att];
        const defP = room.P[1 - room.att];

        // 追い抜き成功判定
        if (defP.z > attP.z) {
          room.s = 'result';
          room.t = 3;
          const winSlot = 1 - room.att;
          room.sc[winSlot]++;
          room.hist.push(winSlot);
          room.msg = '追越成功！';
          room.sub = (winSlot === 0 ? 'あなた' : '相手') + 'の勝利';
        }
      }
    } else if (room.s === 'result') {
      room.t -= dt;
      if (room.t <= 0) {
        room.rd++;
        if (room.sc[0] >= 3 || room.sc[1] >= 3) {
          room.s = 'match';
          room.msg = room.sc[0] >= 3 ? 'VICTORY!' : 'DEFEAT...';
          room.sub = '最終スコア ' + room.sc[0] + ' - ' + room.sc[1];
        } else {
          initRound(room);
        }
      }
    }

    // クライアントへ送信
    io.to(room.code).emit('st', room);
    room.lastAct = null;
    room.lastEvent = null;
  });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
