const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const games = new Map();

// bingoLogic functions moved here
function generateBingoCard() {
    const card = [];
    const columns = [
        { name: 'B', min: 1, max: 15 },
        { name: 'I', min: 16, max: 30 },
        { name: 'N', min: 31, max: 45 },
        { name: 'G', min: 46, max: 60 },
        { name: 'O', min: 61, max: 75 },
    ];

    for (let i = 0; i < 5; i++) {
        const row = [];
        for (let j = 0; j < 5; j++) {
            if (i === 2 && j === 2) {
                row.push({ value: 'FREE', isMarked: true, isFreeSpace: true });
            } else {
                const col = columns[j];
                let num;
                do {
                    num = Math.floor(Math.random() * (col.max - col.min + 1)) + col.min;
                } while (isNumberInColumn(card, j, num));
                row.push({ value: num, isMarked: false });
            }
        }
        card.push(row);
    }
    return card;
}

function isNumberInColumn(card, colIndex, num) {
    for (let i = 0; i < card.length; i++) {
        if (card[i][colIndex] && card[i][colIndex].value === num) {
            return true;
        }
    }
    return false;
}

function countCompletedLines(card) {
    let lines = 0;
    const size = card.length;

    // Check rows
    for (let i = 0; i < size; i++) {
        if (card[i].every(cell => cell.isMarked)) {
            lines++;
        }
    }

    // Check columns
    for (let j = 0; j < size; j++) {
        let isColumnComplete = true;
        for (let i = 0; i < size; i++) {
            if (!card[i][j].isMarked) {
                isColumnComplete = false;
                break;
            }
        }
        if (isColumnComplete) {
            lines++;
        }
    }

    // Check main diagonal (top-left to bottom-right)
    let isMainDiagonalComplete = true;
    for (let i = 0; i < size; i++) {
        if (!card[i][i].isMarked) {
            isMainDiagonalComplete = false;
            break;
        }
    }
    if (isMainDiagonalComplete) {
        lines++;
    }

    // Check anti-diagonal (top-right to bottom-left)
    let isAntiDiagonalComplete = true;
    for (let i = 0; i < size; i++) {
        if (!card[i][size - 1 - i].isMarked) {
            isAntiDiagonalComplete = false;
            break;
        }
    }
    if (isAntiDiagonalComplete) {
        lines++;
    }

    return lines;
}

wss.on('connection', ws => {
    ws.id = Math.random().toString(36).substring(2, 9);
    console.log(`Client connected with ID: ${ws.id}`);

    ws.send(JSON.stringify({ type: 'playerConnected', playerId: ws.id }));

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            console.log(`Received message from client ${ws.id}:`, data);

            switch (data.type) {
                case 'createGame':
                    const gameId = generateGameId();
                    const newPlayer = { ws, id: ws.id, name: data.playerName, card: generateBingoCard() };
                    const game = {
                        id: gameId,
                        players: [newPlayer],
                        turn: null,
                        calledNumbers: [],
                        state: 'waiting',
                    };
                    games.set(gameId, game);
                    ws.gameId = gameId;

                    ws.send(JSON.stringify({ type: 'gameCreated', gameId }));
                    console.log(`Game ${gameId} created by player ${ws.id}`);
                    break;

                case 'joinGame':
                    const { gameId: joinGameId, playerName } = data;
                    const existingGame = games.get(joinGameId);

                    if (!existingGame) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Game not found.' }));
                        return;
                    }
                    if (existingGame.players.length >= 2) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Game is full.' }));
                        return;
                    }

                    const newJoiningPlayer = { ws, id: ws.id, name: playerName, card: generateBingoCard() };
                    existingGame.players.push(newJoiningPlayer);
                    ws.gameId = joinGameId;
                    existingGame.state = 'playing';

                    const firstPlayer = existingGame.players[0];
                    existingGame.turn = firstPlayer.id;

                    existingGame.players.forEach(player => {
                        if (player.ws.readyState === WebSocket.OPEN) {
                            player.ws.send(JSON.stringify({
                                type: 'gameStarted',
                                gameId: existingGame.id,
                                firstPlayerId: firstPlayer.id,
                                card: player.card,
                            }));
                        }
                    });

                    console.log(`Player ${ws.id} joined game ${joinGameId}. Game started.`);
                    break;

                case 'callNumber':
                    const { gameId: callGameId, number } = data;
                    const gameToUpdate = games.get(callGameId);

                    if (!gameToUpdate || gameToUpdate.state !== 'playing' || gameToUpdate.turn !== ws.id) {
                        ws.send(JSON.stringify({ type: 'error', message: 'It is not your turn or invalid game state.' }));
                        return;
                    }

                    if (gameToUpdate.calledNumbers.includes(number)) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Number has already been called.' }));
                        return;
                    }

                    gameToUpdate.calledNumbers.push(number);

                    let winner = null;
                    let winnerName = null;

                    const updatedPlayerLines = {};

                    gameToUpdate.players.forEach(player => {
                        const tempCard = JSON.parse(JSON.stringify(player.card)); // Deep clone the card to avoid modifying original
                        const updatedCard = tempCard.map(row =>
                            row.map(cell => ({
                                ...cell,
                                isMarked: gameToUpdate.calledNumbers.includes(cell.value),
                            }))
                        );
                        const lines = countCompletedLines(updatedCard);
                        player.lines = lines;
                        updatedPlayerLines[player.id] = lines;
                        
                        if (lines >= 5) {
                            winner = player.id;
                            winnerName = player.name;
                        }
                    });

                    const currentPlayerIndex = gameToUpdate.players.findIndex(p => p.id === ws.id);
                    const nextPlayer = gameToUpdate.players[(currentPlayerIndex + 1) % gameToUpdate.players.length];
                    gameToUpdate.turn = nextPlayer.id;

                    gameToUpdate.players.forEach(player => {
                        if (player.ws.readyState === WebSocket.OPEN) {
                            player.ws.send(JSON.stringify({
                                type: 'numberCalled',
                                number,
                                nextPlayerId: nextPlayer.id,
                                calledNumbers: gameToUpdate.calledNumbers,
                                myLines: updatedPlayerLines[player.id],
                            }));
                        }
                    });

                    if (winner) {
                        gameToUpdate.state = 'over';
                        gameToUpdate.players.forEach(player => {
                            if (player.ws.readyState === WebSocket.OPEN) {
                                player.ws.send(JSON.stringify({
                                    type: 'gameOver',
                                    winnerId: winner,
                                    winnerName: winnerName,
                                }));
                            }
                        });
                    }
                    break;

                default:
                    ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type.' }));
                    break;
            }
        } catch (e) {
            console.error('Error processing message:', e);
            ws.send(JSON.stringify({ type: 'error', message: 'Server error processing your request.' }));
        }
    });

    ws.on('close', () => {
        console.log(`Client ${ws.id} disconnected`);
        const gameId = Array.from(games.keys()).find(id => games.get(id).players.some(p => p.ws === ws));
        if (gameId) {
            const game = games.get(gameId);
            game.players = game.players.filter(player => player.ws !== ws);

            if (game.players.length === 1) {
                const remainingPlayer = game.players[0];
                if (remainingPlayer.ws.readyState === WebSocket.OPEN) {
                    remainingPlayer.ws.send(JSON.stringify({
                        type: 'playerDisconnected',
                        message: 'Your opponent has disconnected. Game Over.'
                    }));
                }
                games.delete(game.id);
                console.log(`Game ${game.id} ended due to disconnection`);
            } else if (game.players.length === 0) {
                games.delete(game.id);
            }
        }
    });
});

const generateGameId = () => {
    let id = Math.random().toString(36).substring(2, 7).toUpperCase();
    while (games.has(id)) {
        id = Math.random().toString(36).substring(2, 7).toUpperCase();
    }
    return id;
};

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});