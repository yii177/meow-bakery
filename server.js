const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let rooms = {};
const FOODS = ['🍓 草莓', '🍫 巧克力', '🥛 牛奶', '🐟 魔法魚干'];
const SPAWN_POINTS = [0, 4, 20, 24];

function isAdjacent(pos1, pos2) {
    let r1 = Math.floor(pos1 / 5), c1 = pos1 % 5;
    let r2 = Math.floor(pos2 / 5), c2 = pos2 % 5;
    return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId, players: [], gameStarted: false, secretAnswer: null, turnIndex: 0,
                boardTiles: Array(25).fill('🧱 流理台')
            };
            for(let i=0; i<25; i++) {
                if(i===12) rooms[roomId].boardTiles[i] = '🍳 中央烤爐';
                else if(i%4===0) rooms[roomId].boardTiles[i] = '🍓 食材櫃';
                else if(i===6 || i===18) rooms[roomId].boardTiles[i] = '🔍 辦公室';
            }
        }
        let existing = rooms[roomId].players.find(p => p.id === socket.id);
        if (!existing) {
            rooms[roomId].players.push({ 
                id: socket.id, name: playerName, isAI: false, cards: [], pos: 0, inventory: [] 
            });
        }
        io.to(roomId).emit('gameStateUpdate', rooms[roomId]);
    });

    socket.on('startGame', (roomId) => {
        let room = rooms[roomId];
        if (!room) return;

        room.players = room.players.filter(p => !p.isAI);
        const aiNames = ['貓主廚阿橘 (AI)', '偵探黑貓 (AI)', '店長三花 (AI)'];
        let aiCount = 1;
        while (room.players.length < 4) {
            room.players.push({ 
                id: 'AI_' + Math.random(), name: aiNames[aiCount - 1], isAI: true, cards: [], pos: 0, inventory: [] 
            });
            aiCount++;
        }

        room.players.forEach((p, idx) => {
            p.pos = SPAWN_POINTS[idx];
            p.inventory = [];
            p.cards = [];
        });

        let recipes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
        recipes.sort(() => Math.random() - 0.5);
        room.secretAnswer = recipes.pop();

        room.players.forEach(p => {
            p.cards.push(recipes.pop());
            p.cards.push(recipes.pop());
        });

        room.gameStarted = true;
        room.turnIndex = 0;
        
        io.to(roomId).emit('gameStateUpdate', room);
    });

    socket.on('movePlayer', ({ roomId, targetPos }) => {
        let room = rooms[roomId];
        if (!room) return;
        let currentPlayer = room.players[room.turnIndex];
        
        // 核心修復：如果玩家位置未定義，賦予預設值防呆
        if(currentPlayer.pos === undefined) currentPlayer.pos = 0;

        if (!isAdjacent(currentPlayer.pos, targetPos)) {
            socket.emit('moveResult', { success: false, msg: "❌ 一次只能走相鄰的 1 格喔！" });
            return;
        }

        currentPlayer.pos = targetPos;
        let tileType = room.boardTiles[targetPos];
        let logMsg = `🐾 【${currentPlayer.name}】移動到第 ${targetPos+1} 格 (${tileType.replace('<br>','')})`;

        if (tileType === '🍓 食材櫃') {
            let loot = FOODS[Math.floor(Math.random() * FOODS.length)];
            currentPlayer.inventory.push(loot);
            logMsg += ` 獲得了 ${loot}！`;
        } else if (tileType === '🔍 辦公室') {
            let targets = room.players.filter(p => p.name !== currentPlayer.name);
            let randomTarget = targets[Math.floor(Math.random() * targets.length)];
            if (randomTarget && randomTarget.cards.length > 0) {
                let randomCard = randomTarget.cards[Math.floor(Math.random() * randomTarget.cards.length)];
                io.to(currentPlayer.id).emit('intelFound', { msg: `🔍 祕報：你發現【${randomTarget.name}】手上有 【配方 ${randomCard} 號】，它絕對不是答案！` });
            }
        }

        io.to(roomId).emit('gameLog', logMsg);
        
        // 切換回合
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        io.to(roomId).emit('gameStateUpdate', room);
        
        // 觸發 AI 回合
        checkAITurn(room, roomId);
    });

    socket.on('tryBake', ({ roomId, guessNumber }) => {
        let room = rooms[roomId];
        if (!room) return;
        let currentPlayer = room.players[room.turnIndex];
        if (guessNumber === room.secretAnswer) {
            io.to(roomId).emit('gameOver', { winner: currentPlayer.name, answer: room.secretAnswer, msg: `🎉 祝賀！【${currentPlayer.name}】成功破解完美配方！正確解答正是 ${room.secretAnswer} 號！` });
        } else {
            socket.emit('bakeResult', { success: false, msg: `❌ 烘焙失敗！配方不是 ${guessNumber} 號！` });
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('gameStateUpdate', room);
            checkAITurn(room, roomId);
        }
    });
});

function checkAITurn(room, roomId) {
    let nextPlayer = room.players[room.turnIndex];
    if (nextPlayer && nextPlayer.isAI && room.gameStarted) {
        setTimeout(() => {
            let possibleMoves = [];
            for (let i = 0; i < 25; i++) {
                if (isAdjacent(nextPlayer.pos, i) && i !== nextPlayer.pos) possibleMoves.push(i);
            }
            let aiTarget = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
            nextPlayer.pos = aiTarget;
            
            let tileType = room.boardTiles[aiTarget];
            let aiLog = `🤖 【${nextPlayer.name}】碎步走到第 ${aiTarget+1} 格`;
            if (tileType === '🍓 食材櫃') {
                let loot = FOODS[Math.floor(Math.random() * FOODS.length)];
                nextPlayer.inventory.push(loot);
                aiLog += ` 並拿走 ${loot}！`;
            }
            io.to(roomId).emit('gameLog', aiLog);
            
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('gameStateUpdate', room);
            checkAITurn(room, roomId);
        }, 1000);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`伺服器啟動`));
