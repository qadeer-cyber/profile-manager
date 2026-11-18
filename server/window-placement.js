// Window placement safety for explicit positions. This does not mask screen.width,
// screen.height, or multi-monitor identity. When host displays are known and the
// window would sit entirely off them, launch uses the primary origin instead.
import { execFileSync } from 'node:child_process';

const MIN_VISIBLE = 32;

function finiteBox(display) {
  if (!display || typeof display !== 'object') return null;
  const x = Number(display.x) || 0;
  const y = Number(display.y) || 0;
  const width = Number(display.width);
  const height = Number(display.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { x, y, width, height, right: x + width, bottom: y + height };
}

export function assessWindowPlacement(screen = {}, displays = null) {
  const windowX = screen.windowX ?? null;
  const windowY = screen.windowY ?? null;
  if (windowX == null || windowY == null) {
    return {
      status: 'not-positioned',
      clamped: false,
      windowX,
      windowY,
      reason: 'No explicit window position is set. The screen API is not masked.',
    };
  }
  const width = screen.width ?? screen.viewportWidth ?? null;
  const height = screen.height ?? screen.viewportHeight ?? null;
  if (!Array.isArray(displays) || displays.length === 0) {
    return {
      status: 'unverified',
      clamped: false,
      windowX,
      windowY,
      reason: 'Host displays were not available. The saved position is unchanged. This is not a multi-monitor identity mask.',
    };
  }
  const boxes = displays.map(finiteBox).filter(Boolean);
  if (!boxes.length) {
    return {
      status: 'unverified',
      clamped: false,
      windowX,
      windowY,
      reason: 'Host display records had no usable bounds. The saved position is unchanged.',
    };
  }
  const overlaps = boxes.some(box => {
    const overlapW = Math.min(windowX + (width || MIN_VISIBLE), box.right) - Math.max(windowX, box.x);
    const overlapH = Math.min(windowY + (height || MIN_VISIBLE), box.bottom) - Math.max(windowY, box.y);
    return overlapW >= MIN_VISIBLE && overlapH >= MIN_VISIBLE;
  });
  if (overlaps) {
    return {
      status: 'on-display',
      clamped: false,
      windowX,
      windowY,
      reason: 'The window overlaps a known display by at least 32 pixels. screen.width and screen.height are not replaced.',
    };
  }
  const primary = boxes[0];
  return {
    status: 'clamped-primary',
    clamped: true,
    windowX: primary.x,
    windowY: primary.y,
    reason: 'The window was fully outside known displays, so launch uses the primary origin. Configured screen size is unchanged and is not a monitor mask.',
  };
}

/** Parse `xrandr --query` connected outputs. Returns [] when the text has none. */
export function parseXrandr(text) {
  const displays = [];
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^(\S+)\s+connected(?:\s+primary)?\s+(\d+)x(\d+)([+-]\d+)([+-]\d+)/);
    if (!match) continue;
    displays.push({
      name: match[1],
      width: Number(match[2]),
      height: Number(match[3]),
      x: Number(match[4]),
      y: Number(match[5]),
    });
  }
  return displays;
}

/** Best-effort host displays. Null when there is no X display or xrandr fails. */
export function readHostDisplays() {
  if (process.platform === 'win32') {
    try {
      const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; @([System.Windows.Forms.Screen]::AllScreens | Sort-Object -Property @{Expression={-not $_.Primary}} | ForEach-Object { @{x=$_.WorkingArea.X;y=$_.WorkingArea.Y;width=$_.WorkingArea.Width;height=$_.WorkingArea.Height} }) | ConvertTo-Json -Compress'], { timeout: 3000, windowsHide: true, encoding: 'utf8', maxBuffer: 65536 });
      const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : [parsed];
    } catch { return null; }
  }
  if (process.platform !== 'linux'  || !process.env.DISPLAY) return null;
  try {
    const text = execFileSync('xrandr', ['--query'], {
      timeout: 1500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const displays = parseXrandr(text);
    return displays.length ? displays : null;
  } catch {
    return null;
  }
}
