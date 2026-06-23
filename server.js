    // 處理移動走位（防原地刷物資、辦公室個人密報、圖書館全場大公報）
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
        let logMsg = `🐾 【${currentPlayer.name}】移動到第 ${targetPos+1} 格 (${tileType.replace('<br>','')})`;

        if (tileType === '🍓 食材櫃') {
            let loot = FOODS[Math.floor(Math.random() * FOODS.length)];
            currentPlayer.inventory.push(loot);
            logMsg += ` 並採集到 ${loot}！`;
            io.to(roomId).emit('gameLog', logMsg);
        } else if (tileType === '🔍 辦公室') {
            // 💼 辦公室功能：精準的【個人私密密報】
            let targets = room.players.filter(p => p.name !== currentPlayer.name);
            let randomTarget = targets[Math.floor(Math.random() * targets.length)];
            if (randomTarget && randomTarget.cards.length > 0) {
                let randomCard = randomTarget.cards[Math.floor(Math.random() * randomTarget.cards.length)];
                logMsg += ` 進入辦公室暗中翻閱了個人線索。`;
                io.to(roomId).emit('gameLog', logMsg);
                // 只發送給踩到格子的該位玩家，不公開給全場
                io.to(currentPlayer.id).emit('intelFound', { msg: `🔍 【辦公室密報】：你悄悄翻閱了 ${randomTarget.name} 的筆記，發現他手上有【配方 ${randomCard} 號】！這張牌絕對不是謎底，你可以偷偷把它劃掉，不要告訴別人喔！` });
            } else {
                io.to(roomId).emit('gameLog', logMsg);
            }
        } else if (tileType === '🏛️ 圖書館') {
            // 🏛️ 圖書館功能：震撼的【全場公開公報】，徹底修復日誌不顯示 Bug
            let pool = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].filter(x => x !== room.secretAnswer);
            let broadcastCard = pool[Math.floor(Math.random() * pool.length)];
            logMsg += ` 觸發了圖書館的【全場公開公報】！`;
            io.to(roomId).emit('gameLog', logMsg);
            // 用廣播大喊，將被剔除的號碼直接清清楚楚印在日誌欄，全場同步得知！
            io.to(roomId).emit('gameLog', `📢 【圖書館大公報】：經過全場搜查，確認【配方 ${broadcastCard} 號】絕非本次的完美配方！請所有玩家立刻在筆記本上將其排除！`);
        } else {
            io.to(roomId).emit('gameLog', logMsg);
        }

        // 切換回合
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        io.to(roomId).emit('gameStateUpdate', room);
        
        // 觸發 AI 回合
        checkAITurn(room, roomId);
    });

    // 處理加工區合成（01-06, 10 需要加工）
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

    // 🏪 店鋪櫃台上架判定
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
    let nextPlayer = room.players[room.turnIndex];
    if (nextPlayer && nextPlayer.isAI && room.gameStarted) {
        setTimeout(() => {
            if(Math.random() > 0.8) {
                let indices =;
                let idx = indices[Math.floor(Math.random()*5)];
                io.to(roomId).emit('gameLog', `🤖 【${nextPlayer.name}】在思考後，甩尾發動了大風吹！`);
                
                let tiles = room.boardTiles;
                let rowStart = idx * 5; let temp = tiles[rowStart + 4];
                for (let i = 4; i > 0; i--) tiles[rowStart + i] = tiles[rowStart + i - 1];
                tiles[rowStart] = temp;
                
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
