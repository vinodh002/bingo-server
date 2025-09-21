const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const games = new Map();

wss.on('connection', ws => {
    ws.id = Math.random().toString(36).substring(2, 9);
    console.log(`Client connected with ID: ${ws.id}`);

    // Send the player their unique ID upon connection
    ws.send(JSON.stringify({ type: 'playerConnected', playerId: ws.id }));

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            console.log(`Received message from client ${ws.id}:`, data);

            switch (data.type) {
                case 'createGame':
                    const gameId = generateGameId();
                    const game = {
                        id: gameId,
                        players: [ws],
                        turn: null, // Turn is set when the game starts
                        calledNumbers: [],
                        state: 'waiting',
                    };
                    games.set(gameId, game);
                    ws.gameId = gameId; // Associate the WebSocket with the game ID

                    ws.send(JSON.stringify({ type: 'gameCreated', gameId }));
                    console.log(`Game ${gameId} created by player ${ws.id}`);
                    break;

                case 'joinGame':
                    const { gameId: joinGameId } = data;
                    const existingGame = games.get(joinGameId);

                    if (!existingGame) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Game not found.' }));
                        return;
                    }
                    if (existingGame.players.length >= 2) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Game is full.' }));
                        return;
                    }

                    existingGame.players.push(ws);
                    ws.gameId = joinGameId;
                    existingGame.state = 'playing';

                    // Determine first player and set the turn
                    const firstPlayer = existingGame.players[0];
                    existingGame.turn = firstPlayer.id;

                    // Broadcast game start to both players
                    const messageToSend = {
                        type: 'gameStarted',
                        gameId: existingGame.id,
                        firstPlayerId: firstPlayer.id,
                    };
                    existingGame.players.forEach(player => {
                        if (player.readyState === WebSocket.OPEN) {
                            player.send(JSON.stringify(messageToSend));
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

                    // Update the turn to the other player
                    const nextPlayer = gameToUpdate.players.find(p => p.id !== ws.id);
                    gameToUpdate.turn = nextPlayer.id;

                    // Broadcast the called number and the next player's turn to both clients
                    const numberCalledMessage = {
                        type: 'numberCalled',
                        number,
                        nextPlayerId: nextPlayer.id,
                    };
                    gameToUpdate.players.forEach(player => {
                        if (player.readyState === WebSocket.OPEN) {
                            player.send(JSON.stringify(numberCalledMessage));
                        }
                    });
                    break;

                case 'bingo':
                    const { gameId: bingoGameId } = data;
                    const winningGame = games.get(bingoGameId);

                    if (!winningGame) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Game not found.' }));
                        return;
                    }

                    winningGame.state = 'over';

                    // Broadcast the win to all players
                    const winMessage = {
                        type: 'gameOver',
                        message: `Player ${ws.id} wins!`,
                        winnerId: ws.id,
                    };
                    winningGame.players.forEach(player => {
                        if (player.readyState === WebSocket.OPEN) {
                            player.send(JSON.stringify(winMessage));
                        }
                    });
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
        if (ws.gameId) {
            const game = games.get(ws.gameId);
            if (game) {
                game.players = game.players.filter(player => player.id !== ws.id);

                if (game.players.length === 1) {
                    const remainingPlayer = game.players[0];
                    if (remainingPlayer.readyState === WebSocket.OPEN) {
                        remainingPlayer.send(JSON.stringify({
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