// First-run setup for a real (non-demo) installation: creates the team and its first head coach
// interactively (owner decision 2026-10-25: CLI prompt, not environment variables). Afterwards the
// head coach signs in, enrolls MFA (required for the role) and invites the rest of the staff.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PasswordSchema, EmailSchema, TeamLevelSchema, EnvironmentKindSchema } from '@footballos/contracts';
import { loadConfig, loadEnvFile } from '../config.js';
import { buildContext } from '../bootstrap-context.js';
import { createUser, findUserByEmail } from '../services/users.js';
import { addMembership, createTeam } from '../services/teams.js';
import { isValidTimeZone } from '../services/time.js';

loadEnvFile();
const config = loadConfig();
const { ctx, close } = buildContext({ config });

async function ask(rl: ReturnType<typeof createInterface>, label: string, validate: (v: string) => string | null, hidden = false): Promise<string> {
  for (;;) {
    let value: string;
    if (hidden && stdin.isTTY) {
      // Hide the password echo on a TTY.
      stdout.write(label);
      value = await new Promise<string>((resolve) => {
        let buf = '';
        const onData = (chunk: Buffer) => {
          for (const ch of chunk.toString('utf8')) {
            if (ch === '\n' || ch === '\r') { stdin.setRawMode(false); stdin.removeListener('data', onData); stdout.write('\n'); resolve(buf); return; }
            if (ch === '\u0003') { stdin.setRawMode(false); process.exit(130); }
            if (ch === '\u007f') buf = buf.slice(0, -1); else buf += ch;
          }
        };
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
      });
    } else {
      value = await rl.question(label);
    }
    const problem = validate(value.trim());
    if (!problem) return value.trim();
    console.log(`  ${problem}`);
  }
}

async function main() {
  if (!stdin.isTTY) {
    console.error('bootstrap must run in an interactive terminal (the head coach password is typed, never passed as an argument or environment variable)');
    process.exit(2);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`FootballOS first-run setup (environment: ${config.environment}, data dir: ${config.dataDir})`);
  const teamName = await ask(rl, 'Team name: ', (v) => (v.length ? null : 'required'));
  const shortName = await ask(rl, 'Short name (e.g. WIN): ', (v) => (v.length && v.length <= 32 ? null : 'required, up to 32 characters'));
  const level = await ask(rl, 'Level (high_school | college | other) [high_school]: ', (v) => (v === '' || TeamLevelSchema.safeParse(v).success ? null : 'one of high_school, college, other')) || 'high_school';
  const envKindDefault = config.environment === 'demo' ? 'demo' : config.environment === 'research' ? 'research' : 'production';
  const environmentKind = await ask(rl, `Environment kind (demo | research | production) [${envKindDefault}]: `, (v) => (v === '' || EnvironmentKindSchema.safeParse(v).success ? null : 'one of demo, research, production')) || envKindDefault;
  const timezone = await ask(rl, 'Time zone (IANA, e.g. America/New_York): ', (v) => (isValidTimeZone(v) ? null : 'not a valid IANA time zone'));
  const email = await ask(rl, 'Head coach e-mail: ', (v) => (EmailSchema.safeParse(v).success ? (findUserByEmail(ctx, v) ? 'a user with this e-mail already exists' : null) : 'not a valid e-mail'));
  const displayName = await ask(rl, 'Head coach display name: ', (v) => (v.length ? null : 'required'));
  const password = await ask(rl, 'Head coach password (min 12 characters, not echoed): ', (v) => (PasswordSchema.safeParse(v).success ? null : 'at least 12 characters'), true);
  const confirm = await ask(rl, 'Repeat password: ', (v) => (v === password ? null : 'passwords do not match'), true);
  void confirm;
  rl.close();

  const team = createTeam(ctx, { name: teamName, shortName, level: level as 'high_school' | 'college' | 'other', environmentKind: environmentKind as 'demo' | 'research' | 'production', timezone });
  const user = await createUser(ctx, { email, displayName, password });
  addMembership(ctx, { teamId: team.id, userId: user.id, role: 'head_coach', units: ['offense', 'defense', 'special_teams'], title: 'Head Coach' });
  console.log('');
  console.log(`Created team "${team.name}" (${team.id}) and head coach ${user.email}.`);
  console.log('Next: sign in, enroll MFA under Account (required for head coaches), then invite staff from Team settings.');
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => close());
