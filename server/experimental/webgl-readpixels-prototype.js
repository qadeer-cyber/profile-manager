// Opt-in page-world WebGL readPixels perturbation. Not vendor/renderer masking.
// Off unless experimental.webglReadback is "prototype". Native launch does not install it.
import crypto from 'node:crypto';

const SEED_RE = /^[0-9a-f]{64}$/;

export function webglReadPrototypeSeed(profileId) {
  const id = String(profileId || '');
  if (!id) throw new Error('webgl read prototype seed requires a profile id');
  return crypto.createHash('sha256').update(`pm-webgl-readpixels-v1:${id}`).digest('hex');
}

export function webglReadPixelsPrototypeInitScript(seed) {
  if (!SEED_RE.test(seed)) throw new Error('webgl read prototype seed must be 64 hex characters');
  return `(() => {
    if (window.__pmWebglReadPrototype) return;
    const seed = ${JSON.stringify(seed)};
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = parseInt(seed.slice(i * 2, i * 2 + 2), 16);
    function touch(pixels) {
      if (!pixels || !pixels.length) return;
      const n = Math.min(8, pixels.length);
      for (let i = 0; i < n; i++) pixels[i] = pixels[i] ^ (bytes[i] & 1);
    }
    const wrap = Proto => {
      if (!Proto || !Proto.readPixels) return;
      const orig = Proto.readPixels;
      Proto.readPixels = function(...args) {
        const out = orig.apply(this, args);
        const buf = args[6];
        if (buf instanceof Uint8Array) touch(buf);
        else if (buf instanceof ArrayBuffer) touch(new Uint8Array(buf));
        return out;
      };
    };
    wrap(WebGLRenderingContext?.prototype);
    wrap(WebGL2RenderingContext?.prototype);
    Object.defineProperty(window, '__pmWebglReadPrototype', {
      configurable: false,
      enumerable: true,
      value: Object.freeze({
        experimental: true,
        customEngine: false,
        captchaBypass: false,
        covers: Object.freeze(['WebGLRenderingContext.readPixels', 'WebGL2RenderingContext.readPixels']),
        misses: Object.freeze(['vendor/renderer strings', 'native Chromium launch', 'disabled WebGL contexts']),
      }),
    });
  })();`;
}
