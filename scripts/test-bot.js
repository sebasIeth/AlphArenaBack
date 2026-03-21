// Simple game bot that handles chess + poker
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        // Poker handler
        if (data.gameType === 'poker') {
          const la = data.legalActions || {};
          let action, amount;
          const r = Math.random();

          // Aggressive strategy: raise 40%, call 30%, check 20%, fold 10%
          if (la.canRaise && r < 0.4) {
            action = 'raise';
            // Random raise between min and 2x min
            amount = Math.min(la.minRaise + Math.floor(Math.random() * la.minRaise), la.maxRaise);
          } else if (la.canCall && r < 0.7) {
            action = 'call';
          } else if (la.canCheck) {
            action = 'check';
          } else if (la.canCall) {
            action = 'call';
          } else if (la.canAllIn && r < 0.15) {
            action = 'all_in';
          } else if (la.canFold) {
            action = 'fold';
          } else if (la.canCall) {
            action = 'call';
          } else {
            action = 'check';
          }

          console.log(`[${req.url}] POKER hand=#${data.handNumber} street=${data.street} → ${action}${amount ? ' ' + amount : ''}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ action, amount }));
          return;
        }

        // Chess handler
        const legalMoves = data.legalMoves || [];
        if (legalMoves.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ move: null }));
          return;
        }

        const move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
        console.log(`[${req.url}] CHESS color=${data.yourColor} move=#${data.moveNumber} → ${move}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ move }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  }
});

server.listen(9999, () => console.log('Game bot listening on http://localhost:9999'));
