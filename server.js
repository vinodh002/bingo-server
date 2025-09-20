// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();

// simple health route so Render can check service
app.get('/', (req, res) => res.send('Bingo backend running ✅'));

// create HTTP server and attach WebSocket server to it
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const games = {};

wss.on('connection', (ws, req) => {
  console.log('Client connected from', req.socket.remoteAddress);

  ws.on('message', message => {
    let data;
    try { data = JSON.parse(message); }
    catch (e) { return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' })); }

    switch (data.type) {
      case 'createGame': {
        const gameId = Math.random().toString(36).substring(7);
        games[gameId] = { players: [ws], state: 'waiting', calledNumbers: [], turn: ws };
        ws.send(JSON.stringify({ type: 'gameCreated', gameId }));
        break;
      }
      case 'joinGame': {
        const game = games[data.gameId];
        if (game && game.players.length === 1) {
          game.players.push(ws);
          game.state = 'playing';
          game.players.forEach(p => p.send(JSON.stringify({ type: 'gameStarted', gameId: data.gameId })));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Game not found or full.' }));
        }
        break;
      }
      case 'callNumber': {
        const callerGame = Object.values(games).find(g => g.players.includes(ws) && g.turn === ws);
        if (callerGame && callerGame.state === 'playing' && !callerGame.calledNumbers.includes(data.number)) {
          callerGame.calledNumbers.push(data.number);
          callerGame.turn = callerGame.players.find(p => p !== ws);
          callerGame.players.forEach(p => p.send(JSON.stringify({ type: 'numberCalled', number: data.number })));
        }
        break;
      }
      case 'bingo': {
        const winningGame = Object.values(games).find(g => g.players.includes(ws));
        if (winningGame) {
          winningGame.players.forEach(p => {
            if (p !== ws) p.send(JSON.stringify({ type: 'gameOver', winner: 'opponent' }));
          });
        }
        break;
      }
      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    for (const gameId in games) {
      games[gameId].players = games[gameId].players.filter(p => p !== ws);
      if (games[gameId].players.length === 0) delete games[gameId];
    }
  });
});

// listen on port from environment (Render provides PORT)
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
