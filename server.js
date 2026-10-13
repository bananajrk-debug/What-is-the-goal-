const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const GAME_VERSION = "v2.2.0";

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('index.html が見つかりません。');
  }
});

const CHARACTERS = {
  futsuo:     { name: 'フツオ (ファイター)',   hp: 100, atk: 12, speed: 7.0, jumpPower: 17, width: 50, height: 90,  type: 'futsuo',     ability: '万能格闘家',  cd: 12 },
  debugon:    { name: 'デブゴン (ヘビー)',     hp: 140, atk: 16, speed: 5.0, jumpPower: 13, width: 75, height: 95,  type: 'debugon',    ability: '不屈のアーマー', cd: 14 },
  chibikoro:  { name: 'チビコロ (ダイバー)',   hp: 110, atk: 13, speed: 6.0, jumpPower: 14, width: 65, height: 60,  type: 'chibikoro',  ability: '急降下アタック', cd: 12 },
  ninja:      { name: 'ニンジャ (シノビ)',     hp: 85,  atk: 11, speed: 7.0, jumpPower: 17, width: 40, height: 90,  type: 'ninja',      ability: '手裏剣(CT:0.6秒)', cd: 36 },
  wizard:     { name: 'ウィザード (メイジ)',   hp: 85,  atk: 13, speed: 7.0, jumpPower: 18, width: 45, height: 95,  type: 'wizard',     ability: '魔法弾(CT:0.6秒)', cd: 36 }
};

const STAGES = {
  1: { name: '平原 (PLAIN)', platforms: [{ x: 220, y: 410, width: 200, height: 18 }, { x: 780, y: 410, width: 200, height: 18 }, { x: 500, y: 280, width: 200, height: 18 }] },
  2: { name: '浮島 (ISLANDS)', platforms: [{ x: 180, y: 400, width: 220, height: 20 }, { x: 800, y: 400, width: 220, height: 20 }, { x: 490, y: 270, width: 220, height: 20 }] },
  3: { name: 'スリル (DOOM)', platforms: [{ x: 350, y: 390, width: 500, height: 22 }] },
  4: { name: '神殿 (TEMPLE)', platforms: [{ x: 220, y: 410, width: 200, height: 18 }, { x: 780, y: 410, width: 200, height: 18 }, { x: 500, y: 280, width: 200, height: 18 }] },
  5: { name: '宇宙 (SPACE)', platforms: [{ x: 150, y: 420, width: 250, height: 16 }, { x: 800, y: 420, width: 250, height: 16 }, { x: 460, y: 290, width: 280, height: 16 }] }
};

let rooms = {};

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]);
  return code;
}

function createRoom(code) {
  return {
    code: code,
    players: {},
    items: [],
    projectiles: [],
    spawnedItemCount: 0,
    gameState: 'LOBBY',
    isCpuMode: false,
    selectedStage: 1,
    countdownTimer: null,
    countdownVal: 0
  };
}

io.on('connection', (socket) => {

  socket.on('createRoom', (data) => {
    const code = generateRoomCode();
    rooms[code] = createRoom(code);
    const room = rooms[code];
    room.players[socket.id] = createPlayerData(socket.id, 1, data.playerName || 'Player 1');

    socket.join(code);
    socket.emit('roomCreated', { code: code, playerNum: 1, characters: CHARACTERS, stages: STAGES, version: GAME_VERSION });
    io.to(code).emit('gameState', { state: room.gameState, players: room.players, isCpuMode: false, code: code, selectedStage: room.selectedStage });
  });

  socket.on('joinRoom', (data) => {
    const code = data.code;
    const room = rooms[code];

    if (!room) {
      socket.emit('joinError', '部屋が見つかりません。');
      return;
    }

    if (Object.keys(room.players).length >= 4 || room.isCpuMode) {
      socket.emit('joinError', '部屋が満員です (最大4人)。');
      return;
    }

    const assignedNum = Object.keys(room.players).length + 1;
    room.players[socket.id] = createPlayerData(socket.id, assignedNum, data.playerName || `Player ${assignedNum}`);

    socket.join(code);
    socket.emit('roomJoined', { code: code, playerNum: assignedNum, characters: CHARACTERS, stages: STAGES, version: GAME_VERSION });
    io.to(code).emit('gameState', { state: room.gameState, players: room.players, isCpuMode: false, code: code, selectedStage: room.selectedStage });
  });

  socket.on('startCpuMode', (data) => {
    const code = generateRoomCode();
    rooms[code] = createRoom(code);
    const room = rooms[code];
    room.isCpuMode = true;
    room.selectedStage = data.stageId || 1;

    room.players[socket.id] = createPlayerData(socket.id, 1, data.playerName || 'Player 1');
    room.players[socket.id].characterKey = data.characterKey || 'futsuo';

    const cpuKeys = Object.keys(CHARACTERS);
    const randomCpuChar = cpuKeys[Math.floor(Math.random() * cpuKeys.length)];

    room.players['cpu_player'] = createPlayerData('cpu_player', 2, 'CPU');
    room.players['cpu_player'].characterKey = randomCpuChar;
    room.players['cpu_player'].isCpu = true;
    room.players['cpu_player'].ready = true;

    room.players[socket.id].ready = true;
    socket.join(code);
    socket.emit('roomCreated', { code: code, playerNum: 1, characters: CHARACTERS, stages: STAGES, version: GAME_VERSION });
    startMatch(room);
  });

  socket.on('selectStage', (data) => {
    const room = getRoomBySocket(socket);
    if (room && room.players[socket.id] && room.players[socket.id].playerNum === 1) {
      room.selectedStage = data.stageId;
      io.to(room.code).emit('stageUpdated', { selectedStage: room.selectedStage });
    }
  });

  socket.on('updateName', (data) => {
    const room = getRoomBySocket(socket);
    if (room && room.players[socket.id]) {
      room.players[socket.id].name = data.name || `Player ${room.players[socket.id].playerNum}`;
      io.to(room.code).emit('characterUpdated', { players: room.players });
    }
  });

  socket.on('selectCharacter', (data) => {
    const room = getRoomBySocket(socket);
    if (room && room.players[socket.id]) {
      room.players[socket.id].characterKey = data.characterKey;
      io.to(room.code).emit('characterUpdated', { players: room.players });
    }
  });

  socket.on('sendStamp', (data) => {
    const room = getRoomBySocket(socket);
    if (room && room.players[socket.id]) {
      const p = room.players[socket.id];
      p.stamp = data.stamp;
      io.to(room.code).emit('stampTriggered', { socketId: socket.id, stamp: data.stamp });
      setTimeout(() => { if (p.stamp === data.stamp) p.stamp = null; }, 2000);
    }
  });

  socket.on('toggleReady', () => {
    const room = getRoomBySocket(socket);
    if (room && !room.isCpuMode) {
      const p = room.players[socket.id];
      if (p) {
        p.ready = !p.ready;
        io.to(room.code).emit('characterUpdated', { players: room.players });

        const playerList = Object.values(room.players);
        const activePlayers = playerList.slice(0, 2);
        const allReady = activePlayers.length === 2 && activePlayers.every(player => player.ready);

        if (allReady) {
          room.countdownVal = 3;
          io.to(room.code).emit('countdownUpdate', { count: room.countdownVal });

          room.countdownTimer = setInterval(() => {
            room.countdownVal--;
            if (room.countdownVal > 0) {
              io.to(room.code).emit('countdownUpdate', { count: room.countdownVal });
            } else {
              clearInterval(room.countdownTimer);
              startMatch(room);
            }
          }, 1000);
        } else {
          if (room.countdownTimer) {
            clearInterval(room.countdownTimer);
            room.countdownTimer = null;
            io.to(room.code).emit('countdownCancel');
          }
        }
      }
    }
  });

  socket.on('playerInput', (input) => {
    const room = getRoomBySocket(socket);
    if (!room || room.gameState !== 'PLAYING') return;

    const p = room.players[socket.id];
    if (!p || p.stunFrames > 0 || p.isKilled) return;

    const char = CHARACTERS[p.characterKey];
    let speedMult = p.buffSpeedTimer > 0 ? 1.4 : 1.0;

    if (input.left) {
      p.vx = -char.speed * speedMult;
      p.facing = 'left';
    } else if (input.right) {
      p.vx = char.speed * speedMult;
      p.facing = 'right';
    } else {
      p.vx = 0;
    }

    if (input.jump && !input.jumpPrev) {
      if (p.isGrounded) {
        p.vy = -char.jumpPower;
        p.isGrounded = false;
        p.jumpCount = 1;
      } else if (char.type === 'ninja' && p.jumpCount < 2) {
        p.vy = -char.jumpPower * 0.9;
        p.jumpCount = 2;
      }
    }

    // 必殺技発動処理 (ULT)
    if (input.ult && p.ultGauge >= 100) {
      p.ultGauge = 0; // ゲージ消費
      if (char.type === 'futsuo') {
        p.ultFutsuoTimer = 360; // フツオ：6秒間パンチ/キックのダメージ&範囲2倍
      } else if (char.type === 'ninja') {
        p.ninjaUltShurikenCount = 3; // 忍者：巨大手裏剣3発分の権利
      } else if (char.type === 'debugon') {
        // デブゴン：横方向に衝撃波（波動攻撃）
        const isRight = p.facing === 'right';
        room.projectiles.push({
          id: Date.now() + Math.random(),
          ownerId: p.id,
          type: 'hadou',
          x: isRight ? p.x + char.width : p.x - 180,
          y: p.y - 10,
          vx: isRight ? 14 : -14,
          width: 180,
          height: char.height + 20,
          damage: Math.round(char.atk * 2.2)
        });
      } else if (char.type === 'chibikoro') {
        // チビコロ：即時急降下爆発
        p.vy = 30;
        p.ultChibikoroActive = true;
      } else if (char.type === 'wizard') {
        // ウィザード：巨大メガボール
        const isRight = p.facing === 'right';
        room.projectiles.push({
          id: Date.now() + Math.random(),
          ownerId: p.id,
          type: 'wizard_ult',
          x: isRight ? p.x + char.width : p.x - 90,
          y: p.y,
          vx: isRight ? 10 : -10,
          width: 90,
          height: 90,
          damage: Math.round(char.atk * 2.5)
        });
      }
      io.to(room.code).emit('ultTriggered', { playerId: p.id, type: char.type });
    }

    if (input.attack && !p.attacking && p.attackCooldown <= 0) {
      p.attacking = true;
      p.attackType = input.attackType;
      p.attackCooldown = char.cd || 12;

      const isPunch = input.attackType === 'punch';
      let atkMult = p.buffAtkTimer > 0 ? 1.5 : 1.0;
      let rangeMult = 1.0;

      // フツオの必殺技中（ダメージ2倍・範囲2倍）
      if (p.ultFutsuoTimer > 0) {
        atkMult *= 2.0;
        rangeMult = 2.0;
      }

      let dmg = Math.round((isPunch ? char.atk : Math.round(char.atk * 1.25)) * atkMult);

      if (p.senobicTimer > 0) {
        if (p.oneHitKill) {
          dmg = 9999;
          p.oneHitKill = false;
        } else {
          dmg = Math.round(dmg * 1.8);
        }
      }

      if (char.type === 'ninja') {
        const isRight = p.facing === 'right';
        const isUltShuriken = p.ninjaUltShurikenCount > 0;
        if (isUltShuriken) p.ninjaUltShurikenCount--;

        const projSpeed = 16;
        const startX = isRight ? p.x + (char.width * (p.senobicTimer > 0 ? 2 : 1)) : p.x - (isUltShuriken ? 70 : 30);
        const startY = p.y + (char.height * (p.senobicTimer > 0 ? 2 : 1)) * 0.3;

        room.projectiles.push({
          id: Date.now() + Math.random(),
          ownerId: p.id,
          type: isUltShuriken ? 'ninja_ult' : 'ninja',
          x: startX,
          y: startY,
          vx: isRight ? projSpeed : -projSpeed,
          width: isUltShuriken ? 70 : 26,
          height: isUltShuriken ? 70 : 22,
          damage: isUltShuriken ? Math.round(dmg * 2.0) : dmg
        });
      } else if (char.type === 'wizard') {
        const isRight = p.facing === 'right';
        const startX = isRight ? p.x + (char.width * (p.senobicTimer > 0 ? 2 : 1)) : p.x - 30;
        const startY = p.y + (char.height * (p.senobicTimer > 0 ? 2 : 1)) * 0.4;
        const projSpeed = 12;

        room.projectiles.push({
          id: Date.now() + Math.random(),
          ownerId: p.id,
          type: 'wizard',
          x: startX,
          y: startY,
          vx: isRight ? projSpeed : -projSpeed,
          width: 26,
          height: 22,
          damage: dmg
        });
      } else {
        let reach = (isPunch ? 55 : 85) * rangeMult;

        const isGiant = p.senobicTimer > 0;
        let attackHeight = (isPunch ? char.height * 0.4 : char.height * 0.3) * (isGiant ? 2.2 : 1) * rangeMult;
        let attackYOffset = isGiant ? (char.height * 2 - attackHeight - 10) : (isPunch ? char.height * 0.2 : char.height * 0.4);

        if (char.type === 'chibikoro' && !p.isGrounded) {
          p.vy = 22;
          dmg = p.oneHitKill ? 9999 : Math.round(18 * atkMult);
          if (p.oneHitKill) p.oneHitKill = false;
          reach = 100 * rangeMult;
        }

        p.attackBox = {
          x: p.facing === 'right' ? p.x + (char.width * (isGiant ? 2 : 1)) : p.x - (reach * (isGiant ? 1.5 : 1)),
          y: p.y + attackYOffset,
          width: reach * (isGiant ? 1.5 : 1),
          height: attackHeight,
          damage: dmg,
          type: input.attackType
        };

        setTimeout(() => { p.attackBox = null; }, 140);
      }

      setTimeout(() => { p.attacking = false; }, 200);
    }
  });

  socket.on('requestRematch', () => {
    const room = getRoomBySocket(socket);
    if (room && room.gameState === 'FINISHED') {
      if (room.isCpuMode) {
        startMatch(room);
      } else {
        room.gameState = 'LOBBY';
        room.items = [];
        room.projectiles = [];
        room.spawnedItemCount = 0;
        Object.values(room.players).forEach(p => { p.ready = false; });
        io.to(room.code).emit('gameState', { state: 'LOBBY', players: room.players, isCpuMode: false, code: room.code, selectedStage: room.selectedStage });
      }
    }
  });

  socket.on('disconnect', () => {
    const room = getRoomBySocket(socket);
    if (room) {
      if (room.countdownTimer) clearInterval(room.countdownTimer);
      delete room.players[socket.id];
      if (Object.keys(room.players).filter(id => id !== 'cpu_player').length === 0) {
        delete rooms[room.code];
      } else {
        room.gameState = 'LOBBY';
        if (room.isCpuMode) {
          delete room.players['cpu_player'];
          room.isCpuMode = false;
        }
        const remainingPlayer = Object.values(room.players)[0];
        if (remainingPlayer) remainingPlayer.ready = false;
        io.to(room.code).emit('playerLeft');
      }
    }
  });
});

function startMatch(room) {
  room.gameState = 'PLAYING';
  room.items = [];
  room.projectiles = [];
  room.spawnedItemCount = 0;

  Object.values(room.players).forEach(pl => {
    const char = CHARACTERS[pl.characterKey];
    pl.hp = char.hp;
    pl.maxHp = char.hp;
    pl.lives = 3;
    pl.x = pl.playerNum === 1 ? 250 : 1200 - 250 - char.width;
    pl.y = 520 - char.height;
    pl.vx = 0;
    pl.vy = 0;
    pl.facing = pl.playerNum === 1 ? 'right' : 'left';
    pl.jumpCount = 0;
    pl.stamp = null;
    pl.isKilled = false;
    pl.killTimer = 0;
    pl.buffAtkTimer = 0;
    pl.buffSpeedTimer = 0;
    pl.senobicTimer = 0;
    pl.oneHitKill = false;
    pl.attackCooldown = 0;
    pl.ultGauge = 0;
    pl.ultFutsuoTimer = 0;
    pl.ninjaUltShurikenCount = 0;
    pl.ultChibikoroActive = false;
  });
  io.to(room.code).emit('gameStart', { players: room.players, selectedStage: room.selectedStage, isCpuMode: room.isCpuMode });
}

function createPlayerData(socketId, playerNum, name) {
  return {
    id: socketId,
    playerNum: playerNum,
    name: name,
    characterKey: 'futsuo',
    ready: false,
    isCpu: false,
    x: playerNum === 1 ? 250 : 850,
    y: 400,
    vx: 0,
    vy: 0,
    facing: playerNum === 1 ? 'right' : 'left',
    hp: 100,
    maxHp: 100,
    lives: 3,
    isGrounded: false,
    attacking: false,
    attackCooldown: 0,
    attackType: null,
    attackBox: null,
    stunFrames: 0,
    invincibleFrames: 0,
    jumpCount: 0,
    stamp: null,
    isKilled: false,
    killTimer: 0,
    buffAtkTimer: 0,
    buffSpeedTimer: 0,
    senobicTimer: 0,
    oneHitKill: false,
    ultGauge: 0,
    ultFutsuoTimer: 0,
    ninjaUltShurikenCount: 0,
    ultChibikoroActive: false
  };
}

function getRoomBySocket(socket) {
  for (let code in rooms) {
    if (rooms[code].players[socket.id]) return rooms[code];
  }
  return null;
}

function respawnPlayer(p) {
  const char = CHARACTERS[p.characterKey];
  p.hp = p.maxHp;
  p.x = p.playerNum === 1 ? 250 : 1200 - 250 - char.width;
  p.y = 100;
  p.vx = 0;
  p.vy = 0;
  p.isKilled = false;
  p.killTimer = 0;
  p.invincibleFrames = 120;
}

function updateCpuAI(cpu, target) {
  if (!cpu || !target || cpu.stunFrames > 0 || cpu.isKilled) return;

  const cpuChar = CHARACTERS[cpu.characterKey];
  const distance = (target.x + CHARACTERS[target.characterKey].width / 2) - (cpu.x + cpuChar.width / 2);

  cpu.facing = distance > 0 ? 'right' : 'left';
  let speedMult = cpu.buffSpeedTimer > 0 ? 1.4 : 1.0;

  if (Math.abs(distance) > 75) {
    cpu.vx = distance > 0 ? cpuChar.speed * 0.55 * speedMult : -cpuChar.speed * 0.55 * speedMult;
  } else {
    cpu.vx = 0;
  }

  if (Math.random() < 0.008 && cpu.isGrounded) {
    cpu.vy = -cpuChar.jumpPower;
    cpu.isGrounded = false;
  }

  // CPUの必殺技自動発動
  if (cpu.ultGauge >= 100 && Math.random() < 0.02) {
    cpu.ultGauge = 0;
    if (cpuChar.type === 'futsuo') cpu.ultFutsuoTimer = 360;
    else if (cpuChar.type === 'ninja') cpu.ninjaUltShurikenCount = 3;
    else if (cpuChar.type === 'debugon') {
      const isRight = cpu.facing === 'right';
      getRoomBySocket({ id: cpu.id })?.projectiles.push({
        id: Date.now() + Math.random(),
        ownerId: cpu.id,
        type: 'hadou',
        x: isRight ? cpu.x + cpuChar.width : cpu.x - 180,
        y: cpu.y - 10,
        vx: isRight ? 14 : -14,
        width: 180,
        height: cpuChar.height + 20,
        damage: Math.round(cpuChar.atk * 2.2)
      });
    }
  }

  if (Math.abs(distance) <= 300 && !cpu.attacking && cpu.attackCooldown <= 0 && Math.random() < 0.038) {
    cpu.attacking = true;
    cpu.attackCooldown = cpuChar.cd || 12;
    const isPunch = Math.random() < 0.7;
    cpu.attackType = isPunch ? 'punch' : 'kick';

    let atkMult = cpu.buffAtkTimer > 0 ? 1.5 : (cpu.senobicTimer > 0 ? 1.8 : 1.0);
    if (cpu.ultFutsuoTimer > 0) atkMult *= 2.0;
    let dmg = Math.round((isPunch ? cpuChar.atk : Math.round(cpuChar.atk * 1.25)) * atkMult);

    if (cpu.senobicTimer > 0 && cpu.oneHitKill) {
      dmg = 9999;
      cpu.oneHitKill = false;
    }

    if (cpuChar.type === 'ninja') {
      const isRight = cpu.facing === 'right';
      const isUltShuriken = cpu.ninjaUltShurikenCount > 0;
      if (isUltShuriken) cpu.ninjaUltShurikenCount--;

      getRoomBySocket({ id: cpu.id })?.projectiles.push({
        id: Date.now() + Math.random(),
        ownerId: cpu.id,
        type: isUltShuriken ? 'ninja_ult' : 'ninja',
        x: isRight ? cpu.x + cpuChar.width : cpu.x - (isUltShuriken ? 70 : 30),
        y: cpu.y + cpuChar.height * 0.35,
        vx: isRight ? 16 : -16,
        width: isUltShuriken ? 70 : 26,
        height: isUltShuriken ? 70 : 22,
        damage: isUltShuriken ? Math.round(dmg * 2.0) : dmg
      });
    } else if (cpuChar.type === 'wizard') {
      const isRight = cpu.facing === 'right';
      getRoomBySocket({ id: cpu.id })?.projectiles.push({
        id: Date.now() + Math.random(),
        ownerId: cpu.id,
        type: 'wizard',
        x: isRight ? cpu.x + cpuChar.width : cpu.x - 30,
        y: cpu.y + cpuChar.height * 0.35,
        vx: isRight ? 12 : -12,
        width: 26,
        height: 22,
        damage: dmg
      });
    } else {
      let reach = (isPunch ? 55 : 85) * (cpu.ultFutsuoTimer > 0 ? 2 : 1);
      const attackHeight = isPunch ? cpuChar.height * 0.4 : cpuChar.height * 0.3;
      const attackYOffset = isPunch ? cpuChar.height * 0.2 : cpuChar.height * 0.4;

      cpu.attackBox = {
        x: cpu.facing === 'right' ? cpu.x + cpuChar.width : cpu.x - reach,
        y: cpu.y + attackYOffset,
        width: reach,
        height: attackHeight,
        damage: dmg,
        type: cpu.attackType
      };

      setTimeout(() => { cpu.attackBox = null; }, 120);
    }

    setTimeout(() => { cpu.attacking = false; }, 200);
  }
}

function spawnRandomItem(room) {
  if (room.items.length >= 1) return;
  if (room.spawnedItemCount >= 4) return;

  const playerIds = Object.keys(room.players).filter(id => id !== 'cpu_player' || room.isCpuMode);
  let p1 = room.players[playerIds[0]];
  let p2 = room.players[playerIds[1]];

  let p1Lives = p1 ? p1.lives : 3;
  let p2Lives = p2 ? p2.lives : 3;

  let senobicChance = 0.05;
  if (p1Lives === 1 && p2Lives === 1) senobicChance = 0.30;
  else if ((p1Lives === 2 && p2Lives === 1) || (p1Lives === 1 && p2Lives === 2)) senobicChance = 0.20;
  else if (p1Lives === 1 || p2Lives === 1) senobicChance = 0.10;

  const rand = Math.random();
  let type = 'heal';
  if (rand < senobicChance) {
    type = 'senobic';
  } else {
    const subRand = Math.random();
    if (subRand < 0.4) type = 'heal';
    else if (subRand < 0.75) type = 'atk';
    else type = 'speed';
  }

  room.items.push({
    id: Date.now() + Math.random(),
    type: type,
    x: 150 + Math.random() * 900,
    y: -40,
    vy: 2.5,
    width: 55,
    height: 55,
    isGrounded: false
  });
  room.spawnedItemCount++;
}

setInterval(() => {
  const STAGE_WIDTH = 1200;
  const GROUND_Y = 520;
  const GRAVITY = 0.8;

  for (let code in rooms) {
    const room = rooms[code];
    if (room.gameState !== 'PLAYING') continue;

    const playerIds = Object.keys(room.players);
    if (playerIds.length < 2) continue;

    const p1 = room.players[playerIds[0]];
    const p2 = room.players[playerIds[1]];
    const playersArr = [p1, p2];

    if (Math.random() < 0.0015) spawnRandomItem(room);

    if (room.isCpuMode && p2 && p2.isCpu && p1) {
      updateCpuAI(p2, p1);
    }

    for (let i = room.projectiles.length - 1; i >= 0; i--) {
      const proj = room.projectiles[i];
      proj.x += proj.vx;

      if (proj.x < -120 || proj.x > STAGE_WIDTH + 120) {
        room.projectiles.splice(i, 1);
        continue;
      }

      const target = playersArr.find(p => p && p.id !== proj.ownerId && !p.isKilled);
      if (target && target.invincibleFrames === 0) {
        const targetChar = CHARACTERS[target.characterKey];
        const defScale = target.senobicTimer > 0 ? 2 : 1;
        const db = { x: target.x, y: target.y, width: targetChar.width * defScale, height: targetChar.height * defScale };

        if (
          proj.x < db.x + db.width &&
          proj.x + proj.width > db.x &&
          proj.y < db.y + db.height &&
          proj.y + proj.height > db.y
        ) {
          target.hp -= proj.damage;

          // 攻撃ヒット者への必殺技ゲージ加算 (ダメージに応じた量)
          const attacker = playersArr.find(p => p && p.id === proj.ownerId);
          if (attacker) attacker.ultGauge = Math.min(100, attacker.ultGauge + Math.round(proj.damage * 1.5));

          const isArmored = (targetChar.type === 'debugon' && target.attacking) || target.senobicTimer > 0;

          if (target.hp <= 0) {
            target.hp = 0;
            target.lives--;
            target.isKilled = true;
            target.killTimer = 0;
            target.vx = proj.vx > 0 ? 24 : -24;
            target.vy = -20;
            io.to(code).emit('koEffect', { victimId: target.id, x: target.x, y: target.y });
          } else if (!isArmored) {
            target.stunFrames = 10;
            target.vy = -5;
            target.vx = proj.vx > 0 ? 12 : -12;
          }

          target.invincibleFrames = 24;
          if (proj.type !== 'hadou') room.projectiles.splice(i, 1); // 波動は貫通
        }
      }
    }

    for (let i = room.items.length - 1; i >= 0; i--) {
      const item = room.items[i];
      if (!item.isGrounded) {
        item.y += item.vy;
        if (item.y + item.height >= GROUND_Y) {
          item.y = GROUND_Y - item.height;
          item.isGrounded = true;
        }
      }

      playersArr.forEach(p => {
        if (!p || p.isKilled) return;
        const char = CHARACTERS[p.characterKey];
        const scale = p.senobicTimer > 0 ? 2 : 1;
        const curW = char.width * scale;
        const curH = char.height * scale;

        if (
          p.x < item.x + item.width &&
          p.x + curW > item.x &&
          p.y < item.y + item.height &&
          p.y + curH > item.y
        ) {
          if (item.type === 'senobic') {
            p.hp = p.maxHp;
            p.senobicTimer = 480;
            p.oneHitKill = true;
          } else if (item.type === 'heal') {
            p.hp = Math.min(p.maxHp, p.hp + 30);
          } else if (item.type === 'atk') {
            p.buffAtkTimer = 360;
          } else if (item.type === 'speed') {
            p.buffSpeedTimer = 360;
          }

          io.to(code).emit('itemCollected', { playerId: p.id, type: item.type });
          room.items.splice(i, 1);
        }
      });
    }

    const currentPlatforms = STAGES[room.selectedStage].platforms;

    playersArr.forEach(p => {
      if (!p) return;

      if (p.attackCooldown > 0) p.attackCooldown--;
      if (p.buffAtkTimer > 0) p.buffAtkTimer--;
      if (p.buffSpeedTimer > 0) p.buffSpeedTimer--;
      if (p.senobicTimer > 0) p.senobicTimer--;
      if (p.senobicTimer <= 0) p.oneHitKill = false;
      if (p.ultFutsuoTimer > 0) p.ultFutsuoTimer--;

      if (p.isKilled) {
        p.x += p.vx;
        p.y += p.vy;
        p.killTimer++;

        if (p.killTimer > 90) {
          if (p.lives > 0) {
            respawnPlayer(p);
          } else {
            const winner = playersArr.find(pl => pl && pl.id !== p.id);
            room.gameState = 'FINISHED';
            io.to(code).emit('gameOver', { winnerName: winner.name, winnerNum: winner.playerNum, isCpuMode: room.isCpuMode });
          }
        }
        return;
      }

      const char = CHARACTERS[p.characterKey];

      if (p.stunFrames > 0) {
        p.stunFrames--;
        p.vx = 0;
      }

      if (p.invincibleFrames > 0) {
        p.invincibleFrames--;
      }

      const prevY = p.y;
      p.vy += GRAVITY;
      p.x += p.vx;
      p.y += p.vy;

      p.isGrounded = false;
      const curH = char.height * (p.senobicTimer > 0 ? 2 : 1);

      if (p.y + curH >= GROUND_Y) {
        p.y = GROUND_Y - curH;
        p.vy = 0;
        p.isGrounded = true;
        p.jumpCount = 0;

        // チビコロの必殺技着地衝撃波
        if (p.ultChibikoroActive) {
          p.ultChibikoroActive = false;
          const defender = playersArr.find(pl => pl && pl.id !== p.id);
          if (defender && defender.invincibleFrames === 0) {
            defender.hp -= Math.round(char.atk * 2.2);
            defender.stunFrames = 20;
            defender.vy = -12;
            p.ultGauge = Math.min(100, p.ultGauge + 30);
            io.to(code).emit('koEffect', { victimId: defender.id, x: defender.x, y: defender.y });
          }
        }
      }

      if (p.vy >= 0) {
        currentPlatforms.forEach(plat => {
          const curW = char.width * (p.senobicTimer > 0 ? 2 : 1);
          if (
            p.x + curW > plat.x &&
            p.x < plat.x + plat.width &&
            prevY + curH <= plat.y &&
            p.y + curH >= plat.y
          ) {
            p.y = plat.y - curH;
            p.vy = 0;
            p.isGrounded = true;
            p.jumpCount = 0;
          }
        });
      }

      if (p.x < 0) p.x = 0;
      if (p.x + (char.width * (p.senobicTimer > 0 ? 2 : 1)) > STAGE_WIDTH) {
        p.x = STAGE_WIDTH - (char.width * (p.senobicTimer > 0 ? 2 : 1));
      }
    });

    playersArr.forEach((attacker) => {
      if (!attacker || attacker.isKilled) return;
      const defender = playersArr.find(p => p && p.id !== attacker.id);
      if (!defender || defender.isKilled) return;

      const defenderChar = CHARACTERS[defender.characterKey];
      const defScale = defender.senobicTimer > 0 ? 2 : 1;

      if (attacker.attackBox && defender.invincibleFrames === 0) {
        const ab = attacker.attackBox;
        const db = { x: defender.x, y: defender.y, width: defenderChar.width * defScale, height: defenderChar.height * defScale };

        if (
          ab.x < db.x + db.width &&
          ab.x + ab.width > db.x &&
          ab.y < db.y + db.height &&
          ab.y + ab.height > db.y
        ) {
          defender.hp -= ab.damage;

          // ダメージを与えたので必殺技ゲージが溜まる
          attacker.ultGauge = Math.min(100, attacker.ultGauge + Math.round(ab.damage * 1.8));

          const isArmored = (defenderChar.type === 'debugon' && defender.attacking) || defender.senobicTimer > 0;

          if (defender.hp <= 0) {
            defender.hp = 0;
            defender.lives--;
            defender.isKilled = true;
            defender.killTimer = 0;
            defender.vx = attacker.facing === 'right' ? 24 : -24;
            defender.vy = -20;
            io.to(code).emit('koEffect', { victimId: defender.id, x: defender.x, y: defender.y });
          } else if (!isArmored) {
            defender.stunFrames = 10;
            defender.vy = -5;
            defender.vx = attacker.facing === 'right' ? 12 : -12;
          }

          defender.invincibleFrames = 24;
          attacker.attackBox = null;
        }
      }
    });

    io.to(code).emit('updateState', { players: room.players, items: room.items, projectiles: room.projectiles });
  }
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (${GAME_VERSION})`);
});
