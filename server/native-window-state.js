// OS window observations. Reading never raises, focuses or restores a minimized window.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const declarations = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class PmWindow {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct PLACEMENT { public int length, flags, showCmd; public POINT min,max; public RECT normal; }
 [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int size; public RECT monitor,work; public int flags; }
 [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref PLACEMENT p);
 [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
 [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFO p);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int height, uint f);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][PmWindow]::SetProcessDPIAware()
`;
function pidValue(pid) { if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Invalid window owner'); return pid; }
export function parseWmctrl(text, pid, stateText = '') {
  const line = String(text).split('\n').find(line => { const fields = line.trim().split(/\s+/); return Number(fields[2]) === pid; });
  if (!line) return null;
  const [handle, , , x, y, width, height] = line.trim().split(/\s+/);
  if (!/^0x[0-9a-f]+$/i.test(handle)) return null;
  return { handle, left: +x, top: +y, width: +width, height: +height, maximized: /_NET_WM_STATE_MAXIMIZED_VERT/.test(stateText) && /_NET_WM_STATE_MAXIMIZED_HORZ/.test(stateText), source: 'x11-window-manager' };
}
export async function observeNativeWindow(pid) {
  pidValue(pid);
  if (process.platform === 'win32') {
    const script = declarations + `
$p=Get-Process -Id ${pid} -ErrorAction Stop; $h=$p.MainWindowHandle
if($h -eq [IntPtr]::Zero){exit 0}
$w=New-Object PmWindow+PLACEMENT; $w.length=[Runtime.InteropServices.Marshal]::SizeOf($w)
if(-not [PmWindow]::GetWindowPlacement($h,[ref]$w)){exit 1}
# WINDOWPLACEMENT uses workspace coordinates except for tool windows. Store
# screen coordinates, as used by SetWindowPos and monitor working areas.
$dx=0;$dy=0
if(([PmWindow]::GetWindowLong($h,-20) -band 128) -eq 0){
 $m=New-Object PmWindow+MONITORINFO; $m.size=[Runtime.InteropServices.Marshal]::SizeOf($m)
 if(-not [PmWindow]::GetMonitorInfo([PmWindow]::MonitorFromWindow($h,2),[ref]$m)){exit 1}
 $dx=$m.work.Left-$m.monitor.Left;$dy=$m.work.Top-$m.monitor.Top
}
@{left=($w.normal.Left+$dx);top=($w.normal.Top+$dy);width=($w.normal.Right-$w.normal.Left);height=($w.normal.Bottom-$w.normal.Top);maximized=($w.showCmd -eq 3 -or ($w.showCmd -eq 2 -and ($w.flags -band 2) -ne 0));source='win32-placement'}|ConvertTo-Json -Compress`;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, windowsHide: true, maxBuffer: 65536 });
    return stdout.trim() ? JSON.parse(stdout.trim()) : null;
  }
  if (process.platform === 'linux' && process.env.DISPLAY) {
    const { stdout } = await exec('wmctrl', ['-lpG'], { timeout: 1500, maxBuffer: 65536 });
    const rect = parseWmctrl(stdout, pid); if (!rect) return null;
    const state = await exec('xprop', ['-id', rect.handle, '_NET_WM_STATE'], { timeout: 1500, maxBuffer: 16384 });
    return parseWmctrl(stdout, pid, state.stdout);
  }
  return null;
}
export async function restoreNativeWindow(pid, state) {
  pidValue(pid);
  if (!state || ![state.left, state.top, state.width, state.height].every(Number.isInteger)) throw Error('Invalid window bounds');
  if (process.platform === 'win32') {
    const script = declarations + `$p=Get-Process -Id ${pid} -ErrorAction Stop; $h=$p.MainWindowHandle; if($h -eq [IntPtr]::Zero){exit 1}\n[void][PmWindow]::ShowWindow($h,9); if(-not [PmWindow]::SetWindowPos($h,[IntPtr]::Zero,${state.left},${state.top},${state.width},${state.height},20)){exit 1}\n` + (state.maximized ? '[void][PmWindow]::ShowWindow($h,3)' : '');
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 5000, windowsHide: true }); return true;
  }
  if (process.platform === 'linux' && process.env.DISPLAY) {
    const observed = await observeNativeWindow(pid); if (!observed) return false;
    await exec('wmctrl', ['-ir', observed.handle, '-b', 'remove,maximized_vert,maximized_horz'], { timeout: 1500 });
    await exec('wmctrl', ['-ir', observed.handle, '-e', `0,${state.left},${state.top},${state.width},${state.height}`], { timeout: 1500 });
    if (state.maximized) await exec('wmctrl', ['-ir', observed.handle, '-b', 'add,maximized_vert,maximized_horz'], { timeout: 1500 });
    return true;
  }
  return false;
}
