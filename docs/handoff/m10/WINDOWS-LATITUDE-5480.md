# Windows check for the Latitude 5480

This file is the note for a later manual run. It is not a result from that laptop. The automated fingerprint test ran on Linux against Chromium 156.0.8078.4 (Playwright revision 1248). Its WebGL renderer was SwiftShader:

`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`

Do not copy that string onto the Latitude 5480. That machine’s integrated GPU is Intel HD Graphics 620. A default WebGL profile there should show an Intel renderer if the Windows driver is in use. SwiftShader or an empty renderer means the Windows launch did not use that GPU path. Either result is an observation, not a value this app should save as a fingerprint.

Alpha.2 installers and tags stay as they are. This branch does not publish a build.

## Execution status

**BLOCKED** on Linux cloud agents. Only a native Windows 10/11 run on the Latitude 5480 counts as Windows verification.

## What to run

On the laptop, from this branch:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows-smoke/Run-M10-Latitude5480.ps1 -ExpectedCommit 29ef2d113546b64d2482aea988ede0900ee7ee3b
```

Or manually:

```text
npm ci
npx playwright install chromium
npm run build
npm run test:m10
npm run test:m11
```

`test:m10` is the fingerprint unit tests plus `test/fingerprint-browser.test.js`. A skip is not a pass. If Chromium is missing, the browser test should fail, not skip.

Then launch one visible profile with automation off and WebGL left at Default. Read the renderer from the Hardware tab. Expect an Intel HD 620 string only if that is what the page actually returns. If it differs, write the text down. Do not edit it into a profile.

## What Linux did not prove

- WebGPU: `navigator.gpu` existed on `http://127.0.0.1`, and `requestAdapter()` returned no adapter with and without `--disable-features=WebGPU`. The API did not go away, so this branch does not offer a WebGPU-off switch. Repeat that pair of checks on the laptop before describing HD 620 as having or not having WebGPU. Gen 9.5 hardware often has no usable WebGPU adapter. Absence is not a mask.
- `--disable-webgl` removed the WebGL context on Linux. Confirm the same on Windows. Confirm the renderer comes back after switching the profile to Default and launching again.
- Local-fonts, camera, and microphone deny were applied with `Browser.setPermission` on a loopback page. Confirm a normal `http` page on Windows shows denied for those three when the profile is Restricted, and prompt or the user’s choice when it is Real.
- Device scale on this laptop may be 1 or 1.25. The Linux test used a configured 2× and is not the panel’s scale.
- Port-scan protection was a command-line check that private-network features were not disabled. It did not open local ports. Do not treat it as a Windows firewall result.

## What not to change if the laptop disagrees

If HD 620’s renderer, WebGPU adapter, or font permission differs from Linux, record the difference. Do not add a Windows-only vendor string, a fake adapter, or a font list to make the two hosts match.
