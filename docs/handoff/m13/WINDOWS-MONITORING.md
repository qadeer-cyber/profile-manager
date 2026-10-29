# M13 Windows process monitoring

- One **Get-CimInstance Win32_Process** query per cache window (~4s), filtered to `chrome|chromium` process names.
- Profiles are matched by **`--user-data-dir`** in the command line (case-normalized on Windows).
- Roles: `browser`, `gpu`, `renderer`, `utility`, `child` from `--type=` flags.
- Totals use each PID once across profiles (`aggregateBrowserMemory`).
- Linux continues to use `/proc` cmdline + VmRSS with the same assignment rules.

Advanced metrics live under **Monitoring** in the UI; the main Dashboard keeps compact running/memory hints only.
