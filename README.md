# Threadback

Save your place, your last decision, and your next action. Return to one clear starting point.

Threadback is a small study tool for the moment a task is interrupted. A return card preserves the exact question, page, section, or line; the decision behind the work; and one concrete next action. The next visit starts from that card, with a separate path for a changed plan or an unresolved blocker.

Threadback is a prototype built for Taskforge. [Open the working demo](https://eazyhood.github.io/threadback/) and follow the [six-step walkthrough](WALKTHROUGH.md). See [VALIDATION.md](VALIDATION.md) for the recorded checks, tested environments, and remaining limitations.

## Run locally

Use Node.js 20 or later. The app is static HTML, CSS, and vanilla JavaScript ES modules. Its local server and tests use Node.js built-ins; no package installation, account, API key, or runtime AI service is required.

From the project directory:

```sh
node server.mjs
```

Open [the local application](http://127.0.0.1:4178). Run the test command from the same directory:

```sh
npm test
```

The server serves `dist/` on the loopback interface. The tests launch their own server on an ephemeral port and close it afterward. Local saving requires Web Locks support in the browser; without it, the app offers the unsaved workflow and manual backups.

## The return workflow

1. Create a thread with a recognizable title and a next action. Add an exact anchor, the last decision, and reference links when useful.
2. Pause with a return card. Recapturing an existing thread keeps its previous context as a checkpoint.
3. Return to the next action and its context. Resuming keeps the task open; it does not mark the work completed.
4. Replan if the next action no longer fits. The five most recent checkpoints remain available; older ones are removed as new checkpoints are added. If a dependency is missing, preserve the blocker and the alternative you wrote yourself.
5. Finish deliberately. Reopening a completed task is separate from resuming a paused task.

The states are `active`, `paused`, `blocked`, and `completed`. Threadback does not generate academic advice or decide that a task has been finished. A workspace holds up to 20 threads, with up to three reference links on each card.

## Data and recovery

Local saving is opt-in through **Browser saving**. When it is off, the workspace exists only in the current tab. When it is on, the status distinguishes an outstanding write, a saved browser copy, and a paused or failed save. Keep the tab open and export your work if saving fails.

The browser copy and JSON backup include the unfinished editable draft, including the raw link text even when it is incomplete or invalid. An unfinished link does not become an active reference until the card passes validation. Closing the editor keeps the draft accessible from the sidebar; discarding it is a separate confirmed action.

Web Locks serialize browser writes, and revision checks detect stale copies. A change or erase in another tab pauses saving here and preserves this tab's work for export. Loading another copy or importing a backup over existing work requires confirmation.

JSON import and export use the same **4 MiB limit: 4,194,304 UTF-8 bytes**. A backup includes current cards, their retained checkpoints, and the draft. Import checks the format, version, references, field limits, dates, and HTTP/HTTPS links before replacement. The five-checkpoint limit also applies to backups: export preserves what currently remains, not older discarded history.

Browser storage is not cloud synchronization or a permanent backup. Clearing site data, changing browser profiles, or losing this device can make saved cards unavailable. Export is a manual backup; exported JSON is ordinary readable text. Do not put sensitive student records in the demo. External links open only when selected and are subject to the destination's own behavior. Threadback does not restore an external page's scroll position, selection, or login state.

The source has no telemetry or note-upload service, and the main page's content policy disables network connections from app scripts. This is a description of the implementation, not a guarantee about the browser, extensions, or external sites. A locally saved card does not mean that the app can load without a network connection; no offline-loading guarantee is made.

## Demonstration and limits

Use **Try the study example** to load the included synthetic example and its statistics worksheet. It represents no real course, student, grade, or research participant. A second card demonstrates a fictional missing dataset and a user-written alternative. Loading the example replaces the current workspace only after confirmation when work is present.

The corrected local suite passed 28 checks. Edge review exercised a stale copy in a second tab, draft recovery, blocked/completed/reopened states, and a real backup-file round trip. The card was reviewed at a 390 px viewport and the editor at 320 px without observed page-wide horizontal overflow. See [VALIDATION.md](VALIDATION.md) for the exact scope and remaining checks.

No interviews, classroom deployment, usability study, measured time saving, improved grades, or clinical benefit have been established. These are software checks with synthetic data, not a student outcome study or WCAG certification. Narrow browser viewports do not constitute physical-device testing.

## Originality and credits

The earlier [Benchkeep project](https://github.com/EazyHood/benchkeep) already explored returning to unfinished craft work. Threadback does not claim to invent pause-and-return notes. Its contribution is an academic anchor, a recorded decision, and explicit return/replan/blocker states in a new application. A note template can hold the same information; Threadback provides a focused interaction around it.

OpenAI Codex provided substantial assistance with research, design, implementation, tests, and documentation. See [CREDITS.md](CREDITS.md) for attribution and sources. Source and documentation are covered by the [MIT license](LICENSE), subject to the scope described in the credits.
