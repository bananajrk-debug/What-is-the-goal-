const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static('public'));

const rooms = {};

function generateRoomCode() {
  let code = '';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', () => {
    let roomCode = generateRoomCode();
    while (rooms[roomCode]) {
      roomCode = generateRoomCode();
    }
    rooms[roomCode] = {
      players: {},
      started: false
    };
    rooms[roomCode].players[socket.id] = {
      id: socket.id,
      number: 1,
      x: 150,
      y: 300,
      vx: 0,
      vy: 0,
      role: '逃走者',
      color: '#00f3ff'
    };
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.emit('roomCreated', { roomCode, playerNumber: 1 });
  });

  socket.on('joinRoom', (roomCode) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms[code];

    if (!room) {
      socket.emit('errorMsg', '部屋が見つかりません');
      return;
    }
    const playerCount = Object.keys(room.players).length;
    if (playerCount >= 2) {
      socket.emit('errorMsg', '部屋が満員です');
      return;
    }

    room.players[socket.id] = {
      id: socket.id,
      number: 2,
      x: 650,
      y: 300,
      vx: 0,
      vy: 0,
      role: '鬼',
      color: '#ff0055'
    };
    socket.join(code);
    socket.roomCode = code;

    socket.emit('roomJoined', { roomCode: code, playerNumber: 2 });
    io.to(code).emit('gameStart', { players: room.players });
  });

  socket.on('playerMove', (data) => {
    const code = socket.roomCode;
    if (code && rooms[code] && rooms[code].players[socket.id]) {
      rooms[code].players[socket.id].x = data.x;
      rooms[code].players[socket.id].y = data.y;
      rooms[code].players[socket.id].vx = data.vx || 0;
      rooms[code].players[socket.id].vy = data.vy || 0;
      socket.to(code).emit('opponentMove', rooms[code].players[socket.id]);
    }
  });

  socket.on('soundPulse', (data) => {
    const code = socket.roomCode;
    if (code) {
      socket.to(code).emit('opponentSound', data);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      delete rooms[code].players[socket.id];
      if (Object.keys(rooms[code].players).length === 0) {
        delete rooms[code];
      } else {
        io.to(code).emit('playerLeft');
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
