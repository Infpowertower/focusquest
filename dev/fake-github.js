// Stand-in for the GitHub release API and its downloads, for the helper tests on Windows. Not shipped.
//   node fake-github.js <folder> <port>
// GET /latest answers with <folder>/<scenario>/latest.json; <folder>/current.txt names the scenario.
// A scenario folder may hold status.txt (answer with that status) or drop.txt (cut the connection).
// Every other path is served as a file below <folder>.
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2]), port = +process.argv[3];
http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (p === '/latest') {
    const sc = path.join(dir, fs.readFileSync(path.join(dir, 'current.txt'), 'utf8').trim());
    if (fs.existsSync(path.join(sc, 'drop.txt'))) return req.socket.destroy();
    if (fs.existsSync(path.join(sc, 'status.txt'))) {
      res.writeHead(+fs.readFileSync(path.join(sc, 'status.txt'), 'utf8').trim(), { 'Content-Type': 'application/json' });
      return res.end('{"message":"API rate limit exceeded"}');
    }
    file = path.join(sc, 'latest.json');
  } else file = path.join(dir, p);
  if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('{}'); }
  res.writeHead(200, { 'Content-Type': file.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(port, () => console.log('fake github on ' + port));
