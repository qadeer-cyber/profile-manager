import React from 'react';

/** Small nav/capability indicator — does not imply Multilogin parity. */
export function FeaturePill({ variant = 'unavailable', title, children }) {
  return <span className={`pill ${variant}`} title={title}>{children}</span>;
}
