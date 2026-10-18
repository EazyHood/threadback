# Validation record

Checked on 18 October 2026 with synthetic data. These are software checks, not a student study or an accessibility certification.

## Automated checks

`npm test` passed 28 tests using Node.js 24.16.0 on Windows. The suite covers card states, draft preservation, link validation, backup validation and recovery, stale storage revisions, failed writes, and the local HTTP server. Regression cases exercise full workspaces with ASCII, multibyte Unicode, emoji and escaped characters; the import/export limit is measured in UTF-8 bytes. Calendar checks reject impossible dates and distinguish leap years.

## Browser checks

The app was exercised in desktop Chromium browsers (Edge and the Codex in-app browser):

- Capture, resume, revise, finish and reopen cards; resume keeps a thread open. Reopening a blocked completed card restores its blocker and alternative.
- Keep an unfinished draft while selecting another thread. With browser saving enabled, reload and recover that draft.
- Export a real JSON file containing two cards and an unfinished draft. Change the draft, import that file through the file picker, confirm replacement, and verify the original draft and incomplete reference text return exactly.
- Import an unsupported backup and verify that both cards and the draft remain unchanged.
- Open two tabs on the same origin. A change in one pauses saving in the other; editing the stale tab does not overwrite the newer stored card. The stale tab's work remains available locally.
- Cancel replacement and erase dialogs with Escape; the workspace and saving state remain intact.
- Check a card at a 390-pixel viewport and the editor at 320 pixels, including an actual edit. No page-wide horizontal overflow was observed in those views.
- Enter markup-like text and observe literal text rather than injected HTML.

Independent review found three issues before publication: valid large backups could exceed the old import limit, impossible imported dates could silently normalize, and the history limit was not explained near the editor. The implementation now shares a 4 MiB UTF-8 limit between the model and file picker, validates calendar dates strictly, and states that only the five most recent previous cards remain. Regression tests cover the corrected cases.

## Limits

No screen-reader audit, physical mobile-device test, exhaustive keyboard audit, usability study or measured educational benefit is claimed. Narrow viewport tests do not establish compatibility with every device. Storage quota failures and stale revisions have model tests; no artificial browser quota exhaustion was performed. No offline-loading, encryption or cloud synchronization guarantee is made. Browser storage and exported backups contain readable user-authored text. The implementation was reviewed for note transmission, but this is not a network penetration test or security certification.

The public demo has no real student records. See [CREDITS.md](CREDITS.md) for substantial AI assistance and the earlier conceptual work.
