# Geckodriver bridge (Firefox automation only)

Firefox profiles use **marionette** when launched with `automation: true`. Chromium profiles use the ChromeDriver bridge instead.

## Geckodriver sources

| Source | Notes |
|--------|--------|
| **Opt-in cache** | Settings → automation driver cache → **Download geckodriver** (Mozilla **MPL-2.0**, pinned v0.36.0). |
| `PM_GECKODRIVER_PATH` | Custom executable path. |
| PATH | `geckodriver` on PATH. |

Not bundled in the offline installer.

## Steps

1. Create/use a **Firefox** profile (`browserEngine: firefox`).
2. `POST /api/v1/profiles/:id/launch` with `{ "automation": true }`.
3. `POST /api/v1/profiles/:id/geckodriver/start` → `webdriverUrl`.
4. Attach Selenium to `webdriverUrl` (marionette protocol).
5. `POST /api/v1/profiles/:id/geckodriver/stop` and stop the profile.

**CookieRobot-local** does not support Firefox (Chromium CDP only).
