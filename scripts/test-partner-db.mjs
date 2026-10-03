import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';

// An isolated ephemeral PostgreSQL container; never connects to Hearth's database.
const name = `hearth-partner-test-${process.pid}`;
const run = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', ...options });
try {
  run(['run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD=local-fixture-only', 'postgres:17-alpine']);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { run(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' }); ready = true; break; } catch { await setTimeout(300); }
  }
  if (!ready) throw new Error('Test PostgreSQL did not start');
  for (const file of ['tests/partner-db-fixture.sql', 'supabase/migrations/001_initial.sql', 'tests/partner-db-base.sql', 'supabase/migrations/018_partner_connections.sql', 'tests/partner-db-assertions.sql']) {
    const output = run(['exec', '-i', name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input: readFileSync(file, 'utf8') });
    if (file.includes('assertions')) console.log(output.trim().split('\n').slice(-4).join('\n'));
  }
  // Two simultaneous accepts for the same recipient must yield one partner.
  const sqlArgs = ['exec','-i',name,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres'];
  const invite = (caller) => run(sqlArgs, { input: `SET ROLE authenticated; SET request.jwt.claim.sub='${caller}'; SELECT public.invite_partner('c@example.test')->>'id';` }).trim();
  const first = invite('11111111-1111-4111-8111-111111111111');
  const second = invite('22222222-2222-4222-8222-222222222222');
  const execute = promisify(execFile);
  await Promise.all([first,second].map(id => execute('docker', [...sqlArgs,'-c',
    `SET ROLE authenticated; SET request.jwt.claim.sub='33333333-3333-4333-8333-333333333333'; DO $$ BEGIN PERFORM public.respond_partner_invitation('${id}',true); EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;`] )));
  run(sqlArgs, { input: "SELECT public.test_assert((SELECT count(*) = 1 FROM public.partner_connections WHERE status='accepted' AND '33333333-3333-4333-8333-333333333333'::uuid IN (inviter_id,recipient_id)), 'concurrent acceptance permits only one partner');" });
  console.log('Concurrent acceptance test passed');
} catch (error) {
  console.error(error.stderr?.trim() || error.message);
  process.exitCode = 1;
} finally {
  run(['rm', '-f', name], { stdio: 'ignore' });
}
