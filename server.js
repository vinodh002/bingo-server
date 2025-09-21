// const express = require('express');
// const http = require('http');
// const WebSocket = require('ws');

// const app = express();

// app.get('/', (req, res) => res.send('Bingo backend running ✅'));

// const server = http.createServer(app);
// const wss = new WebSocket.Server({ server });

// const games = {};

// wss.on('connection', ws => {
//   console.log('Client connected');
//   const playerId = Math.random().toString(36).substring(2, 10);
//   ws.playerId = playerId;

//   ws.on('message', message => {
//     let data;
//     try {
//       data = JSON.parse(message);
//     } catch (e) {
//       return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
//     }

//     switch (data.type) {
//       case 'createGame': {
//         const gameId = Math.random().toString(36).substring(2, 7).toUpperCase();
//         games[gameId] = { players: [ws], state: 'waiting', calledNumbers: [], turn: ws };
//         ws.send(JSON.stringify({ type: 'gameCreated', gameId }));
//         console.log(`Game ${gameId} created by player ${playerId}`);
//         break;
//       }
//       case 'joinGame': {
//         const game = games[data.gameId];
//         if (game && game.players.length === 1 && game.state === 'waiting') {
//           game.players.push(ws);
//           game.state = 'playing';

//           // Randomly decide who goes first
//           const firstPlayer = game.players[Math.floor(Math.random() * 2)];
//           game.turn = firstPlayer;

//           game.players.forEach(p => {
//             p.send(JSON.stringify({
//               type: 'gameStarted',
//               gameId: data.gameId,
//               firstPlayerId: firstPlayer.playerId,
//             }));
//           });
//           console.log(`Player ${playerId} joined game ${data.gameId}. Game started.`);
//         } else {
//           ws.send(JSON.stringify({ type: 'error', message: 'Game not found or is full.' }));
//         }
//         break;
//       }
//       case 'callNumber': {
//         const game = Object.values(games).find(g => g.players.includes(ws));
//         if (game && game.state === 'playing' && game.turn === ws && !game.calledNumbers.includes(data.number)) {
//           game.calledNumbers.push(data.number);

//           // Find the opponent
//           const opponent = game.players.find(p => p !== ws);
//           game.turn = opponent;

//           // Broadcast the number to both players
//           game.players.forEach(p => p.send(JSON.stringify({ type: 'numberCalled', number: data.number })));
//           console.log(`Player ${playerId} called number ${data.number} in game ${game.gameId}`);
//         } else {
//           ws.send(JSON.stringify({ type: 'error', message: 'It is not your turn or invalid number.' }));
//         }
//         break;
//       }
//       case 'bingo': {
//         const game = Object.values(games).find(g => g.players.includes(ws));
//         if (game) {
//           game.state = 'gameOver';
//           game.players.forEach(p => {
//             const message = p === ws ? 'You won!' : 'The other player won!';
//             p.send(JSON.stringify({ type: 'gameOver', winner: ws.playerId, message }));
//           });
//           delete games[Object.keys(games).find(key => games[key] === game)];
//           console.log(`Game ${Object.keys(games).find(key => games[key] === game)} ended. Winner: ${ws.playerId}`);
//         }
//         break;
//       }
//       default:
//         ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
//     }
//   });

//   ws.on('close', () => {
//     console.log(`Client ${playerId} disconnected`);
//     for (const gameId in games) {
//       if (games[gameId].players.includes(ws)) {
//         games[gameId].players = games[gameId].players.filter(p => p !== ws);
//         if (games[gameId].players.length === 0) {
//           delete games[gameId];
//           console.log(`Game ${gameId} cleaned up due to disconnection`);
//         } else {
//           const opponent = games[gameId].players[0];
//           if (opponent.readyState === WebSocket.OPEN) {
//             opponent.send(JSON.stringify({ type: 'gameOver', message: 'Opponent disconnected.' }));
//           }
//           delete games[gameId];
//           console.log(`Game ${gameId} ended due to disconnection`);
//         }
//       }
//     }
//   });
// });

// const PORT = process.env.PORT || 8080;
// server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));




// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();

app.get('/', (req, res) => res.send('Bingo backend running ✅'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const games = {};

wss.on('connection', ws => {
  console.log('Client connected');
  const playerId = Math.random().toString(36).substring(2, 10);
  ws.playerId = playerId;

  ws.on('message', message => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }

    // --- ADD THIS LOG STATEMENT ---
    console.log('Received message from client:', data);
    console.log('Client ID:', ws.playerId);
    // --- END OF LOG STATEMENT ---

    switch (data.type) {
      case 'createGame': {
        const gameId = Math.random().toString(36).substring(2, 7).toUpperCase();
        games[gameId] = { players: [ws], state: 'waiting', calledNumbers: [], turn: ws };
        ws.send(JSON.stringify({ type: 'gameCreated', gameId }));
        console.log(`Game ${gameId} created by player ${playerId}`);
        break;
      }
      case 'joinGame': {
        const game = games[data.gameId];
        if (game && game.players.length === 1 && game.state === 'waiting') {
          game.players.push(ws);
          game.state = 'playing';

          const firstPlayer = game.players[Math.floor(Math.random() * 2)];
          game.turn = firstPlayer;

          game.players.forEach(p => {
            p.send(JSON.stringify({
              type: 'gameStarted',
              gameId: data.gameId,
              firstPlayerId: firstPlayer.playerId,
            }));
          });
          console.log(`Player ${playerId} joined game ${data.gameId}. Game started.`);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Game not found or is full.' }));
        }
        break;
      }
      case 'callNumber': {
        const game = Object.values(games).find(g => g.players.includes(ws));
        if (game && game.state === 'playing' && game.turn === ws && !game.calledNumbers.includes(data.number)) {
          game.calledNumbers.push(data.number);

          const opponent = game.players.find(p => p !== ws);
          game.turn = opponent;

          game.players.forEach(p => p.send(JSON.stringify({ type: 'numberCalled', number: data.number })));
          console.log(`Player ${playerId} called number ${data.number} in game ${game.gameId}`);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'It is not your turn or invalid number.' }));
        }
        break;
      }
      case 'bingo': {
        const game = Object.values(games).find(g => g.players.includes(ws));
        if (game) {
          game.state = 'gameOver';
          game.players.forEach(p => {
            const message = p === ws ? 'You won!' : 'The other player won!';
            p.send(JSON.stringify({ type: 'gameOver', winner: ws.playerId, message }));
          });
          delete games[Object.keys(games).find(key => games[key] === game)];
          console.log(`Game ${Object.keys(games).find(key => games[key] === game)} ended. Winner: ${ws.playerId}`);
        }
        break;
      }
      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  });

  ws.on('close', () => {
    console.log(`Client ${playerId} disconnected`);
    for (const gameId in games) {
      if (games[gameId].players.includes(ws)) {
        games[gameId].players = games[gameId].players.filter(p => p !== ws);
        if (games[gameId].players.length === 0) {
          delete games[gameId];
          console.log(`Game ${gameId} cleaned up due to disconnection`);
        } else {
          const opponent = games[gameId].players[0];
          if (opponent.readyState === WebSocket.OPEN) {
            opponent.send(JSON.stringify({ type: 'gameOver', message: 'Opponent disconnected.' }));
          }
          delete games[gameId];
          console.log(`Game ${gameId} ended due to disconnection`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));