const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('.'));

const rooms = {};
const playerRooms = {}; // socket.id -> roomCode
const playerIds = {};   // userId -> roomCode

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create', (payload, callback) => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    rooms[code] = {
      code,
      players: [socket.id],
      payloads: [payload]
    };
    playerRooms[socket.id] = code;
    if(payload && payload.id) {
      playerIds[payload.id] = code;
    }
    socket.join(code);
    callback({ code });
  });

  socket.on('join', (data) => {
    const { code, ...payload } = data;
    const room = rooms[code];
    if(!room) {
      socket.emit('st', { s: 'match', msg: 'エラー', sub: '部屋が見つかりません' });
      return;
    }
    if(room.players.length >= 2) {
      socket.emit('st', { s: 'match', msg: 'エラー', sub: '部屋が満員です' });
      return;
    }
    room.players.push(socket.id);
    room.payloads.push(payload);
    playerRooms[socket.id] = code;
    if(payload && payload.id) {
      playerIds[payload.id] = code;
    }
    socket.join(code);

    io.to(code).emit('start', { slot: 1 });
  });

  // フレンドリストからのワンタップ参加処理
  socket.on('join_friend', (data, callback) => {
    const { targetId, ...payload } = data;
    const code = playerIds[targetId];
    if(!code || !rooms[code]) {
      callback({ ok: false, err: 'フレンドは現在ルームを作成していません' });
      return;
    }
    const room = rooms[code];
    if(room.players.length >= 2) {
      callback({ ok: false, err: 'ルームが満員です' });
      return;
    }
    room.players.push(socket.id);
    room.payloads.push(payload);
    playerRooms[socket.id] = code;
    socket.join(code);
    callback({ ok: true });
    io.to(code).emit('start', { slot: 1 });
  });

  socket.on('solo', (payload) => {
    // ソロ対戦の開始処理（必要に応じて記述）
  });

  socket.on('leave', () => {
    const code = playerRooms[socket.id];
    if(code && rooms[code]) {
      io.to(code).emit('left');
      delete rooms[code];
    }
    delete playerRooms[socket.id];
  });

  socket.on('disconnect', () => {
    const code = playerRooms[socket.id];
    if(code && rooms[code]) {
      io.to(code).emit('left');
      delete rooms[code];
    }
    delete playerRooms[socket.id];
  });
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
