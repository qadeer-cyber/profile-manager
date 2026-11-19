import React from 'react';
import { Icon } from './Icon.jsx';
import { RowActionsMenu } from './RowActionsMenu.jsx';
import { crashSummary } from '../lib.js';
import { engineLabel, compactDate, proxyLabel, proxyEvidenceSummary, proxyVerificationLevel, tabRestoreBadge } from '../lib/profileRow.js';

// One single-line profile row. Every cell is nowrap + ellipsis; long content lives in tooltips and
// in the details dialog, so the row height stays fixed regardless of data.
export function ProfileRow({ p, st, columns, selected, busy, onToggle, on }) {
  const show = key => columns[key] !== false;
  const engine = engineLabel(p);
  const proxy = proxyLabel(p.proxy);
  const tabs = tabRestoreBadge(p.tabRestore, p.running);
  const level = proxyVerificationLevel(p.lastProxyLocation);
  const lastUsed = p.last_launched_at ? new Date(p.last_launched_at) : null;
  const errorTitle = st.showError ? `${crashSummary(p.last_error)}\n\n${p.last_error || ''}`.trim() : undefined;
  const items = [
    { key: 'focus', label: 'Bring window to front', ariaLabel: `Focus ${p.name}`, icon: 'window', hidden: !p.running, disabled: busy, onSelect: on.focus },
    { key: 'details', label: 'Details', ariaLabel: `Details for ${p.name}`, icon: 'info', onSelect: on.details },
    { key: 'edit', label: 'Edit profile', ariaLabel: `Edit profile ${p.name}`, icon: 'edit', onSelect: on.edit },
    { key: 'automation', label: 'Automation (CDP / WebDriver)', ariaLabel: `Automation ${p.name}`, icon: 'bolt', hidden: !p.automationEnabled, onSelect: on.automation },
    { key: 'proxy', label: 'Proxy connection', ariaLabel: `Proxy ${p.name}`, icon: 'proxies', separatorBefore: true, onSelect: on.proxy },
    { key: 'storage', label: 'Storage', ariaLabel: `Storage ${p.name}`, icon: 'storage', onSelect: on.storage },
    { key: 'export', label: 'Export portable backup (.pmp)', ariaLabel: `Export ${p.name}`, icon: 'download', disabled: busy || p.running, title: p.running ? 'Stop the profile before exporting' : undefined, onSelect: on.export },
    { key: 'clone', label: 'Clone', ariaLabel: `Clone ${p.name}`, icon: 'copy', disabled: busy, onSelect: on.clone },
    { key: 'regular', label: 'Save as regular profile', ariaLabel: `Save as regular ${p.name}`, icon: 'check', hidden: !p.isQuick, disabled: busy, onSelect: on.saveRegular },
    { key: 'template', label: 'Save as template', ariaLabel: `Template from ${p.name}`, icon: 'templates', disabled: busy, onSelect: on.template },
    { key: 'delete', label: 'Move to trash', ariaLabel: `Delete ${p.name}`, icon: 'trash', danger: true, separatorBefore: true, onSelect: on.delete },
  ];
  return <tr className={(selected ? 'selected ' : '') + (p.running ? 'is-running' : '')} data-profile-id={p.id}>
    <td className="cb"><input type="checkbox" aria-label={'Select ' + p.name} checked={selected} onChange={onToggle} /></td>
    <td className="fav"><button type="button" className="icon-btn star" disabled={busy} aria-label={`Favorite ${p.name}`} aria-pressed={p.favorite} title={p.favorite ? 'Remove favorite' : 'Add favorite'} onClick={on.favorite}>
      {p.favorite ? <span aria-hidden="true" className="star-on">★</span> : <Icon name="star" size={15} />}</button></td>
    <td className="col-run">
      {p.running
        ? <button type="button" className="run-btn stop" disabled={busy} aria-label={'Stop ' + p.name} title="Stop profile" onClick={on.stop}><Icon name="stop" size={13} /></button>
        : <button type="button" className="run-btn" disabled={busy} aria-label={'Launch ' + p.name} title={busy ? 'Starting…' : 'Launch profile'} onClick={on.launch}><Icon name="play" size={13} /></button>}
    </td>
    {show('status') && <td className="col-status"><span className={'status ' + st.key} title={errorTitle}><i />{st.label}</span></td>}
    {show('name') && <td className="col-name"><div className="name-line">
      <span className="name" title={p.name}>{p.name}</span>
      {p.isQuick && <span className="badge" title="Quick profile">quick</span>}
      {st.showError && <span className="err-text row-error" title={errorTitle}><Icon name="info" size={12} />{crashSummary(p.last_error)}</span>}
      {p.automationEnabled && !p.running && <span className="badge" data-badge="automation" title="Automation enabled" aria-label="Automation enabled">Auto</span>}
      {p.cdp && <span className="badge" title={`Automation endpoint: ${p.cdp.wsEndpoint || p.cdp.debuggerAddress}`}>CDP</span>}
      {tabs && <span className="badge" title={tabs.title}>{tabs.text}</span>}
    </div></td>}
    {show('engine') && <td className="col-engine" title={engine.full}><span className="engine-line"><span className="engine-name">{engine.short}</span>{engine.qualifier && <span className="qual">{engine.qualifier}</span>}</span></td>}
    {show('storage') && <td className="col-storage" title="Stored in the local data folder"><Icon name="storage" size={14} /><span>Local</span></td>}
    {show('folder') && <td className="col-folder">{p.folder ? <button className="link" title={p.folder} onClick={on.folder}>{p.folder}</button> : <span className="muted">None</span>}</td>}
    {show('proxy') && <td className="col-proxy">{proxy.direct ? <span className="muted">Direct</span> : <span className="proxy-cell" title={proxy.title + (p.lastProxyLocation ? '\n' + proxyEvidenceSummary(p.lastProxyLocation) : '')}>
      {level && <i className={'exit-dot ' + level.key} aria-label={level.label} role="img" />}
      <span className="mono-sm">{proxy.text}</span>{proxy.authenticated && <Icon name="lock" size={12} />}
    </span>}</td>}
    {show('notes') && <td className="col-notes" title={p.notes || ''}>{p.notes || ''}</td>}
    {show('tags') && <td className="col-tags" title={p.tags.join(', ')}><div className="tag-line">{p.tags.map(t => <button key={t} className="tag" title={`Filter by ${t}`} onClick={() => on.tag(t)}>{t}</button>)}</div></td>}
    {show('lastused') && <td className="col-lastused muted" title={lastUsed ? lastUsed.toLocaleString() : 'Never launched'}>{lastUsed ? compactDate(lastUsed) : '—'}</td>}
    <td className="actions col-actions">
      <button type="button" className="icon-btn row-edit" aria-label={'Edit ' + p.name} title="Edit" onClick={on.edit}><Icon name="edit" size={15} /></button>
      <RowActionsMenu label={`More actions for ${p.name}`} items={items} />
    </td>
  </tr>;
}
