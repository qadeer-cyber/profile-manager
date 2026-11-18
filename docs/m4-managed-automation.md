# Managed Chromium automation

Enable automation in the profile editor and open the profile’s Automation dialog. Start a session on an existing automation-enabled Chromium launch or launch the profile from the dialog. Ready means the loopback CDP endpoint is available for a client. It does not report whether an external client has attached. The dialog shows the latest 20 session records, start and end times, and fixed diagnostic messages.

Cancel session and stop browser closes the selected profile’s browser to revoke that endpoint. Save browser work first. A browser exit or Azwah restart ends the record without replaying client actions. After a new launch, create a new session and use its new endpoint.

The Desktop UI uses its session token. Scripts use a local API bearer token. Keep the API and CDP loopback-only. The reservation prevents duplicate managed sessions per profile. Raw CDP is a trusted local interface, so it cannot prevent other same-machine clients from attaching. Keep the endpoint private. Stop the ChromeDriver bridge before reserving a managed session on that profile. Firefox tools remain separate. Managed Firefox sessions are unavailable.

## JavaScript

Install Playwright with npm, set AZWAH_API_TOKEN and AZWAH_PROFILE_ID in the environment, and adjust AZWAH_API_URL to the application’s loopback URL. Start the selected profile with automation enabled.

```js
import { chromium } from 'playwright';

const root = process.env.AZWAH_API_URL;
const id = encodeURIComponent(process.env.AZWAH_PROFILE_ID);
const response = await fetch(new URL(`/api/v1/profiles/${id}/automation-sessions`, root), {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.AZWAH_API_TOKEN}` },
});
if (!response.ok) throw new Error(`Azwah returned HTTP ${response.status}`);
const { endpoint } = await response.json();
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = await browser.contexts()[0].newPage();
  try { await page.goto('about:blank'); } finally { await page.close(); }
} finally { await browser.close(); }
```

## Python

Install the Python playwright package. Use the same environment variables and an automation-enabled running profile. If a managed session is already ready, GET the existing session instead of creating a duplicate.

```python
import json
import os
from urllib.parse import quote
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright

root = os.environ["AZWAH_API_URL"].rstrip("/")
profile = quote(os.environ["AZWAH_PROFILE_ID"], safe="")
url = f"{root}/api/v1/profiles/{profile}/automation-sessions"
request = Request(url, headers={"Authorization": "Bearer " + os.environ["AZWAH_API_TOKEN"]})
with urlopen(request, timeout=10) as response:
    endpoint = json.load(response)["endpoint"]
if not endpoint:
    raise RuntimeError("Start a managed session in Azwah first")

with sync_playwright() as playwright:
    browser = playwright.chromium.connect_over_cdp(endpoint)
    try:
        page = browser.contexts[0].new_page()
        try:
            page.goto("about:blank")
        finally:
            page.close()
    finally:
        browser.close()
```

Closing the attached client detaches it. To end the managed session and close the browser, POST to the session collection followed by /SESSION_ID/cancel, or use the dialog.
