const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let rooms = {};
const FOODS = ['🍓 草莓', '🍫 巧克力', '🥛 牛奶', '🐟 魔法魚干'];
const SPAWN_POINTS =; // 四個角落位置

// 檢查兩格是否在 5x5 地圖上相鄰 (國王步：包含斜角)
function isAdjacent(pos1, pos2) {
    let r1 = Math.floor(pos1 / 5), c1 = pos1 % 5;
    let r2 = Math.floor(pos2 / 5), c2 = pos2 % 5;
    return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
}

io.on('connection', (socket) => {
    // 真人朋友加入房間 (支援多瀏覽器連線)
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
        
        // 防止同一個 Socket 重複加入
        let existing = rooms[roomId].players.find(p => p.id === socket.id);
        if (!existing) {
            rooms[roomId].players.push({ 
                id: socket.id, name: playerName, isAI: false, cards: [], pos: 0, inventory: [] 
            });
        }
        io.to(roomId).emit('roomUpdate', rooms[roomId]);
    });

    // 開始新遊戲 (或重新開始)
    socket.on('startGame', (roomId) => {
        let room = rooms[roomId];
        if (!room) return;

        // 1. 真人不足 4 人，自動補滿 AI
        const aiNames = ['貓主廚阿橘 (AI)', '偵探黑貓 (AI)', '店長三花 (AI)'];
        let aiCount = 1;
        while (room.players.length < 4) {
            room.players.push({ 
                id: 'AI_' + Math.random(), name: aiNames[aiCount - 1], 
                isAI: true, cards: [], pos: 0, inventory: [] 
            });
            aiCount++;
        }

        // 2. 初始化每位玩家的位置與清空背包
        room.players.forEach((p, idx) => {
            p.pos = SPAWN_POINTS[idx];
            p.inventory = [];
            p.cards = [];
        });

        // 3. 洗牌並隨機抽出謎底
        let recipes = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
        recipes.sort(() => Math.random() - 0.5);
        room.secretAnswer = recipes.pop();

        // 4. 平分剩下的提示卡
        room.players.forEach(p => {
            p.cards.push(recipes.pop());
            p.cards.push(recipes.pop());
        });

        room.gameStarted = true;
        room.turnIndex = 0;
        
        io.to(roomId).emit('gameStateUpdate', room);
        io.to(roomId).emit('gameLog', "🏁 貓貓廚房大門開啟！一場全新的完美配方爭奪戰開始了！");
    });

    // 處理玩家移動 (加入步數限制)
    socket.on('movePlayer', ({ roomId, targetPos }) => {
        let room = rooms[roomId];
        if (!room) return;

        let currentPlayer = room.players[room.turnIndex];
        // 安全機制：確認當前回合的 Socket ID 符合
        if (currentPlayer.id !== socket.id) return; 

        // 核心功能：限制只能走相鄰 1 格
        if (!isAdjacent(currentPlayer.pos, targetPos)) {
            socket.emit('moveResult', { success: false, msg: "❌ 貓咪腿不夠長！一次只能走相鄰的 1 格喔！" });
            return;
        }

        executeMove(room, currentPlayer, targetPos, roomId);
    });

    // 處理開爐判定
    socket.on('tryBake', ({ roomId, guessNumber }) => {
        let room = rooms[roomId];
        if (!room) return;
        let currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== socket.id) return;

        if (guessNumber === room.secretAnswer) {
            io.to(roomId).emit('gameOver', { winner: currentPlayer.name, answer: room.secretAnswer, msg: `🎉 祝賀！【${currentPlayer.name}】成功破解完美配方！正確解答正是 ${room.secretAnswer} 號！` });
        } else {
            socket.emit('bakeResult', { success: false, msg: `❌ 烘焙失敗！神祕配方不是 ${guessNumber} 號，線索刪除錯了唷！` });
            // 猜錯直接跳過下一位
            nextTurn(room, roomId);
        }
    });
});

function executeMove(room, player, targetPos, roomId) {
    player.pos = targetPos;
    let tileType = room.boardTiles[targetPos];
    let logMsg = `🐾 【${player.name}】走到了 ${tileType.split(' ')[1] || tileType}。`;

    if (tileType === '🍓 食材櫃') {
        let loot = FOODS[Math.floor(Math.random() * FOODS.length)];
        player.inventory.push(loot);
        logMsg += ` 順手撈到了 ${loot}！`;
    } else if (tileType === '🔍 辦公室') {
        let targets = room.players.filter(p => p.name !== player.name);
        let randomTarget = targets[Math.floor(Math.random() * targets.length)];
        if (randomTarget && randomTarget.cards.length > 0) {
            let randomCard = randomTarget.cards[Math.floor(Math.random() * randomTarget.cards.length)];
            logMsg += ` 暗中翻閱了線索。`;
            io.to(player.id).emit('intelFound', { msg: `🔍 祕報：你發現【${randomTarget.name}】手上有 【配方 ${randomCard} 號】，它絕對不是答案！` });
        }
    }

    io.to(roomId).emit('gameLog', logMsg);
    nextTurn(room, roomId);
}

function nextTurn(room, roomId) {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    let nextPlayer = room.players[room.turnIndex];
    io.to(roomId).emit('gameStateUpdate', room);

    // AI 智慧限制走位思考
    if (nextPlayer.isAI) {
        setTimeout(() => {
            let possibleMoves = [];
            for (let i = 0; i < 25; i++) {
                if (isAdjacent(nextPlayer.pos, i) && i !== nextPlayer.pos) {
                    possibleMoves.push(i);
                }
            }
            let aiTarget = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
            
            nextPlayer.pos = aiTarget;
            let tileType = room.boardTiles[aiTarget];
            let aiLog = `🤖 【${nextPlayer.name}】碎步走到第 ${aiTarget+1} 格`;
            
            if (tileType === '🍓 食材櫃') {
                let loot = FOODS[Math.floor(Math.random() * FOODS.length)];
                nextPlayer.inventory.push(loot);
                aiLog += ` 並咬走 ${loot}！`;
            }
            
            io.to(roomId).emit('gameLog', aiLog);
            nextTurn(room, roomId);
        }, 1200);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`正式連線伺服器就緒`));
