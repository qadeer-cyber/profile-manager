import React from 'react';

/** Consistent loading / error / empty helpers for list pages. */
export function PageLoading({ label = 'Loading…' }) {
  return <p className="muted" role="status" aria-busy="true">{label}</p>;
}

export function PageError({ message }) {
  if (!message) return null;
  return <div className="notice warn" role="alert">{message}</div>;
}

export function TableEmpty({ colSpan, loaded, emptyMessage, loadingMessage = 'Loading…' }) {
  if (!loaded) return <tr><td colSpan={colSpan} className="empty">{loadingMessage}</td></tr>;
  return <tr><td colSpan={colSpan} className="empty">{emptyMessage}</td></tr>;
}
