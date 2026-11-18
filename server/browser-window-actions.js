// Focus or locate a running browser window (CDP when automation is on; Win32 foreground otherwise).
import { execFile } from 'child_process';
import { promisify } from 'util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

const winFocusScript = pid => `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PmWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$p = Get-Process -Id ${pid} -ErrorAction Stop
if ($p.MainWindowHandle -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"reason":"no_main_window"}'; exit 0 }
$h = $p.MainWindowHandle
[void][PmWin32]::ShowWindow($h, 9)
[void][PmWin32]::SetForegroundWindow($h)
$rect = New-Object PmWin32+RECT
[void][PmWin32]::GetWindowRect($h, [ref]$rect)
@{ ok = $true; title = $p.MainWindowTitle; rect = @{ left = $rect.Left; top = $rect.Top; width = ($rect.Right - $rect.Left); height = ($rect.Bottom - $rect.Top) } } | ConvertTo-Json -Compress
`.trim();

export async function focusBrowserWindowByPid(pid) {
  if (!pid || pid <= 0) throw fail(409, 'No browser PID is recorded for this session.', 'NO_PID');
  if (process.platform !== 'win32') {
    return { ok: false, method: 'unsupported_platform', reason: 'Window focus requires Windows for native sessions without CDP.' };
  }
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', winFocusScript(pid)], { timeout: 15000, windowsHide: true });
  const line = String(stdout || '').trim().split('\n').pop();
  let parsed;
  try { parsed = JSON.parse(line); } catch { parsed = { ok: false, reason: 'parse_failed', raw: line }; }
  if (!parsed.ok) return { ok: false, method: 'win32_main_window', ...parsed };
  return { ok: true, method: 'win32_main_window', title: parsed.title || null, rect: parsed.rect || null };
}

export async function focusViaCdp(cdpPort) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  try {
    let pages = 0;
    for (const ctx of browser.contexts()) {
      for (const page of ctx.pages()) {
        await page.bringToFront();
        pages++;
      }
    }
    return { ok: pages > 0, method: 'cdp_bring_to_front', pagesFocused: pages };
  } finally {
    await browser.close();
  }
}

export async function focusRunningBrowserSession({ pid, cdpPort }) {
  if (cdpPort) {
    try {
      const cdp = await focusViaCdp(cdpPort);
      if (cdp.ok) return cdp;
    } catch (e) {
      if (!pid) throw e;
    }
  }
  return focusBrowserWindowByPid(pid);
}

export async function locateRunningBrowserSession({ pid, cdpPort }) {
  if (process.platform !== 'win32') {
    return { pid: pid ?? null, cdpPort: cdpPort ?? null, availability: 'unavailable', reason: 'locate_requires_windows' };
  }
  if (!pid) return { availability: 'unavailable', reason: 'no_pid' };
  const focus = await focusBrowserWindowByPid(pid).catch(e => ({ ok: false, reason: e.message }));
  return {
    availability: focus.ok ? 'available' : 'unavailable',
    pid,
    cdpPort: cdpPort ?? null,
    title: focus.title ?? null,
    rect: focus.rect ?? null,
    reason: focus.ok ? null : (focus.reason || 'no_main_window'),
  };
}
