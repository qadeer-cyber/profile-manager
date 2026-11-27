// Copy text to the clipboard. Both paths can fail (permissions, insecure context, blocked): the result says whether it worked.
export async function copyText(text, nav = globalThis.navigator, doc = globalThis.document) {
  try {
    if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(String(text)); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    if (!doc) return false;
    const area = doc.createElement('textarea');
    area.value = String(text); area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;left:-9999px';
    doc.body.appendChild(area); area.select();
    const ok = doc.execCommand?.('copy') === true;
    doc.body.removeChild(area);
    return ok;
  } catch { return false; }
}
