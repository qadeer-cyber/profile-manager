// Local proxy for the installed Test Proxy client and a launched browser.
// 203.0.113.50 is the documentation address this fixture writes. It is not an observed public IP.
import http from 'node:http';

export const FIXTURE_ADDRESS = '203.0.113.50';

function authorized(header, identity) {
  if (!identity) return false;
  const token = String(header || '').split(' ')[1] || '';
  return Buffer.from(token, 'base64').toString('utf8') === `${identity.username}:${identity.password}`;
}

function httpResponse(requestPath) {
  if (requestPath.includes('/ip')) return {type: 'application/json', body: JSON.stringify({ip: FIXTURE_ADDRESS, fixture: true, observedPublicEgress: false})};
  if (requestPath.includes('/azwah-route')) return {type: 'text/plain', body: `routed ${requestPath}`};
  return null;
}

function writeResponse(socket, requestPath) {
  const response = httpResponse(requestPath);
  if (!response) {
    socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    return false;
  }
  socket.end(`HTTP/1.1 200 OK\r\nContent-Type: ${response.type}\r\nContent-Length: ${Buffer.byteLength(response.body)}\r\nConnection: close\r\n\r\n${response.body}`);
  return true;
}

export function createRecordingProxy(events, identity) {
  const proxy = http.createServer((req, res) => {
    const requestPath = String(req.url || '');
    const ok = authorized(req.headers['proxy-authorization'], identity);
    const response = ok ? httpResponse(requestPath) : null;
    events.push({kind: 'request', destination: requestPath, path: requestPath, authenticated: ok, responded: !!response});
    if (!ok) {
      res.writeHead(407, {'proxy-authenticate': 'Basic realm="azwah"', 'content-length': '0'});
      res.end();
      return;
    }
    if (!response) {
      res.writeHead(404, {'content-length': '0'});
      res.end();
      return;
    }
    res.writeHead(200, {'content-type': response.type, 'content-length': Buffer.byteLength(response.body)});
    res.end(response.body);
  });
  proxy.on('connect', (req, socket, head) => {
    const destination = String(req.url || '');
    const ok = authorized(req.headers['proxy-authorization'], identity);
    if (!ok) {
      events.push({kind: 'connect', destination, path: '', authenticated: false, responded: false});
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="azwah"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    events.push({kind: 'connect', destination, path: '', authenticated: true, responded: false});
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const chunks = [head?.length ? head : Buffer.alloc(0)];
    const finish = () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const requestPath = text.split(' ')[1] || '';
      const responded = writeResponse(socket, requestPath);
      events.push({kind: 'request', destination, path: requestPath, authenticated: true, responded});
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

export function proxyEvidence(events) {
  const connect = events.filter(item => item.kind === 'connect' && item.authenticated);
  const request = events.filter(item => item.kind === 'request' && item.authenticated && item.responded);
  return {
    fixtureAddress: FIXTURE_ADDRESS,
    observedPublicEgress: false,
    authenticatedConnectCount: connect.length,
    authenticatedRequestCount: request.length,
    connectDestinations: connect.map(item => item.destination),
    requestPaths: request.map(item => item.path),
  };
}
