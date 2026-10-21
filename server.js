const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'public');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'};
const port = Number(process.env.PORT || 4173);
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'app.js', 'model.js', 'style.css'].includes(file)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  fs.readFile(path.join(root, file), (error, data) => {
    if (error) { res.writeHead(500); res.end('Could not read file'); return; }
    res.writeHead(200, {'content-type': types[path.extname(file)], 'cache-control': 'no-store'});
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`gpt-commenter: http://127.0.0.1:${port}`));
