# Performance and resource acceptance

What AZWAH measures, where each number comes from, and what still has to be measured on the owner's PC. CI numbers are Windows Server runner numbers, never laptop numbers.

## Measured on CI (Windows Server 2022, 4 logical cores, 16 GB, Chrome Stable 157)

Source: `FRESH_INSTALL_EVIDENCE` in installer acceptance run [44713279153](https://github.com/qadeer-cyber/profile-manager/actions/runs/44713279153) (commit `e0d4c3d`).

| Measure | Value |
| --- | --- |
| Chrome working set, 1 / 2 / 4 profiles | 505 / 1,090 / 2,182 MiB |
| AZWAH desktop working set | 356–419 MiB |
| Launch (cold / warm) | 1.5 s / 1.2 s |
| Stop | 0.16–0.19 s |
| Desktop open / reopen | 1.7 s / 0.7 s |
| Stop/restart persistence | 30 cycles, all graceful, exit code 0, last cookie and localStorage write kept (native validation, Chrome 157) |

## Guards in the app

- **Free-memory guard** (`server/launch-limits.js`): refuses a launch below `minFreeMemoryGiB` (default 1, Settings 0–4) with a message naming the setting. It refuses only the new launch; it never stops running profiles or other processes.
- **Running-profile limit** (`maxRunningProfiles`, default 4).
- **Stop**: graceful close first, force only after 8 s, labelled `ForcedTermination` when used; ownership checked by profile directory before any kill (`test/native-launcher-lifecycle.test.js`).

## To measure on the owner's PC (Dell Latitude 5480: i5-7300U, 2 cores / 4 threads, Intel HD 620, 8 GB) — NOT EXECUTED

Record Windows version and build, Chrome version, and free memory before starting (Task Manager → Performance → Memory → Available).

| # | Measure | How |
| --- | --- | --- |
| 1 | Idle | AZWAH open, no profiles: Task Manager "AZWAH" memory |
| 2 | One profile | Launch one Manual profile, open one ordinary site, wait 30 s: total Chrome memory, CPU |
| 3 | Two profiles | Second profile, same: memory, CPU; is the UI still responsive? |
| 4 | Four profiles | Up to the default limit: note when the memory guard refuses and the available memory at that moment |
| 5 | Launch time | Click to window visible, 3 times, cold and warm |
| 6 | Stop | Click Stop to row showing Stopped, 3 times |
| 7 | Leftovers | After stopping all: no `chrome.exe` left for AZWAH profile folders (Task Manager → Details, command line column) |
| 8 | Disk | Size of the AZWAH data folder after a day of use |

Report the numbers as measured on that PC. Do not compare them with the CI table as if they were the same machine.

## Native engine (experimental)

No native browser exists yet. When one does, the same table is filled for it separately, from the fresh-runner smoke job first and the owner's PC second.
