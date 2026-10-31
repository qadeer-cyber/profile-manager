# M33 — Human-like input timing (authorized UI testing)

**Status: PARTIAL**

## What passed

Chromium CDP typing uses schedule model `interkey-wpm-v1`:

- Deterministic mode is stable.
- A fast digraph is shorter than the base delay. Punctuation is longer.
- The Chromium path sleeps each planned interval, then returns `measuredIntervalsMs` from `Date.now()` around that wait and the key dispatch.
- On a local fixture, measured intervals were at least the planned interval minus 25 ms, and the input value matched.

Tests: `test/human-input-timing.test.js`, `test/human-input.test.js`.

The report states this is authorized local UI testing and not a CAPTCHA bypass.

## Firefox limit (why not VERIFIED)

Firefox sends the same schedule as W3C action `pause` durations through geckodriver. The result sets `timingMeasured: false` and `measuredIntervalsMs: null`. The stub test checks that payload. It does not read Firefox keydown timestamps, and no live Firefox clock was measured on this host.
