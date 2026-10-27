# Attach Selenium to a running profile via debuggerAddress.
# Requires: pip install selenium requests  (Selenium Manager fetches a matching chromedriver;
# its major version must match the Playwright Chromium version)
# Usage: PM_API_TOKEN=... PROFILE_ID=... python examples/selenium_attach.py
import os, requests
from selenium import webdriver

BASE = os.environ.get("PM_URL", "http://127.0.0.1:3000")
H = {"Authorization": f"Bearer {os.environ['PM_API_TOKEN']}"}
pid = os.environ["PROFILE_ID"]

profile = requests.post(f"{BASE}/api/v1/profiles/{pid}/launch", json={}, headers=H).json()
opts = webdriver.ChromeOptions()
opts.debugger_address = profile["cdp"]["debuggerAddress"]   # e.g. 127.0.0.1:41234
driver = webdriver.Chrome(options=opts)
driver.get(os.environ.get("TARGET_URL", "https://example.com"))
print("title:", driver.title)
driver.quit()  # ends the chromedriver session; then stop the profile through the API
requests.post(f"{BASE}/api/v1/profiles/{pid}/stop", headers=H)
