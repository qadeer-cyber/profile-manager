// Plain-language rollup for fingerprint consistency (no stealth claims).
export function summarizeConsistency(consistency) {
  if (!consistency?.findings?.length) {
    return { headline: 'No consistency report yet.', detail: 'Launch the profile to collect browser observations.' };
  }
  const tally = consistency.counts || { pass: 0, warning: 0, unsupported: 0, unavailable: 0 };
  const warnings = consistency.findings.filter(item => item.status === 'warning');
  if (warnings.length) {
    return {
      headline: `${warnings.length} mismatch${warnings.length === 1 ? '' : 'es'} need attention`,
      detail: warnings.slice(0, 3).map(item => item.summary).join(' '),
      tally,
    };
  }
  if (tally.unavailable > tally.pass) {
    return {
      headline: 'Partial observation',
      detail: 'Some signals were not collected. Open the profile and refresh hardware diagnostics.',
      tally,
    };
  }
  return {
    headline: 'Configured settings match what Chromium exposed',
    detail: 'Unsupported rows document features that stock Chromium cannot spoof per-profile.',
    tally,
  };
}
