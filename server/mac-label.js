// Per-profile MAC label (owner-chosen option). A saved identifier for the owner's own records only.
// Websites cannot read a MAC address, so it is never passed to Chrome, and AZWAH never changes a
// network adapter. Labels are locally administered unicast addresses (first octet xxxxxx10).
import { createHash, randomBytes } from 'node:crypto';

export const MAC_LABEL_NOTE = 'Saved label only. Websites cannot read a MAC address; AZWAH does not change your network adapter.';

const format = bytes => {
  const b = [...bytes.subarray(0, 6)];
  b[0] = (b[0] & 0xfc) | 0x02;
  return b.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
};

export const deriveMacLabel = id => format(createHash('sha256').update('azwah-mac-label:' + String(id)).digest());
export const randomMacLabel = () => format(randomBytes(6));

export function validateMacLabel(value) {
  const hex = typeof value === 'string' ? value.trim().toUpperCase().replace(/[-.:]/g, '') : '';
  if (!/^[0-9A-F]{12}$/.test(hex) || (parseInt(hex.slice(0, 2), 16) & 1)) {
    const error = new Error('MAC label must be six hex bytes for a unicast address, for example 02:AB:CD:EF:01:23.');
    error.status = 400; error.code = 'INVALID_MAC_LABEL';
    throw error;
  }
  return hex.match(/../g).join(':');
}
