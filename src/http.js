const http = require('http');

function startHealthServer(client, port) {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    if (url === '/health' || url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          bot: client.user ? client.user.tag : 'starting',
          ready: client.isReady(),
          uptimeSeconds: Math.floor(process.uptime()),
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on 0.0.0.0:${port}`);
  });

  return server;
}

module.exports = { startHealthServer };
