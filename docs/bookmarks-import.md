# Bookmarks import and export

Import and export work on a profile's on-disk `Default/Bookmarks` file. Both are available for **stopped Chromium-based profiles** (bundled Chromium, AZWAH native, privacy engine and Chrome Stable runtimes). Firefox profiles are refused with a clear message.

Where: **Profiles → ⋮ → Storage**. The buttons are *Export bookmarks* (JSON), *Export bookmarks (HTML)* and *Import bookmarks…*.

API (both `/api` and `/api/v1`):

| Route | Purpose |
|---|---|
| `GET /profiles/:id/bookmarks/export` | Flat JSON list `{ availability, bookmarks: [{ name, url, folder, dateAdded }] }` (existing) |
| `GET /profiles/:id/bookmarks/export.html` | Netscape bookmark HTML, the format every desktop browser imports |
| `POST /profiles/:id/bookmarks/import` | Body `{ content: "<file text>" }`; returns `{ format, total, imported, duplicates, foldersCreated, rejected: [{ index, reason }] }` |

## Accepted files (detected from the content)

1. **Chromium `Bookmarks` JSON**: the file from a Chrome, Edge, Brave or Chromium profile folder.
2. **AZWAH bookmarks export JSON**: the output of *Export bookmarks*.
3. **Netscape bookmark HTML**: what *Export bookmarks* produces in Chrome, Edge, Firefox and Safari, and AZWAH's *Export bookmarks (HTML)*. The `PERSONAL_TOOLBAR_FOLDER` heading maps to the bookmarks bar. Links at the top level go to *Other bookmarks*. A top-level *Mobile bookmarks* heading maps to mobile bookmarks.

## Policy

- **Additive.** Existing bookmarks are never removed or renamed.
- **Folders merge by name.** An imported folder with the same name and parent as an existing one is merged into it.
- **Duplicates.** A link whose URL is already in the *same folder* (existing, or earlier in the same file) is skipped and counted under `duplicates`. The same URL in a different folder is a separate bookmark. Importing the same file twice adds nothing the second time.
- **Links.** Only `http:` and `https:` URLs are imported. `javascript:`, `data:`, `file:`, `chrome:` and empty or malformed URLs are rejected per item and reported in `rejected`. The rest of the file still imports.
- **Names are data.** Folder and bookmark names are stored as text in the bookmarks tree and never become file-system paths, so a name such as `../../x` or `C:\Windows` is just a folder title.
- **Limits.** Files can be up to 5 MB and hold up to 5,000 bookmarks, with folders nested at most 20 levels deep. Larger or deeper files are refused as a whole.

## Safety

- **Stopped profiles only.** A running browser rewrites the Bookmarks file and would overwrite the import, so a running profile gets `409 PROFILE_RUNNING`. The import holds the profile lock, so a launch cannot start partway through.
- **Atomic replace.** The new tree is written to a temporary file in the same folder and renamed over `Bookmarks`. If writing or renaming fails, the previous file stays as it was and the temporary file is removed (`500 BOOKMARKS_WRITE_FAILED`, "Bookmarks were not changed").
- **Malformed input changes nothing.** Empty, unparseable, unknown-format, oversized or too-deep files are refused before anything is written (`400`/`413`).
- **An unreadable existing file is not overwritten.** If the profile's current `Bookmarks` cannot be parsed, the import stops (`409 BOOKMARKS_EXISTING_INVALID`) instead of replacing it. Launching the profile once lets Chrome repair or restore it from `Bookmarks.bak`.
- AZWAH removes the stale `checksum` field, gives new nodes unique ids and GUIDs, and Chrome recomputes the checksum on the next launch.

## Verification

- `test/bookmark-import.test.js` covers Chromium JSON, HTML and AZWAH JSON parsing; nested folders; Unicode and HTML entities; the duplicate policy; unsafe URLs and path-like names; malformed, empty, oversized and too-deep files; an unreadable existing file; an interrupted write (rename failure); a profile locked by another process; JSON, HTML and Chromium-file round trips; and repairing missing roots.
- `test/bookmark-import-api.test.js` covers isolation between two profiles, the HTML export → import round trip over HTTP, bad requests, files over the 1 MB default body limit, survival through backup and restore, and refusal while running. The running case launches a real Chromium and reads the imported nested and Unicode bookmarks back through Chromium's own `chrome.bookmarks` API, which confirms the browser accepts the written file.
- Both run in the Windows native gate (`npm run test:productivity`).
