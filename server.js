// server.js
const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/** ----------------- Bingo utils (server-side authoritative) ----------------- **/

// Cell = { value: number, isMarked: boolean }
function generateCard() {
  const nums = Array.from({ length: 25 }, (_, i) => i + 1);
  // Fisher–Yates shuffle
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  const card = [];
  for (let r = 0; r < 5; r++) {
    const row = [];
    for (let c = 0; c < 5; c++) {
      row.push({ value: nums[r * 5 + c], isMarked: false });
    }
    card.push(row);
  }
  return card;
}

function markCard(card, calledNumbers) {
  const set = new Set(calledNumbers);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      card[r][c].isMarked = set.has(card[r][c].value);
    }
  }
}

function countCompletedLines(card) {
  let lines = 0;
  // rows
  for (let r = 0; r < 5; r++) {
    if (card[r].every((cell) => cell.isMarked)) lines++;
  }
  // cols
  for (let c = 0; c < 5; c++) {
    let all = true;
    for (let r = 0; r < 5; r++) {
      if (!card[r][c].isMarked) { all = false; break; }
    }
    if (all) lines++;
  }
  // diagonals
  let d1 = true, d2 = true;
  for (let i = 0; i < 5; i++) {
    if (!card[i][i].isMarked) d1 = false;
    if (!card[i][4 - i].isMarked) d2 = false;
  }
  if (d1) lines++;
  if (d2) lines++;
  return lines;
}

/** ----------------- Game state ----------------- **/

// games: Map<gameId, Game>
const games = new Map();

// Game: {
//   id, state: 'waiting'|'playing'|'over',
//   players: [{ id, name, ws, card, lines }],
//   turn: playerId,
//   calledNumbers: number[]
// }

const generateGameId = () => {
  let id = Math.random().toString(36).substring(2, 7).toUpperCase();
  while (games.has(id)) id = Math.random().toString(36).substring(2, 7).toUpperCase();
  return id;
};

wss.on('connection', (ws) => {
  ws.id = Math.random().toString(36).substring(2, 9);
  ws.gameId = null;
  ws.playerName = '';
  console.log(`Client connected: ${ws.id}`);

  // Let client know its playerId
  safeSend(ws, { type: 'playerConnected', playerId: ws.id });

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('Bad JSON', e);
      return safeSend(ws, { type: 'error', message: 'Invalid JSON' });
    }

    const { type, gameId: incomingGameId, playerName, number } = data;
    if (playerName && typeof playerName === 'string') ws.playerName = playerName.trim();

    switch (type) {
      case 'createGame': {
        const gameId = generateGameId();
        const game = {
          id: gameId,
          players: [{ id: ws.id, name: ws.playerName || 'Player 1', ws, card: null, lines: 0 }],
          turn: null,
          calledNumbers: [],
          state: 'waiting',
        };
        games.set(gameId, game);
        ws.gameId = gameId;
        safeSend(ws, { type: 'gameCreated', gameId });
        console.log(`Game ${gameId} created by ${ws.id} (${ws.playerName})`);
        break;
      }

      case 'joinGame': {
        const gid = incomingGameId;
        const game = games.get(gid);
        if (!game) return safeSend(ws, { type: 'error', message: 'Game not found.' });
        if (game.players.length >= 2) return safeSend(ws, { type: 'error', message: 'Game is full.' });
        if (game.state !== 'waiting') return safeSend(ws, { type: 'error', message: 'Game has already started.' });

        game.players.push({ id: ws.id, name: ws.playerName || 'Player 2', ws, card: null, lines: 0 });
        ws.gameId = gid;

        // Generate cards for both players
        game.players[0].card = generateCard();
        game.players[1].card = generateCard();

        game.state = 'playing';
        // First turn to player[0]
        game.turn = game.players[0].id;

        // Send personalized gameStarted to both (with their own card)
        for (const p of game.players) {
          const opponent = game.players.find(x => x.id !== p.id);
          safeSend(p.ws, {
            type: 'gameStarted',
            gameId: game.id,
            firstPlayerId: game.turn,
            card: p.card, // each gets *their* card
            opponentName: opponent?.name || 'Opponent',
          });
        }
        console.log(`Game ${gid} started with ${game.players[0].id} and ${game.players[1].id}`);
        break;
      }

      case 'callNumber': {
        const gid = ws.gameId || incomingGameId;
        const game = games.get(gid);
        if (!game || game.state !== 'playing') {
          return safeSend(ws, { type: 'error', message: 'Invalid game state.' });
        }
        if (game.turn !== ws.id) {
          return safeSend(ws, { type: 'error', message: 'It is not your turn.' });
        }
        const n = Number(number);
        if (!Number.isInteger(n) || n < 1 || n > 25) {
          return safeSend(ws, { type: 'error', message: 'Invalid number.' });
        }
        if (game.calledNumbers.includes(n)) {
          return safeSend(ws, { type: 'error', message: 'Number has already been called.' });
        }

        // Update state
        game.calledNumbers.push(n);

        // Mark and count lines for each player
        for (const p of game.players) {
          markCard(p.card, game.calledNumbers);
          p.lines = countCompletedLines(p.card);
        }

        // Determine next turn
        const next = game.players.find(p => p.id !== ws.id);
        game.turn = next.id;

        // Check winner: first to reach 5 lines wins.
        const caller = game.players.find(p => p.id === ws.id);
        const opp = game.players.find(p => p.id !== ws.id);
        const callerReached = caller.lines >= 5;
        const oppReached = opp.lines >= 5;

        if (callerReached || oppReached) {
          // Winner: caller takes precedence if both reach 5 on this call
          const winner = callerReached ? caller : opp;
          game.state = 'over';
          for (const p of game.players) {
            safeSend(p.ws, {
              type: 'gameOver',
              message: `Player ${winner.name} wins!`,
              winnerId: winner.id,
              winnerName: winner.name,
              calledNumbers: game.calledNumbers,
            });
          }
          break;
        }

        // Broadcast personalized numberCalled (each gets myLines/opponentLines)
        for (const p of game.players) {
          const oppP = game.players.find(x => x.id !== p.id);
          safeSend(p.ws, {
            type: 'numberCalled',
            number: n,
            calledNumbers: game.calledNumbers,
            nextPlayerId: game.turn,
            myLines: p.lines,
            opponentLines: oppP ? oppP.lines : 0,
          });
        }
        break;
      }

      case 'bingo': {
        // Optional manual "bingo" claim; we’ll validate.
        const gid = ws.gameId || incomingGameId;
        const game = games.get(gid);
        if (!game || game.state !== 'playing') {
          return safeSend(ws, { type: 'error', message: 'Invalid game state.' });
        }
        // Recount to be safe
        for (const p of game.players) {
          markCard(p.card, game.calledNumbers);
          p.lines = countCompletedLines(p.card);
        }
        const claimant = game.players.find(p => p.id === ws.id);
        if (claimant && claimant.lines >= 5) {
          game.state = 'over';
          for (const p of game.players) {
            safeSend(p.ws, {
              type: 'gameOver',
              message: `Player ${claimant.name} wins!`,
              winnerId: claimant.id,
              winnerName: claimant.name,
              calledNumbers: game.calledNumbers,
            });
          }
        } else {
          safeSend(ws, { type: 'error', message: 'Not enough lines for Bingo.' });
        }
        break;
      }

      default:
        safeSend(ws, { type: 'error', message: 'Unknown message type.' });
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${ws.id}`);
    if (!ws.gameId) return;
    const game = games.get(ws.gameId);
    if (!game) return;

    // Remove player
    game.players = game.players.filter(p => p.id !== ws.id);

    if (game.players.length === 1) {
      // Notify the remaining player and end game
      const remaining = game.players[0];
      safeSend(remaining.ws, {
        type: 'playerDisconnected',
        message: 'Your opponent has disconnected. Game Over.',
      });
      games.delete(game.id);
      console.log(`Game ${game.id} ended due to disconnection`);
    } else if (game.players.length === 0) {
      games.delete(game.id);
    }
  });
});

function safeSend(ws, obj) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  } catch (e) {
    console.error('send error', e);
  }
}

// optional health route
app.get('/', (_, res) => res.send('Bingo server up'));
app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
