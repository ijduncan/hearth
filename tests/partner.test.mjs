import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const nativeRequire = createRequire(import.meta.url);

function load(file, overrides = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(source, { module: compiledModule, exports: compiledModule.exports,
    process, console, URL, AbortSignal, TextDecoder, Uint8Array, fetch, ...globals,
    require: name => name in overrides ? overrides[name] : nativeRequire(name),
  }, { filename: file });
  return compiledModule.exports;
}
const validation = load('lib/partner-validation.ts');
const security = load('lib/security.ts');
const owner = '11111111-1111-4111-8111-111111111111';
const entryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const connectionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const parseJsonObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const request = (body, origin = 'https://hearth.example') => new Request('https://hearth.example/api/partner', {
  method: 'POST', headers: { 'Origin': origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

function route(db, emailSender = async () => 'sent') {
  return load('app/api/partner/route.ts', {
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/security': security,
    '@/lib/validation': { parseJsonObject },
    '@/lib/partner-validation': validation,
    '@/lib/partner-email': { sendPartnerInvitation: emailSender },
  });
}

test('glimpses reject overlong, multiline, empty and multiple-sentence text', () => {
  assert.equal(validation.validateGlimpse(' A quiet day. '), 'A quiet day.');
  for (const text of ['', 'one '.repeat(16), 'Line one\nLine two', 'Sentence one. Sentence two', 'Question? Answer.', 'x'.repeat(241)]) {
    assert.equal(validation.validateGlimpse(text), null);
  }
});

test('partner API rejects cross-origin and unauthenticated mutations', async () => {
  let authCalls = 0;
  const db = { auth: { getUser: async () => { authCalls++; return { data: { user: null } }; } } };
  const api = route(db);
  assert.equal((await api.POST(request({ action: 'invite', email: 'b@example.test' }, 'https://evil.example'))).status, 403);
  assert.equal(authCalls, 0);
  assert.equal((await api.POST(request({ action: 'invite', email: 'b@example.test' }))).status, 401);
});

test('share API validates before calling the database', async () => {
  let rpcCalls = 0;
  const db = { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, rpc: async () => { rpcCalls++; return { error: null }; } };
  const api = route(db);
  assert.equal((await api.POST(request({ action: 'share', id: connectionId, entryId, text: 'one '.repeat(16) }))).status, 400);
  assert.equal(rpcCalls, 0);
  assert.equal((await api.POST(request({ action: 'share', id: connectionId, entryId, text: 'A calm day.' }))).status, 200);
  assert.equal(rpcCalls, 1);
});

test('ineligible invitation targets never trigger emails', async () => {
  let emails = 0;
  const db = { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, rpc: async () => ({ data: null, error: null }) };
  const api = route(db, async () => { emails++; return 'sent'; });
  assert.equal((await api.POST(request({ action: 'invite', email: 'unknown@example.test' }))).status, 200);
  assert.equal(emails, 0);
});

test('draft API reads only the authenticated author and never publishes', async () => {
  const calls = [];
  const source = { entry_date: '2026-10-03', free_write: 'private' };
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
    rpc: async name => { calls.push(['rpc', name]); return { data: { connection: { id: connectionId } }, error: null }; },
    from(table) {
      const query = {
        select() { return this; },
        eq(field, value) { calls.push([table, field, value]); return this; },
        single: async () => ({ data: table === 'profiles' ? { ai_enabled: true } : source, error: null }),
      }; return query;
    },
  };
  const api = load('app/api/partner/glimpse/route.ts', {
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/security': { ...security, checkRateLimit: async () => ({ allowed: true }) },
    '@/lib/validation': { parseJsonObject }, '@/lib/partner-validation': validation,
    '@/lib/openai': { isOpenAIConfigured: () => true, generatePartnerGlimpse: async () => 'Today felt calm, with space to rest and enjoy small moments.' },
  });
  const response = await api.POST(request({ entryId }));
  assert.equal(response.status, 200);
  assert.ok(calls.some(c => c[0] === 'entries' && c[1] === 'user_id' && c[2] === owner));
  assert.ok(calls.some(c => c[0] === 'entries' && c[1] === 'id' && c[2] === entryId));
  assert.deepEqual(calls.filter(c => c[0] === 'rpc'), [['rpc', 'get_partner_state']]);
});

test('invitation email uses a fixed sender, app URL and idempotency without journal content', async () => {
  let sent;
  const api = load('lib/partner-email.ts', { 'server-only': {} }, {
    process: { env: { RESEND_API_KEY: 'test-only', HEARTH_EMAIL_FROM: 'Hearth <hello@example.test>', HEARTH_APP_URL: 'https://hearth.example' } },
    fetch: async (url, options) => { sent = { url, options }; return { ok: true }; },
  });
  assert.equal(await api.sendPartnerInvitation('b@example.test', connectionId), 'sent');
  assert.equal(sent.url, 'https://api.resend.com/emails');
  const body = JSON.parse(sent.options.body);
  assert.deepEqual(body.to, ['b@example.test']);
  assert.ok(body.text.includes('https://hearth.example/partner'));
  assert.equal(sent.options.headers['Idempotency-Key'], `hearth-partner-${connectionId}`);
  assert.equal(Object.keys(body).sort().join(','), 'from,subject,text,to');
});
