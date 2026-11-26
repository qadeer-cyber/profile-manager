# Milestone A — compact profile table

Measured with Playwright against a disposable data directory seeded with nine realistic profiles
(long names, long notes, up to five tags, library proxies with stored proxy-exit evidence, native,
privacy and Chrome Stable runtimes, automation, an errored profile and a quick profile).
Heights are `getBoundingClientRect().height` of every `tbody tr`.

| Viewport | Row height before (px) | Row height after (px) | Toolbar height (px) | Table horizontal scroll |
|---|---|---|---|---|
| 1366x768 | 157.3–298 (median 157.3) | 48–48 | 99 → 59 | yes → no |
| 1920x1080 | 175.5–666.8 (median 222) | 48–48 | 56 → 59 | no → no |
| 1024x768 | 157.3–587.6 (median 254.3) | 48–48 | 99 → 59 | yes → no |

With **Compact rows** enabled the rows measure 41 px.

## What changed

- `ProfileRow` component: one fixed-height line per profile. All cells are `nowrap` with ellipsis;
  full values are in tooltips and in the new **Details** dialog.
- Row actions: square Launch/Stop button at the start of the row, an Edit pencil that appears on
  hover/focus, and a keyboard-accessible ⋮ menu (`RowActionsMenu`, rendered in a portal so the
  scrolling table cannot clip it) for focus, details, automation, proxy, storage, export, clone,
  save as regular, save as template and move to trash. Accessible names are unchanged
  (`Edit <name>`, `Export <name>`, `Delete <name>`, `Launch <name>`, `Stop <name>`, …).
- Proxy-exit evidence and native-runtime verification statements that used to stack under the
  name now live in the Details dialog with identical wording; the proxy cell shows a dot whose
  tooltip says which check produced the evidence.
- Toolbar, filters, table and pager share one card. The selection toolbar is an icon group; the
  filter row opens from the search field and stays open while a filter is active.
- Width allocation uses `table-layout: fixed` with explicit column widths; columns drop by priority
  (storage → last used → notes → engine/folder → tags/status → proxy) with container queries on the
  card, so the sidebar width is accounted for.
- Fixed: the **Quick** button always failed with HTTP 400 because the quick-profile payload sent
  `advancedSettings: undefined`.

Screenshots: `before-*.png`, `after-*.png` in this folder.
