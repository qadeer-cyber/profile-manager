// Opt-in page-world canvas readback perturbation.
// This is not a Chromium source change, not a fingerprint mask, and not a
// CAPTCHA bypass. It is off unless a profile sets experimental.canvasReadback
// to "prototype". Native launches do not install it. Workers, OffscreenCanvas,
// and WebGL readPixels are outside its reach. The page can see the marker.
import crypto from 'node:crypto';

const SEED_RE = /^[0-9a-f]{64}$/;

export function canvasPrototypeSeed(profileId) {
  const id = String(profileId || '');
  if (!id) throw new Error('canvas prototype seed requires a profile id');
  return crypto.createHash('sha256').update(`pm-canvas-prototype-v1:${id}`).digest('hex');
}

/** Deterministic low-bit flip of eight RGB samples. Alpha is left alone. */
export function perturbRgba(bytes, seed) {
  if (!SEED_RE.test(seed)) throw new Error('canvas prototype seed must be 64 hex characters');
  const out = Buffer.from(bytes);
  const seedBytes = Buffer.from(seed.slice(0, 32), 'hex');
  const pixelCount = Math.floor(out.length / 4);
  if (!pixelCount) return out;
  for (let i = 0; i < 8; i++) {
    const pixel = seedBytes[i] % pixelCount;
    const channel = seedBytes[(i + 8) % 16] % 3;
    const index = pixel * 4 + channel;
    out[index] ^= 1;
  }
  return out;
}

export function canvasPrototypeInitScript(seed) {
  if (!SEED_RE.test(seed)) throw new Error('canvas prototype seed must be 64 hex characters');
  return `(() => {
    if (window.__pmCanvasPrototype) return;
    const seed = ${JSON.stringify(seed)};
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = parseInt(seed.slice(i * 2, i * 2 + 2), 16);
    function perturb(data) {
      const pixelCount = Math.floor(data.length / 4);
      if (!pixelCount) return data;
      for (let i = 0; i < 8; i++) {
        const pixel = bytes[i] % pixelCount;
        const channel = bytes[(i + 8) % 16] % 3;
        data[pixel * 4 + channel] = data[pixel * 4 + channel] ^ 1;
      }
      return data;
    }
    const origGet = CanvasRenderingContext2D.prototype.getImageData;
    const origURL = HTMLCanvasElement.prototype.toDataURL;
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
      const image = origGet.apply(this, args);
      perturb(image.data);
      return image;
    };
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      const ctx = this.getContext('2d');
      if (!ctx || !this.width || !this.height) return origURL.apply(this, args);
      const image = origGet.call(ctx, 0, 0, this.width, this.height);
      perturb(image.data);
      const copy = document.createElement('canvas');
      copy.width = this.width;
      copy.height = this.height;
      copy.getContext('2d').putImageData(image, 0, 0);
      return origURL.apply(copy, args);
    };
    Object.defineProperty(window, '__pmCanvasPrototype', {
      configurable: false,
      enumerable: true,
      value: Object.freeze({
        experimental: true,
        customEngine: false,
        captchaBypass: false,
        covers: Object.freeze(['CanvasRenderingContext2D.getImageData', 'HTMLCanvasElement.toDataURL']),
        misses: Object.freeze(['OffscreenCanvas', 'worker canvases', 'WebGL readPixels', 'native Chromium launch']),
      }),
    });
  })();`;
}
