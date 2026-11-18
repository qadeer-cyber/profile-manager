# Puppeteer attach (automation launch only)

Manual browsing does **not** open CDP. Enable **automation** on the profile or pass `"automation": true` on `POST /api/v1/profiles/:id/launch`.

After launch, read `cdp.wsEndpoint` from the profile JSON (desktop UI or `GET /api/v1/profiles/:id`), then:

```javascript
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
const pages = await browser.pages();
// ... your automation (user-authorized only)
await browser.disconnect();
```

No CAPTCHA bypass. Disconnecting does not stop the profile; call `POST /api/v1/profiles/:id/stop` when finished.
