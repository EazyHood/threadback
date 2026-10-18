import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY, LIMITS, MAX_BACKUP_BYTES, STATES, ConflictError, emptyFields, emptyState, safeURL,
  validateFields, validateState, parseLinks, linksToText, beginDraft, capture,
  transition, removeThread, exportBackup, importBackup, readRecord,
  writeRecord, eraseRecord, sampleState,
} from '../dist/model.js';

const START = '2026-10-18T04:00:00.000Z';
const later = minute => `2026-10-18T04:${String(minute).padStart(2, '0')}:00.000Z`;
const PRACTICE = 'https://example.test/practice.html#question-3b';
const copy = value => structuredClone(value);

function fields(overrides = {}) {
  return {...emptyFields(), title: 'Statistics practice', next: 'Compare both medians.', ...overrides};
}

function draftState(overrides = {}, linksText = '') {
  const state = beginDraft(emptyState());
  state.draft.fields = fields(overrides);
  state.draft.linksText = linksText;
  return state;
}

function oneThread(overrides = {}) {
  return capture(draftState(overrides), 'study-1', START);
}

function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}

function memoryStorage(initial = null) {
  const map = new Map(initial === null ? [] : [[KEY, initial]]);
  return {
    writes: 0,
    removals: 0,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { this.writes++; map.set(key, String(value)); },
    removeItem(key) { this.removals++; map.delete(key); },
  };
}

function backupWith(state, changes = {}) {
  return JSON.stringify({format: 'threadback-backup', version: 1, exportedAt: START, state, ...changes});
}

test('a minimal card pauses with real context, without changing the draft input', () => {
  const source = frozen(draftState());
  const before = copy(source);
  const result = capture(source, 'study-1', START);
  assert.deepEqual(source, before);
  assert.equal(result.threads.length, 1);
  assert.equal(result.threads[0].status, 'paused');
  assert.equal(result.threads[0].next, 'Compare both medians.');
  assert.equal(result.selected, 'study-1');
  assert.equal(result.draft, null);
  assert.deepEqual(validateState(result), result);
});

test('resume, finish and reopen are separate; invalid transitions preserve the card', () => {
  const paused = frozen(oneThread());
  const active = transition(paused, 'study-1', 'resume', later(1));
  assert.equal(active.threads[0].status, 'active');
  assert.equal(active.threads[0].next, paused.threads[0].next);
  assert.equal(active.threads.length, 1);
  assert.equal(paused.threads[0].status, 'paused');
  assert.throws(() => transition(active, 'study-1', 'resume', later(2)));
  const completed = transition(active, 'study-1', 'finish', later(2));
  assert.equal(completed.threads[0].status, 'completed');
  assert.throws(() => transition(completed, 'study-1', 'resume', later(3)));
  const reopened = transition(completed, 'study-1', 'reopen', later(3));
  assert.equal(reopened.threads[0].status, 'paused');
  assert.throws(() => transition(reopened, 'study-1', 'reopen', later(4)));
  assert.throws(() => transition(reopened, 'missing-id', 'finish', later(4)));
  assert.throws(() => transition(reopened, 'study-1', 'invented-action', later(4)));
});

test('a blocker and user-written alternative survive finishing and reopening', () => {
  const blocked = oneThread({blocker: 'Waiting for a dataset.', alternative: 'Draft the methods outline.'});
  assert.equal(blocked.threads[0].status, 'blocked');
  assert.throws(() => transition(blocked, 'study-1', 'resume', later(1)));
  const completed = transition(blocked, 'study-1', 'finish', later(1));
  const reopened = transition(completed, 'study-1', 'reopen', later(2));
  assert.equal(reopened.threads[0].status, 'blocked');
  assert.equal(reopened.threads[0].alternative, 'Draft the methods outline.');
  const replanned = beginDraft(reopened, 'study-1');
  replanned.draft.fields.blocker = '';
  const available = capture(replanned, 'unused-new-id', later(3));
  assert.equal(available.threads[0].status, 'paused');
  assert.equal(available.threads[0].history[0].status, 'blocked');
});

test('replanning records the prior context and keeps only the five newest checkpoints', () => {
  let current = capture(draftState({anchor: 'Page 2', decision: 'Use the median.'}, `Worksheet | ${PRACTICE}`), 'study-1', START);
  const original = copy(current);
  for (let step = 1; step <= 7; step++) {
    const editing = beginDraft(current, 'study-1');
    editing.draft.fields.next = `Next action ${step}`;
    current = capture(editing, 'ignored-new-id', later(step));
  }
  const thread = current.threads[0];
  assert.equal(thread.history.length, 5);
  assert.deepEqual(thread.history.map(entry => entry.next), [6, 5, 4, 3, 2].map(n => `Next action ${n}`));
  assert.equal(thread.history[0].anchor, 'Page 2');
  assert.equal(thread.history[0].decision, 'Use the median.');
  assert.deepEqual(thread.history[0].links, [{label: 'Worksheet', url: PRACTICE}]);
  assert.equal(original.threads[0].history.length, 0);
  assert.equal(original.threads[0].next, 'Compare both medians.');
});

test('editing a card isolates its context links from the saved return card', () => {
  const state = capture(draftState({}, `Worksheet | ${PRACTICE}`), 'study-1', START);
  const editing = beginDraft(state, 'study-1');
  editing.draft.fields.links[0].label = 'Changed only in the draft';
  editing.draft.fields.anchor = 'A new anchor';
  assert.equal(state.threads[0].links[0].label, 'Worksheet');
  assert.equal(state.threads[0].anchor, '');
  assert.equal(editing.draft.linksText, `Worksheet | ${PRACTICE}`);
});

test('backup round trip preserves every state, checkpoint and unfinished raw links draft', () => {
  const state = oneThread({anchor: 'Section B, question 3b', decision: 'Compare medians.', context: 'Keep the outlier visible.'});
  state.threads = STATES.map((status, i) => ({...copy(state.threads[0]), id: `thread-${i}`, status}));
  state.selected = 'thread-0';
  state.threads[1].history = [{...fields({next: 'Earlier next action'}), at: START, status: 'active'}];
  state.draft = {id: 'thread-1', fields: emptyFields(), linksText: 'Unfinished link | https://'};
  const before = copy(state);
  const encoded = exportBackup(frozen(state), later(1));
  const restored = importBackup(encoded);
  assert.deepEqual(restored, before);
  restored.draft.fields.title = 'Independent restored draft';
  assert.equal(state.draft.fields.title, '');
  assert.equal(restored.draft.linksText, 'Unfinished link | https://');
});

test('an unsaved new draft survives backup even before it satisfies capture requirements', () => {
  const draft = beginDraft(emptyState());
  draft.draft.fields.title = 'Half a title';
  draft.draft.linksText = 'Still typing';
  const restored = importBackup(exportBackup(draft, START));
  assert.deepEqual(restored, draft);
  assert.throws(() => capture(restored, 'new-thread', START));
  assert.equal(restored.draft.fields.title, 'Half a title');
});

test('malformed and incompatible backup envelopes are rejected without altering current work', () => {
  const current = frozen(oneThread());
  const snapshot = copy(current);
  for (const text of [
    '', '{', 'null', '[]', 'false',
    backupWith(current, {format: 'other-tool'}),
    backupWith(current, {version: 2}),
    backupWith(current, {version: '1'}),
    backupWith(current, {exportedAt: 'not-a-date'}),
    ' '.repeat(MAX_BACKUP_BYTES + 1),
  ]) assert.throws(() => importBackup(text));
  assert.deepEqual(current, snapshot);
});

test('invalid imported workspace references and records are rejected as a whole', () => {
  const invalidations = [
    s => { s.threads.push(copy(s.threads[0])); },
    s => { s.selected = 'missing-thread'; },
    s => { s.threads[0].status = 'done'; },
    s => { s.threads[0].createdAt = 'yesterday'; },
    s => { s.threads[0].id = '../invalid'; },
    s => { s.threads[0].title = ' '; },
    s => { s.threads[0].next = ''; },
    s => { s.threads[0].history = Array.from({length: 6}, () => ({...fields(), at: START, status: 'paused'})); },
    s => { s.threads[0].history = [{...fields(), at: START, status: 'not-a-state'}]; },
    s => { s.draft = {id: 'missing-thread', fields: emptyFields(), linksText: ''}; },
    s => { s.draft = {id: null, fields: emptyFields()}; },
    s => { s.draft = {id: null, fields: emptyFields(), linksText: 'x'.repeat(3501)}; },
    s => { s.example = 'true'; },
  ];
  for (const invalidate of invalidations) {
    const bad = oneThread();
    invalidate(bad);
    const before = copy(bad);
    assert.throws(() => importBackup(backupWith(frozen(bad))));
    assert.deepEqual(bad, before);
  }
});

test('field and workspace limits reject excess while exact boundaries remain usable', () => {
  for (const [name, limit] of Object.entries(LIMITS)) {
    const exact = fields({[name]: 'x'.repeat(limit)});
    assert.equal(validateFields(exact, {required: true})[name].length, limit);
    assert.throws(() => validateFields({...exact, [name]: 'x'.repeat(limit + 1)}));
    assert.throws(() => validateFields({...exact, [name]: null}));
  }
  assert.throws(() => validateFields(fields({context: 'A\u0000B'})));
  assert.equal(validateFields(fields({context: 'First line\nSecond line\tvalue'})).context, 'First line\nSecond line\tvalue');
  const maximum = oneThread();
  maximum.threads = Array.from({length: 20}, (_, i) => ({...copy(maximum.threads[0]), id: `thread-${i}`}));
  maximum.selected = 'thread-0';
  assert.equal(validateState(maximum).threads.length, 20);
  assert.throws(() => beginDraft(maximum));
  assert.doesNotThrow(() => beginDraft(maximum, 'thread-0'));
  const tooMany = copy(maximum);
  tooMany.threads.push({...copy(tooMany.threads[0]), id: 'thread-20'});
  assert.throws(() => importBackup(backupWith(tooMany)));
});

test('dangerous or credential-bearing links fail both editor parsing and imported validation', () => {
  for (const url of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'file:///C:/secret.txt', '//example.test/path', '/relative-path',
    'https://user:password@example.test', 'https://user@example.test',
  ]) {
    assert.equal(safeURL(url), null, url);
    assert.throws(() => parseLinks(url), url);
    const state = oneThread();
    state.threads[0].links = [{label: 'Unsafe example', url}];
    assert.throws(() => importBackup(backupWith(state)), url);
  }
  assert.equal(safeURL(PRACTICE), PRACTICE);
  const links = parseLinks(`Worksheet | ${PRACTICE}\n\n http://example.test/reference `);
  assert.deepEqual(parseLinks(linksToText(links)), links);
  assert.throws(() => parseLinks(Array(4).fill(PRACTICE).join('\n')));
  assert.throws(() => parseLinks(`${'x'.repeat(81)} | ${PRACTICE}`));
  assert.throws(() => parseLinks(`https://example.test/${'x'.repeat(1000)}`));
});

test('untrusted text remains text through the model; rendering safety is a separate browser check', () => {
  const text = '<img src=x onerror=alert(1)> & <script>alert(2)</script>';
  const state = oneThread({title: text, context: text});
  const restored = importBackup(exportBackup(state, START));
  assert.equal(restored.threads[0].title, text);
  assert.equal(restored.threads[0].context, text);
});

test('an invalid capture leaves the saved card and editable draft intact', () => {
  const editing = beginDraft(oneThread(), 'study-1');
  editing.draft.fields.next = 'A new next action';
  editing.draft.linksText = 'javascript:alert(1)';
  const before = copy(editing);
  assert.throws(() => capture(frozen(editing), 'unused-id', later(1)));
  assert.deepEqual(editing, before);
  assert.equal(editing.threads[0].next, 'Compare both medians.');
});

test('removing a selected card clears its own draft and selects another existing card', () => {
  const initial = sampleState(PRACTICE, START);
  const editing = frozen(beginDraft(initial, initial.selected));
  const result = removeThread(editing, initial.selected);
  assert.equal(result.draft, null);
  assert.equal(result.threads.length, 1);
  assert.equal(result.selected, result.threads[0].id);
  assert.equal(editing.threads.length, 2);
  assert.deepEqual(removeThread(oneThread(), 'study-1'), emptyState());
});

test('a second tab must reload a newer revision before saving its own copy', () => {
  const storage = memoryStorage();
  const original = oneThread();
  assert.equal(writeRecord(storage, original, null, 'revision-1'), 'revision-1');
  const tabA = readRecord(storage);
  const tabB = readRecord(storage);
  const newer = transition(tabA.state, 'study-1', 'resume', later(1));
  writeRecord(storage, newer, tabA.token, 'revision-2');
  const beforeConflict = storage.getItem(KEY);
  const writesBefore = storage.writes;
  assert.throws(() => writeRecord(storage, tabB.state, tabB.token, 'revision-3'), ConflictError);
  assert.equal(storage.getItem(KEY), beforeConflict);
  assert.equal(storage.writes, writesBefore);
  assert.equal(tabB.state.threads[0].status, 'paused');
  const reloaded = readRecord(storage);
  writeRecord(storage, transition(reloaded.state, 'study-1', 'finish', later(2)), reloaded.token, 'revision-3');
  assert.equal(readRecord(storage).state.threads[0].status, 'completed');
});

test('a stale tab cannot restore an erased copy or erase a newer revision', () => {
  const storage = memoryStorage();
  writeRecord(storage, oneThread(), null, 'revision-1');
  const stale = readRecord(storage);
  eraseRecord(storage, stale.token);
  assert.equal(readRecord(storage), null);
  assert.throws(() => writeRecord(storage, stale.state, stale.token, 'revision-2'), ConflictError);
  assert.equal(storage.getItem(KEY), null);
  writeRecord(storage, oneThread({title: 'New work after erase'}), null, 'revision-3');
  assert.throws(() => eraseRecord(storage, stale.token), ConflictError);
  assert.equal(readRecord(storage).state.threads[0].title, 'New work after erase');
});

test('corrupt copies and invalid writes never silently replace existing browser data', () => {
  for (const raw of ['{', JSON.stringify({version: 7, token: 'revision-1', state: emptyState()})]) {
    const storage = memoryStorage(raw);
    assert.throws(() => readRecord(storage));
    assert.throws(() => writeRecord(storage, oneThread(), null, 'revision-2'));
    assert.throws(() => eraseRecord(storage, null));
    assert.equal(storage.getItem(KEY), raw);
    assert.equal(storage.writes, 0);
    assert.equal(storage.removals, 0);
  }
  const storage = memoryStorage();
  writeRecord(storage, oneThread(), null, 'revision-1');
  const raw = storage.getItem(KEY);
  const invalid = oneThread();
  invalid.selected = 'missing';
  assert.throws(() => writeRecord(storage, invalid, 'revision-1', 'revision-2'));
  assert.throws(() => writeRecord(storage, oneThread(), 'revision-1', 'invalid token'));
  assert.equal(storage.getItem(KEY), raw);
});

test('storage failures propagate without returning a saved revision or changing the input', () => {
  const state = frozen(oneThread());
  const before = copy(state);
  const quotaError = new Error('Synthetic quota failure');
  const storage = {getItem: () => null, setItem: () => { throw quotaError; }};
  assert.throws(() => writeRecord(storage, state, null, 'revision-1'), error => error === quotaError);
  assert.deepEqual(state, before);
  const deniedError = new Error('Synthetic storage access failure');
  assert.throws(() => readRecord({getItem: () => { throw deniedError; }}), error => error === deniedError);
});

test('the synthetic example requires a usable absolute practice URL and validates on import', () => {
  const example = sampleState(PRACTICE, START);
  assert.equal(example.example, true);
  assert.equal(example.threads.length, 2);
  assert.ok(example.threads.some(thread => thread.status === 'blocked' && thread.alternative));
  assert.deepEqual(importBackup(exportBackup(example, START)), example);
  assert.throws(() => sampleState('/practice.html', START));
  assert.throws(() => sampleState('javascript:alert(1)', START));
});

test('export refuses an invalid timestamp rather than producing a backup it cannot import', () => {
  assert.throws(() => exportBackup(oneThread(), 'not-a-date'));
});

function maximumWorkspace(character) {
  const bounded = length => character.repeat(Math.ceil(length / character.length)).slice(0, length);
  const maximumFields = Object.fromEntries(Object.entries(LIMITS).map(([key, limit]) => [key, bounded(limit)]));
  const prefix = 'https://example.org/';
  maximumFields.links = Array.from({length: 3}, () => ({label: bounded(80), url: prefix + bounded(1000 - prefix.length)}));
  const checkpoint = {...maximumFields, at: START, status: 'paused'};
  const threads = Array.from({length: 20}, (_, index) => ({
    id: `thread-${index}`.padEnd(80, 'x'), ...copy(maximumFields), status: 'paused',
    createdAt: START, updatedAt: START, history: Array.from({length: 5}, () => copy(checkpoint)),
  }));
  return validateState({threads, selected: threads[0].id, example: false,
    draft: {id: threads[0].id, fields: copy(maximumFields), linksText: bounded(3500)}});
}

test('maximum workspaces round trip with ASCII, Unicode and worst-case JSON escapes', () => {
  for (const character of ['x', '漢', '🧵', '\ud800']) {
    const state = maximumWorkspace(character);
    const encoded = exportBackup(state, START);
    const bytes = Buffer.byteLength(encoded, 'utf8');
    assert.ok(bytes > 524288, 'Regression must exceed the former import limit');
    assert.ok(bytes <= MAX_BACKUP_BYTES, `${bytes} bytes must fit the shared import limit`);
    assert.deepEqual(importBackup(encoded), state);
  }
});

test('backup limit counts UTF-8 bytes, including the exact accepted boundary', () => {
  const encoded = exportBackup(oneThread(), START);
  const padding = MAX_BACKUP_BYTES - Buffer.byteLength(encoded, 'utf8');
  assert.deepEqual(importBackup(encoded + ' '.repeat(padding)), oneThread());
  assert.throws(() => importBackup(encoded + ' '.repeat(padding + 1)), /4 MiB/);
  const multibyte = '漢'.repeat(Math.floor(MAX_BACKUP_BYTES / 3) + 1);
  assert.ok(multibyte.length < MAX_BACKUP_BYTES);
  assert.throws(() => importBackup(multibyte), /4 MiB/);
});

test('timestamps reject impossible calendar days and normalized times throughout backups', () => {
  for (const timestamp of [
    '2026-02-30T12:00:00.000Z', '2026-02-29T12:00:00.000Z',
    '2026-04-31T12:00:00.000Z', '2026-13-01T12:00:00.000Z',
    '2026-10-18T24:00:00.000Z', '2026-10-18T12:60:00.000Z',
    '2026-10-18T12:00:60.000Z', '2026-10-18T12:00:00',
  ]) {
    assert.throws(() => exportBackup(oneThread(), timestamp), timestamp);
    assert.throws(() => capture(draftState(), 'study-1', timestamp), timestamp);
    assert.throws(() => importBackup(backupWith(oneThread(), {exportedAt: timestamp})), timestamp);
    for (const field of ['createdAt', 'updatedAt']) {
      const state = oneThread(); state.threads[0][field] = timestamp;
      assert.throws(() => importBackup(backupWith(state)), timestamp);
    }
    const history = oneThread();
    history.threads[0].history = [{...fields(), at: timestamp, status: 'paused'}];
    assert.throws(() => importBackup(backupWith(history)), timestamp);
  }
  for (const timestamp of ['2024-02-29T23:59:59.999Z', '2000-02-29T00:00:00Z', '2026-12-31T23:59:59.1Z']) {
    const state = capture(draftState(), 'study-1', timestamp);
    assert.deepEqual(importBackup(exportBackup(state, timestamp)), state);
  }
  assert.throws(() => exportBackup(oneThread(), '1900-02-29T00:00:00.000Z'));
});
