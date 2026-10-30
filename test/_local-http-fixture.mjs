import http from 'node:http';

/** Deterministic local page for CookieRobot / CDP tests (no external network). */
export function startLocalHttpFixture({ body = '<!doctype html><html><head><title>pm-fixture</title></head><body>ok</body></html>' } = {}) {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const port = server.address().port;
      resolve({
        origin: `http://127.0.0.1:${port}/`,
        port,
        close: () => new Promise(r => {
          server.close(() => r());
          server.closeAllConnections();
        }),
      });
    });
  });
}
