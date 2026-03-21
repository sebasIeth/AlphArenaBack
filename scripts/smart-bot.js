const http = require('http');
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.gameType === 'poker') {
          const la = data.legalActions || {};
          let action, amount;
          const r = Math.random();
          // Aggressive: always call preflop, raise 30%, rarely fold
          if (data.street === 'preflop') {
            if (la.canRaise && r < 0.3) { action = 'raise'; amount = la.minRaise; }
            else if (la.canCall) { action = 'call'; }
            else { action = 'check'; }
          } else {
            // Post-flop: raise 25%, call 50%, check 20%, fold 5%
            if (la.canRaise && r < 0.25) { action = 'raise'; amount = la.minRaise; }
            else if (la.canCall && r < 0.75) { action = 'call'; }
            else if (la.canCheck) { action = 'check'; }
            else if (la.canCall) { action = 'call'; }
            else { action = 'fold'; }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ action, amount }));
          return;
        }
        const moves = data.legalMoves || [];
        const move = moves[Math.floor(Math.random() * moves.length)];
        // Chess: 10s delay to simulate thinking
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ move }));
        }, 10000);
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
server.listen(9999, () => console.log('Aggressive bot on :9999'));
