import { test } from 'node:test';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

function load(file, overrides = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(source, { module: compiledModule, exports: compiledModule.exports, process, console,
    require: (name) => name in overrides ? overrides[name] : nativeRequire(name),
  }, { filename: file });
  return compiledModule.exports;
}
const history = load('lib/journal-history.ts');

test('history pages past database row caps, explicitly scoped to one user', async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => ({ entry_date: String(i).padStart(6, '0') }));
  let calls = 0;
  const client = { from(table) {
    assert.equal(table, 'entries');
    let after = '';
    const query = {
      select(fields) { assert.ok(!fields.includes('ai_acknowledgment')); return this; },
      eq(field, id) { assert.equal(field, 'user_id'); assert.equal(id, 'owner'); return this; },
      order() { return this; }, limit() { return this; },
      gt(field, value) { assert.equal(field, 'entry_date'); after = value; return this; },
      then(resolve) { calls++; resolve({ data: rows.filter(r => r.entry_date > after).slice(0, 300), error: null }); },
    };
    return query;
  } };
  const result = await history.loadJournalHistory(client, 'owner');
  assert.equal(result.length, 1201);
  assert.equal(calls, 6);
});

test('failed history fetch rejects instead of returning partial history', async () => {
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    then(resolve) { resolve({ data: null, error: { message: 'unavailable' } }); } };
  await assert.rejects(history.loadJournalHistory({ from: () => query }, 'owner'), /complete journal history/);
});

test('splitting review material preserves every character', () => {
  const text = '🌿 long journal '.repeat(10000);
  assert.equal(history.splitReviewInput(text).join(''), text);
});

function generator(status = 'completed') {
  const calls = [];
  class FakeOpenAI {
    responses = { create: async (request) => {
      calls.push(request);
      return { status, output_text: 'Dated review notes.', incomplete_details: null };
    } };
  }
  process.env.OPENAI_API_KEY = 'test-only';
  const ai = load('lib/openai.ts', { 'server-only': {}, openai: { default: FakeOpenAI }, './journal-history': history, './partner-validation': load('lib/partner-validation.ts') });
  return { ai, calls };
}
const entry = (date, text) => ({ entry_date: date, mood_score: 6, mood_label: 'Okay', mood_tags: ['custom tag'], prompt_question: 'Original question?', prompt_answer: 'My answer', highlight: 'Highlight', challenge: 'Challenge', gratitude: 'Gratitude', free_write: text });

test('all report types receive historical entries and every journal field', async () => {
  for (const kind of ['Weekly', 'Monthly', 'Therapist']) {
    const { ai, calls } = generator();
    const rows = [entry('2020-01-01', 'Old evidence'), entry('2026-10-01', 'Current evidence')];
    const args = kind === 'Therapist' ? [[rows[1]], 'Name', 'October', 'owner', rows, '2026-10-01', '2026-10-31'] : [[rows[1]], 'Name', 'owner', rows, '2026-10-01', '2026-10-31'];
    await ai[`generate${kind}Summary`](...args);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].input.includes(JSON.stringify({ ...rows[0], in_focus_period: false })));
    assert.ok(calls[0].input.includes(JSON.stringify({ ...rows[1], in_focus_period: true })));
    assert.equal(calls[0].store, false);
  }
});

test('large history is fully reviewed before final synthesis', async () => {
  const { ai, calls } = generator();
  const rows = Array.from({ length: 12 }, (_, i) => entry(`2026-10-${String(i + 1).padStart(2, '0')}`, `entry-${i} ` + 'x'.repeat(20000)));
  await ai.generateMonthlySummary(rows, 'Name', 'owner', rows, '2026-10-01', '2026-10-31');
  const reviewed = calls.slice(0, -1).map(c => c.input).join('');
  assert.equal(reviewed, rows.map(r => JSON.stringify({ ...r, in_focus_period: true })).join('\n'));
  assert.ok(calls.at(-1).input.includes('complete multi-stage review'));
});

test('incomplete model output is not accepted as a report', async () => {
  const { ai } = generator('incomplete');
  await assert.rejects(ai.generateWeeklySummary([entry('2026-10-01', 'text')], 'Name', 'owner'), /incomplete or empty text output/);
});
