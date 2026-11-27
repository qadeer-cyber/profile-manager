import React from 'react';
import { onboardingSteps, guideProgress } from '../lib/onboarding.js';
import '../get-started.css';

// First-run checklist on the Profiles page. State comes from real data; the user can dismiss it and reopen it from the
// empty table.
export function GetStarted({ browser, meta, onAction, onDismiss }) {
  const steps = onboardingSteps({ browser, meta });
  const progress = guideProgress(steps);
  const label = { done: 'Done', todo: 'To do', blocked: 'Waiting', unknown: 'Checking' };
  return <section className="get-started" aria-label="Get started">
    <div className="gs-head">
      <div><h2>Get started</h2><p className="muted small">{progress.done} of {progress.total} required steps done</p></div>
      <button type="button" className="ghost" onClick={onDismiss}>Hide</button>
    </div>
    <ol className="gs-steps">
      {steps.map(step => <li key={step.id} data-state={step.state}>
        <span className={'gs-mark ' + step.state} aria-hidden="true">{step.state === 'done' ? '✓' : ''}</span>
        <div className="gs-body">
          <strong>{step.title}</strong> <span className="sr-only">({label[step.state]})</span>
          <p className="muted small">{step.detail}</p>
          {step.id === 'profile' && step.state === 'todo' && <div className="gs-actions">
            <button type="button" className="primary" onClick={() => onAction('create')}>Create a profile</button>
            <button type="button" onClick={() => onAction('quick')}>Quick profile</button>
            <button type="button" onClick={() => onAction('bulk')}>Bulk create from proxy list</button>
          </div>}
          {step.id === 'proxy' && step.action && <div className="gs-actions"><button type="button" onClick={() => onAction('proxies')}>Add proxies</button></div>}
          {step.id === 'browser' && step.action === 'diagnostics' && <div className="gs-actions"><button type="button" className="primary" onClick={() => onAction('diagnostics')}>Open Diagnostics</button></div>}
        </div>
      </li>)}
    </ol>
  </section>;
}
