#!/usr/bin/env python3
"""Connect Playwright Python to a Profile Manager profile.

Automation is opt-in. This script launches through the local API with
{"automation": true}, then connects only when the returned CDP address is
loopback (127.0.0.1 or localhost). It does not open a public debugging port.

Environment:
  PM_API_TOKEN   required bearer token
  PROFILE_ID     required profile id
  PM_URL         default http://127.0.0.1:3000
  TARGET_URL     default https://example.com

Install the client separately: pip install playwright && playwright install chromium
The profile keeps running after Playwright disconnects; this script then stops it.
"""
import json
import os
import sys
import urllib.error
import urllib.request


def loopback(endpoint):
    from urllib.parse import urlparse
    parsed = urlparse(endpoint)
    if parsed.scheme not in ("ws", "wss", "http", "https"):
        raise SystemExit("CDP endpoint must be an http or ws URL")
    if parsed.hostname not in ("127.0.0.1", "localhost"):
        raise SystemExit("Refusing a CDP endpoint that is not on loopback")
    return endpoint


def api(method, path, token, payload=None):
    base = os.environ.get("PM_URL", "http://127.0.0.1:3000").rstrip("/")
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            body = response.read().decode()
            return response.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode()
        try:
            parsed = json.loads(body) if body else {}
        except json.JSONDecodeError:
            parsed = {"error": body}
        return error.code, parsed


def main():
    token = os.environ.get("PM_API_TOKEN", "")
    profile_id = os.environ.get("PROFILE_ID", "")
    if not token or not profile_id:
        print("PM_API_TOKEN and PROFILE_ID are required. CDP stays on loopback and automation is opt-in.", file=sys.stderr)
        return 2
    status, profile = api("POST", f"/api/v1/profiles/{profile_id}/launch", token, {"automation": True})
    if status >= 400:
        print(profile.get("error") or profile.get("message") or status, file=sys.stderr)
        return 1
    endpoint = loopback(profile["cdp"]["wsEndpoint"])
    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(endpoint)
        context = browser.contexts[0]
        page = context.new_page()
        page.goto(os.environ.get("TARGET_URL", "https://example.com"))
        print("title:", page.title())
        browser.close()
    api("POST", f"/api/v1/profiles/{profile_id}/stop", token, {})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
