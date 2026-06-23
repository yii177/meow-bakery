const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

let rooms = {};
const FOODS = ['🍓 草莓', '🍫 巧克力', '🥛 牛奶', '🐟 魔法魚干'];
const SPAWN_POINTS =; // 修正後完美的四個角落座標

// 檢查是否相鄰（國王步，含斜角）
function isAdjacent(pos1, pos2) {
    let r1 = Math.floor(pos1 / 5), c1 = pos1 % 5;
    let r2 = Math.floor(pos2 / 5), c2 = pos2 % 5;
    return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
}

// 統計陣列中各元素數量的工具函式
function countItems(arr) {
    let counts = {};
    arr.forEach(x => counts[x] = (counts[x] || 0) + 1);
    return counts;
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId, players: [], gameStarted: false, secretAnswer: null, turnIndex: 0,
                boardTiles: Array(25).fill('🧱 流理台'),
                recipe10Combo: [FOODS[Math.floor(Math.random() * 4)], FOODS[Math.floor(Math.random() * 4)]]
            };
            for(let i=0; i<25; i++) {
                if(i===12) rooms[roomId].boardTiles[i] = '🏪 店鋪櫃台';
                else if(i%4===0) rooms[roomId].boardTiles[i] = '🍓 食材櫃';
                else if(i===6) rooms[roomId].boardTiles[i] = '🔍 辦公室';
                else if(i===18) rooms[roomId].boardTiles[i] = '🏛️ 圖書館';
                else if(i===8 || i===16) rooms[roomId].boardTiles[i] = '🍳 加工區';
            }
        }
        let existing = rooms[roomId].players.find(p => p.id === socket.id);
        if (!existing) {
            rooms[roomId].players.push({ 
                id: socket.id, name: playerName, isAI: false, cards: [], pos: 0, inventory: [], previousPos: -1, craftedProduct: null
            });
        }
        io.to(roomId).emit('gameStateUpdate', rooms[roomId]);
    });

    socket.on('startGame', (roomId) => {
        let room = rooms[roomId];
        if (!room) return;

        room.players = room.players.filter(p => !p.isAI);
        const aiNames = ['阿橘主廚 (AI)', '黑貓偵探 (AI)', '三花店長 (AI)'];
        let aiCount = 1;
        while (room.players.length < 4) {
            room.players.push({ 
                id: 'AI_' + Math.random(), name: aiNames[aiCount - 1], isAI: true, cards: [], pos: 0, inventory: [], previousPos: -1, craftedProduct: null
            });
            aiCount++;
        }

        room.players.sort(() => Math.random() - 0.5);

        room.players.forEach((p, idx) => {
            p.pos = SPAWN_POINTS[idx];
            p.inventory = [];
            p.cards = [];
            p.previousPos = -1;
            p.craftedProduct = null;
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
        io.to(roomId).emit('gameLog', "🏁 貓貓廚房開賽！【採集 ➔ 加工 ➔ 上架】大作戰正式爆發！");
        
        checkAITurn(room, roomId);
    });
    socket.on('pushGrid', ({ roomId, type, index }) => {
        let room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        let currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== socket.id) return;

        // 🛡️【中央定海神針防禦】：正中間是 index 2，如果想推中央直接擋掉，保護店鋪櫃台！
        if (index === 2) {
            socket.emit('moveResult', { success: false, msg: "❌ 這裡是店鋪正中央大核心，不能推動這一排喔！" });
            return;
        }

        let tiles = room.boardTiles;
        if (type === 'row') {
            let rowStart = index * 5;
            let temp = tiles[rowStart + 4];
            for (let i = 4; i > 0; i--) tiles[rowStart + i] = tiles[rowStart + i - 1];
            tiles[rowStart] = temp;
        } else {
            let temp = tiles[20 + index];
            for (let i = 4; i > 0; i--) tiles[i * 5 + index] = tiles[(i - 1) * 5 + index];
            tiles[index] = temp;
        }

        io.to(roomId).emit('gameLog', `💨 【${currentPlayer.name}】甩尾發動了大風吹，強行推動了地圖！`);
        
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        io.to(roomId).emit('gameStateUpdate', room);
        checkAITurn(room, roomId);
    });

    socket.on('movePlayer', ({ roomId, targetPos }) => {
        let room = rooms[roomId];
        if (!room) return;
        let currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== socket.id) return;

        if (currentPlayer.pos === targetPos) {
            socket.emit('moveResult', { success: false, msg: "❌ 禁止原地刷物資！你這回合必須移動到其他格子！" });
            return;
        }
        if (!isAdjacent(currentPlayer.pos, targetPos)) {
            socket.emit('moveResult', { success: false, msg: "❌ 一次只能走相鄰的 1 格喔！" });
            return;
        }

        currentPlayer.previousPos = currentPlayer.pos;
        currentPlayer.pos = targetPos;
        let tileType = room.boardTiles[targetPos];

        if (tileType === '🍓 食材櫃') {
            let loot = FOODS[Math.floor(Math.random() * FOODS.length)];
            currentPlayer.inventory.push(loot);
            io.to(roomId).emit('gameLog', `🐾 【${currentPlayer.name}】移動到食材櫃，並採集到 ${loot}！`);
        } else if (tileType === '🔍 辦公室') {
            let targets = room.players.filter(p => p.name !== currentPlayer.name);
            let randomTarget = targets[Math.floor(Math.random() * targets.length)];
            if (randomTarget && randomTarget.cards.length > 0) {
                let randomCard = randomTarget.cards[Math.floor(Math.random() * randomTarget.cards.length)];
                // 🔒【辦公室修正】：全場日誌只留紀錄，絕不把配方數字印出來！
                io.to(roomId).emit('gameLog', `🐾 【${currentPlayer.name}】悄悄走進了 🔍 辦公室暗中翻閱日記...`);
                // 🔒 單獨密報給踩到格子的人，心機完美保密
                if (!currentPlayer.isAI) {
                    io.to(currentPlayer.id).emit('intelFound', { msg: `🔍 【辦公室私密密報】：你悄悄翻閱了 ${randomTarget.name} 的筆記，發現他手上有【配方 ${randomCard} 號】！這張牌絕對不是謎底，趕快偷偷在筆記本劃掉！` });
                }
            } else {
                io.to(roomId).emit('gameLog', `🐾 【${currentPlayer.name}】走到了辦公室，但沒發現新日記。`);
            }
        } else if (tileType === '🏛️ 圖書館') {
            // 📢【圖書館大公開】：直接明明白白廣播給全場，印在所有人的日誌上！
            let pool = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].filter(x => x !== room.secretAnswer);
            let broadcastCard = pool[Math.floor(Math.random() * pool.length)];
            io.to(roomId).emit('gameLog', `🐾 【${currentPlayer.name}】翻開了圖書館的絕密古籍！`);
            io.to(roomId).emit('gameLog', `📢 【圖書館大公報】：全場注意！確認【配方 ${broadcastCard} 號】絕非大謎底！請所有人立刻將其排除！`);
        } else {
            io.to(roomId).emit('gameLog', `🐾 【${currentPlayer.name}】移動到了第 ${targetPos+1} 格 (${tileType.replace('<br>','')})`);
        }

        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        io.to(roomId).emit('gameStateUpdate', room);
        checkAITurn(room, roomId);
    });
    socket.on('combineRecipe', ({ roomId, recipeNum }) => {
        let room = rooms[roomId];
        if (!room) return;
        let currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== socket.id) return;

        if (room.boardTiles[currentPlayer.pos] !== '🍳 加工區') {
            socket.emit('intelFound', { msg: "❌ 你必須先走到「🍳 加工區」才能進行食材加工！" });
            return;
        }

        let inv = currentPlayer.inventory;
        let counts = countItems(inv);
        let success = false;
        let pName = "";

        if (recipeNum === "01" && counts['🍓 草莓'] >= 2 && counts['🥛 牛奶'] >= 1) {
            inv.splice(inv.indexOf('🍓 草莓'), 1); inv.splice(inv.indexOf('🍓 草莓'), 1); inv.splice(inv.indexOf('🥛 牛奶'), 1);
            success = true; pName = "🎁 草莓重乳酪成品";
        } else if (recipeNum === "02" && counts['🍫 巧克力'] >= 2 && counts['🐟 魔法魚干'] >= 1) {
            inv.splice(inv.indexOf('🍫 巧克力'), 1); inv.splice(inv.indexOf('🍫 巧克力'), 1); inv.splice(inv.indexOf('🐟 魔法魚干'), 1);
            success = true; pName = "🎁 濃情巧克力成品";
        } else if (recipeNum === "03" && counts['🐟 魔法魚干'] >= 3) {
            inv.splice(inv.indexOf('🐟 魔法魚干'), 1); inv.splice(inv.indexOf('🐟 魔法魚干'), 1); inv.splice(inv.indexOf('🐟 魔法魚干'), 1);
            success = true; pName = "🎁 魔法魚干派成品";
        } else if (recipeNum === "04" && inv.length >= 4) {
            let pairs = 0;
            for(let key in counts) { if(counts[key] >= 2) pairs++; }
            if(pairs >= 2) { success = true; pName = "🎁 甜甜雙拼成品"; currentPlayer.inventory = []; }
        } else if (recipeNum === "05" && counts['🍓 草莓'] >= 1 && counts['🍫 巧克力'] >= 1 && counts['🥛 牛奶'] >= 1) {
            inv.splice(inv.indexOf('🍓 草莓'), 1); inv.splice(inv.indexOf('🍫 巧克力'), 1); inv.splice(inv.indexOf('🥛 牛奶'), 1);
            success = true; pName = "🎁 水果巧克力成品";
        } else if (recipeNum === "06" && counts['🍫 巧克力'] >= 2 && counts['🥛 牛奶'] >= 2) {
            inv.splice(inv.indexOf('🍫 巧克力'), 1); inv.splice(inv.indexOf('🍫 巧克力'), 1); inv.splice(inv.indexOf('🥛 牛奶'), 1); inv.splice(inv.indexOf('🥛 牛奶'), 1);
            success = true; pName = "🎁 巧克力牛奶糖成品";
        } else if (recipeNum === "10") {
            let r1 = room.recipe10Combo, r2 = room.recipe10Combo;
            if (counts[r1] >= 1 && counts[r2] >= 1) {
                inv.splice(inv.indexOf(r1), 1); inv.splice(inv.indexOf(r2), 1);
                success = true; pName = "🎁 主廚隨機隱藏套餐";
            }
        }

        if (success) {
            currentPlayer.craftedProduct = pName;
            io.to(roomId).emit('gameLog', `🍳 【${currentPlayer.name}】在加工區成功將食材精煉成了 【${pName}】！`);
            
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('gameStateUpdate', room);
            checkAITurn(room, roomId);
        } else {
            socket.emit('intelFound', { msg: "❌ 背包物資不符合該配方的加工需求喔！請對照右側菜單！" });
        }
    });

    socket.on('tryBake', ({ roomId, guessNumber }) => {
        let room = rooms[roomId];
        if (!room) return;
        let currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== socket.id) return;

        if (room.boardTiles[currentPlayer.pos] !== '🏪 店鋪櫃台') {
            socket.emit('bakeResult', { success: false, msg: "❌ 你必須親自走到正中央的「🏪 店鋪櫃台」才能商品上架！" });
            return;
        }

        if (guessNumber !== room.secretAnswer) {
            socket.emit('bakeResult', { success: false, msg: `❌ 搞錯了！店鋪不賣 ${guessNumber} 號商品，上架被退回！` });
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('gameStateUpdate', room);
            checkAITurn(room, roomId);
            return;
        }

        let inv = currentPlayer.inventory;
        let counts = countItems(inv);
        let win = false;

        if (["01","02","03","04","05","06","10"].includes(guessNumber)) {
            if (currentPlayer.craftedProduct) win = true;
            else { socket.emit('bakeResult', { success: false, msg: "❌ 這道甜點需要先去「🍳 加工區」合成包裝成品才能拿來上架喔！" }); return; }
        } else if (guessNumber === "07" && !inv.includes('🐟 魔法魚干') && inv.length >= 3) win = true;
        else if (guessNumber === "08" && inv.length >= 5) win = true;
        else if (guessNumber === "09" && Object.keys(counts).length >= 4) win = true;

        if (win) {
            io.to(roomId).emit('gameOver', { winner: currentPlayer.name, msg: `🏆 🎉 狂賀！【${currentPlayer.name}】成功把正確配方 ${room.secretAnswer} 號商品在「🏪 店鋪櫃台」上架販售，贏得了貓貓麵包店的總冠軍！！` });
        } else {
            socket.emit('bakeResult', { success: false, msg: "❌ 雖然你猜中了配方，但你背包裡的食材不符合該配方的直接上架規定喔！" });
        }
    });
});

function checkAITurn(room, roomId) {
    if (!room.gameStarted) return;
    let nextPlayer = room.players[room.turnIndex];
    
    if (nextPlayer && nextPlayer.isAI) {
        setTimeout(() => {
            if(Math.random() > 0.85) {
                let allowedLines =;
                let t = ['row', 'col'][Math.floor(Math.random()*2)], idx = allowedLines[Math.floor(Math.random()*4)];
                io.to(roomId).emit('gameLog', `🤖 【${nextPlayer.name}】在思考後，甩尾發動了大風吹！`);
                
                let tiles = room.boardTiles;
                if (t === 'row') {
                    let rowStart = idx * 5; let temp = tiles[rowStart + 4];
                    for (let i = 4; i > 0; i--) tiles[rowStart + i] = tiles[rowStart + i - 1];
                    tiles[rowStart] = temp;
                } else {
                    let temp = tiles[20 + idx];
                    for (let i = 4; i > 0; i--) tiles[i * 5 + idx] = tiles[(i - 1) * 5 + idx];
                    tiles[idx] = temp;
                }
                io.to(roomId).emit('gameLog', `💨 地形被推動了大風吹！`);
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
                io.to(roomId).emit('gameStateUpdate', room);
                checkAITurn(room, roomId);
                return;
            }
            let possibleMoves = [nextPlayer.pos+1, nextPlayer.pos-1, nextPlayer.pos+5, nextPlayer.pos-5].filter(p => p>=0 && p<25 && p!==nextPlayer.pos);
            let aiTarget = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
            nextPlayer.pos = aiTarget;
            let tileType = room.boardTiles[aiTarget];
            let aiLog = `🤖 【${nextPlayer.name}】碎步移動到第 ${aiTarget+1} 格 (${tileType.replace('<br>','')})`;
            if (tileType === '🍓 食材櫃') {
                nextPlayer.inventory.push(FOODS[Math.floor(Math.random() * FOODS.length)]);
            }
            io.to(roomId).emit('gameLog', aiLog);
            
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomId).emit('gameStateUpdate', room);
            checkAITurn(room, roomId);
        }, 1000);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`生產上架伺服器運行中`));
