// Shared loopback check for the Playwright examples.
// CDP is accepted only for 127.0.0.1 or localhost. A remote debugger address is refused.
export function assertLoopbackEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); }
  catch { throw new Error('CDP endpoint is not a URL'); }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:' && url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('CDP endpoint must be an http or ws URL');
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Refusing a CDP endpoint that is not on loopback');
  }
  return url;
}
