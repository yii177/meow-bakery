const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public')); // 讓前端檔案可以被瀏覽

let rooms = {}; // 存放所有房間資料

io.on('connection', (socket) => {
    console.log(`玩家連線: ${socket.id}`);

    // 玩家創建或加入房間
    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                players: [],
                gameStarted: false,
                secretAnswer: null
            };
        }

        rooms[roomId].players.push({ id: socket.id, name: playerName, isAI: false, cards: [] });
        io.to(roomId).emit('roomUpdate', rooms[roomId]);
    });

    // 啟動遊戲（含 AI 補位與手牌分配）
    socket.on('startGame', (roomId) => {
        let room = rooms[roomId];
        if (!room) return;

        // 1. 如果不滿 4 人，自動補滿 AI
        const aiNames = ['實習貓阿橘', '神廚黑貓', '精明三花', '波斯主廚'];
        while (room.players.length < 4) {
            let randomAI = aiNames[room.players.length % aiNames.length] + " (AI)";
            room.players.push({ id: 'AI_' + Math.random(), name: randomAI, isAI: true, difficulty: 'normal', cards: [] });
        }

        // 2. 初始化 10 張配方卡，抽出一張當謎底
        let recipes =;
        recipes.sort(() => Math.random() - 0.5);
        room.secretAnswer = recipes.pop(); // 謎底藏起來

        // 3. 將剩下的 9 張牌平分給 4 位玩家（每人2張，餘1張公開或洗入食材堆）
        room.players.forEach(player => {
            player.cards.push(recipes.pop());
            player.cards.push(recipes.pop());
        });

        room.gameStarted = true;
        io.to(roomId).emit('gameStarted', {
            players: room.players,
            leftOverCard: recipes[0] // 剩下的一張公開卡
        });
    });

    socket.on('disconnect', () => {
        console.log('玩家斷開連線');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`網頁遊戲伺服器運行在 port ${PORT}`));
