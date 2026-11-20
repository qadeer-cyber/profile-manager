# AZWAH 2.0 private release candidate: evidence and open items

Source: `e0d4c3d3691cc0c729625a7419b5238491632546` on `feature/azwah-ultimate-2` (PR #27, Draft). Later commits change only documentation and the experimental Chromium-chain workflow, not the app.

All results below are from GitHub-hosted **Windows Server 2022** runners (4 logical cores, 16 GB RAM, Chrome Stable 157.0.8103.79). None of them is a physical Windows 10/11 or 8 GB laptop result.

## Verdict by component

| Component | Verdict |
| --- | --- |
| Chrome Stable edition installer (`Azwah-Setup-x64.exe`) | **Ready for owner private acceptance.** No known P0/P1 defect. Physical-client checks below are NOT EXECUTED. Unsigned. |
| Native Chromium engine (chain run 44706934362) | **Not built.** Stage 1 compiling at the time of writing; no `chrome.exe` exists. Not part of this installer. |
| Canvas privacy protection | **Not started** (design only: `docs/privacy-threat-model.md`). |

## CI on the exact source

| Workflow | Run | Result |
| --- | --- | --- |
| Windows native build and validation | [44713286090](https://github.com/qadeer-cyber/profile-manager/actions/runs/44713286090) | Pass. Unit 247/247; live Chrome Stable 3/3; productivity 66 pass, 1 skipped (Windows symlink privilege, as before); API, engine, proxy, security and UI stages pass |
| AZWAH Windows installer acceptance | [44713279153](https://github.com/qadeer-cyber/profile-manager/actions/runs/44713279153) | Pass. Unit 247/247; installer and upgrade 70/70; live 3/3; DB-IP proxy 1/1 |

## Installer

| | |
| --- | --- |
| Artifact | `azwah-windows-x64-e0d4c3d3691cc0c729625a7419b5238491632546`, ID 14618809394, expires 2026-11-23 10:05 UTC |
| Setup file inside | `Azwah-Setup-x64.exe`, 471,335,827 bytes |
| Setup SHA-256 (read back from the uploaded artifact in CI) | `6c3394d250e1941f830dcb2df0e344d1d09f0f54ec7e120c80cb2009c7979e69` |
| Version metadata | `2.0.0-beta.1` |
| Signing | **Unsigned.** Expect a SmartScreen warning. |
| Browser | Not included. AZWAH opens profiles in the installed Google Chrome Stable; without it, the app says so and links to Google's download page. |

## Defect register (owner evidence of 2026-11-20)

| Report | Finding | Status |
| --- | --- | --- |
| Lifecycle export: requested Stop with `exitEventSeen=false`, `exitType=Crashed` | Reproduced: Stop recorded before Node delivered the exit event. Builds before `4f16d32` also force-killed manual Chrome on Stop, which leaves `Crashed`. Which build the owner ran is not known. | Fixed (`e9f980f`). 30 live Stop/restart cycles: every exit `RequestedStop`, graceful, exit event seen, exit code 0, marker `Normal` or absent on a new profile's first run, never `Crashed`; cookie and localStorage written just before each Stop survived. |
| BrowserScan "Robot", WebDriver red, on a proxy profile | Controlled proxy launches keep the automation connection (`navigator.webdriver` true). | Per-profile *Proxy launch: Manual* gives `false` (live: `manualProxy: "false"`). Controlled stays the owner-chosen default. |
| Walmart "Robot or human?" on a proxy profile | Not reproducible in CI; depends on IP reputation, history and the site's own systems. | Not a browser defect that can be certified. Proxy tests now name the exit network and flag hosting/cloud networks (CI's own exit: AS8075 Microsoft, flagged hosting). Owner comparison protocol: `docs/windows-client-qualification.md` section G. |
| Chrome bar "unsupported command-line flag: --host-resolver-rules=…" | Chrome's warning list includes this switch. Live probe: with the exact flag a real hostname does not resolve inside Chrome (`blocked`); without it, it resolves. | Kept: it is AZWAH's DNS-leak guard and Chrome applies it. The bar is visible to the user only. |
| No-proxy profile: BrowserScan Normal | Expected: manual launch, `navigator.webdriver` false (live: `manual: "false"`). | No change. |

## Launch modes (live, Chrome 157)

| Profile | Mode | `navigator.webdriver` | Language | Timezone |
| --- | --- | --- | --- | --- |
| No proxy | Manual | false | PC | PC |
| Proxy, Manual | Manual | false | Proxy country when the lookup succeeds (CI: `en-US`) | PC |
| Proxy, Controlled (default) | Controlled | true | Proxy country | Proxy (verified in browser) |
| Automation enabled | Controlled | true | As configured | As configured |

## Resources (Windows Server 2022 CI, not a laptop)

Chrome working set: 1 profile 505 MiB, 2 profiles 1,090 MiB, 4 profiles 2,182 MiB; AZWAH desktop 356–419 MiB. Launch 1.2–1.8 s; Stop 0.16–0.19 s; desktop reopen 0.7 s. An 8 GB laptop with 1.5 GB free will hold fewer simultaneous profiles; that is a physical check.

## NOT EXECUTED (owner physical checks)

Windows 10 and 11 clients; 8 GB laptop behavior; 100/125/150% scaling on a real display; SmartScreen and Defender on the unsigned installer; real camera, microphone and GPU; real authenticated regional proxies; Walmart, Google, Facebook and BrowserScan outcomes with the same-IP ordinary-Chrome control (`docs/windows-client-qualification.md`, sections A–G); a real published update (needs approval).

## Not done

No merge to `main`, no public release, no code signing.
