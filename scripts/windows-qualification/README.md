# Windows M8 local qualification

Use this when **Dedicated browser engine (Windows)** or other `windows-2022` workflows fail in **0–5 seconds** with:

> The job was not started because recent account payments have failed or your spending limit needs to be increased.

That is a **GitHub billing/runner allocation** failure, not an application test failure. Do not treat a cancelled pre-job as M8 evidence.

## Prerequisites

- Windows 10 or 11 x64
- Node.js 22.x
- Git checkout of branch `qa/ultimate2-m8-windows-qualification` (or your qualification tip)
- Stock Mozilla Firefox (Chocolatey `firefox` package matches CI)

## Run

```powershell
cd C:\path\to\profile-manager
git checkout qa/ultimate2-m8-windows-qualification
git pull
.\scripts\windows-qualification\Run-M8-Qualification.ps1
```

Evidence (transcript, git SHA, PASS/FAIL stamp) is written under `%TEMP%\pm-m8-windows-qualification` by default. Pass `-EvidenceRoot` to override.

## Optional broader regression (same as integration checkpoint)

```powershell
npm run test:unit
npm run test:stabilization
npm run test:data-recovery
npm run test:browser-runtime
npm run test:integration:preflight
```

## What qualifies M8

- `npm run test:m8:acceptance` — real Chromium UI export + encrypted restore, real Firefox export-stream restore, cookie/localStorage readback across stop/restart.
- M8 remains **PARTIAL** in the historical scorecard until **Windows** real-browser acceptance is recorded on an authorized host. Linux-only PASS does not promote the matrix row to VERIFIED.
