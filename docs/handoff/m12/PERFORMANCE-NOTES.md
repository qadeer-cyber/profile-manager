# M12 performance observations

- Launch timings are recorded in-process (`launch-metrics.js`) as `coldStartMs`, `contextReadyMs`, `browserReadyMs`, `totalLaunchMs`. **Warm** means the same profile id already completed a successful launch in this app session.
- Per-browser RSS is read from `/proc/<pid>/status` on **Linux only**. Windows/macOS report host totals until a supported API is added without guessing.
- `maxConcurrentLaunches` queues startup work; `maxRunningProfiles` caps live browsers. Neither reserves RAM.
- Failed launches release locks and proxy relays; orphan `running` rows are reconciled on the health monitor.

Run `npm run test:m12` to print real cold/warm numbers in CI logs (`M12_BENCHMARK` line).
