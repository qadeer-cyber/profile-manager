// Local HTTP proxy that answers the CONNECT request used by https-proxy-agent.
import http from 'node:http';

function writeHttp(socket, requestPath) {
  const body = requestPath.includes('/ip') ? '{"ip":"203.0.113.50"}' : 'routed';
  const type = requestPath.includes('/ip') ? 'application/json' : 'text/plain';
  socket.end(`HTTP/1.1 200 OK\r\nContent-Type: ${type}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

export function createRecordingProxy(hits) {
  const proxy = http.createServer((req, res) => {
    const url = String(req.url || '');
    hits.push(url);
    if (url.includes('/ip')) {
      res.writeHead(200, {'content-type': 'application/json'});
      res.end('{"ip":"203.0.113.50"}');
      return;
    }
    res.writeHead(200, {'content-type': 'text/plain'});
    res.end('routed');
  });
  proxy.on('connect', (req, socket, head) => {
    hits.push(String(req.url || ''));
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const chunks = [head?.length ? head : Buffer.alloc(0)];
    const finish = () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const requestPath = text.split(' ')[1] || '';
      hits.push(requestPath);
      writeHttp(socket, requestPath);
    };
    if (Buffer.concat(chunks).includes('\r\n\r\n')) finish();
    else socket.on('data', buf => {
      chunks.push(buf);
      if (Buffer.concat(chunks).includes('\r\n\r\n')) {
        socket.removeAllListeners('data');
        finish();
      }
    });
  });
  return proxy;
}
