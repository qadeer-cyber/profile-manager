# DiagnosticsV1 — Addendum A1 (owner-approved §7.9 exception)

**Addendum version:** `DiagnosticsV1-A1` (v1)
**Amends:** `DiagnosticsV1.original.md` §7 item 9 ("Never automatically close the diagnostic tab.") — narrow exception only
**Base contract SHA-256 (unchanged):** `cd1ce49f379566efa0fa65ed81f5402f21259191cbdb6aa6088eb8413b8059d8` (`DiagnosticsV1.original.md`)
**Process-command-line amendment SHA-256 (unchanged):** `e80ce2d513e610a18c703b775fb0fd5520e3eb1ca5dce6f4ad43a1eecf08bdf4`
**Approved by:** Mohammad Abbas (owner), decision t47u, 2026-10-28 (Asia/Karachi), B1 option (ii)

## Approved exception (verbatim)

"An application-owned diagnostic tab remains open after normal diagnostic collection. If native regional-locale initialization fails, the application must close only that failed diagnostic tab to prevent execution under incorrect locale settings."

## Scope (binding)

1. Applies only to the page target whose identity is the `targetId` returned by the application's own `Target.createTarget` call for an M2 diagnostic request. URL matching is never sufficient.
2. The failed target is never resumed; it is closed by that `targetId`. If closure cannot be confirmed, M3 fail-closed behaviour for the whole profile applies.
3. The response is a normal DiagnosticsV1 body with environment facts `unavailable` / `collection_failed` (or `timeout` if the 3-second deadline expired first).
4. Profile, other tabs, sessions, storage, locks, running row, launchId, PID, lifecycle classification and `last_error` are not modified.
5. Successful diagnostic tabs remain open (§7.9 otherwise unchanged). Ordinary user tabs keep M3 fail-closed behaviour. No other contract text changes.

## UI disclosure

The §7 disclosure string is unchanged. The UI shows this additional note beneath it:

"If the profile's language settings cannot be applied to the diagnostic tab, the app closes only that tab. Your other tabs are not affected."
