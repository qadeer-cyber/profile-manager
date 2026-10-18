#!/usr/bin/env bash
# Verifies Electron safeStorage on Linux with a real keyring (gnome-keyring over a private D-Bus session)
# and the migration of existing AES-key-file secrets to safeStorage.
set -e
cd "$(dirname "$0")/.."
UD=$(mktemp -d /tmp/pm-ss-XXXX); export PM_SMOKE_USERDATA=$UD
echo "== run 1: no keyring (expect AES fallback + warning)"
env -u DBUS_SESSION_BUS_ADDRESS node test/electron-smoke.js | grep -E "PASS|FAIL|passed"
node -e 'const r=require("/tmp/pm-last-smoke.json");if(r.storedSecretPrefix!=="enc:v1:")process.exit(1)' && echo "PASS run1 stored AES secret"
echo "== run 2: gnome-keyring available (expect migration to safeStorage)"
dbus-run-session -- bash -c 'echo -n testpw | gnome-keyring-daemon --unlock --components=secrets >/dev/null; PM_SMOKE_ARGS="--password-store=gnome-libsecret" node test/electron-smoke.js' | grep -E "PASS|FAIL|passed"
node -e 'const r=require("/tmp/pm-last-smoke.json");console.log("backend:",r.diagnostics.encryption.backend,"reencrypted:",r.reencrypted,"stored:",r.storedSecretPrefix);if(r.diagnostics.encryption.backend!=="electron-safeStorage"||r.storedSecretPrefix!=="ss:v1:"||!(r.reencrypted>=1))process.exit(1)' && echo "PASS run2 existing secret migrated AES -> safeStorage"
rm -rf "$UD"
