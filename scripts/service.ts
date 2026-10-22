// Runs Reader as a systemd user service in WSL, so it is up whenever WSL is, with no terminal open.
// pnpm service on | off | start | stop | restart | status
// on and off install and remove the service, so it starts with WSL or never. start and stop run or halt it now;
// it still starts with WSL next time. restart is stop, then start.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

const NAME = 'reader';
const root = join(import.meta.dirname, '..');
const unitFile = join(homedir(), '.config/systemd/user', `${NAME}.service`);
const port = Number(process.env.PORT) || 4400;

const systemctl = (...args: string[]) => execFileSync('systemctl', ['--user', ...args], { stdio: 'inherit' });

// Is anything listening on the port: a `pnpm start` in a terminal would block the service.
const portTaken = () => {
  try { execSync(`ss -ltnH 'sport = :${port}' | grep -q .`); return true; } catch { return false; }
};

function on() {
  if (portTaken() && !existsSync(unitFile)) {
    console.error(`Port ${port} is in use. Stop the running \`pnpm start\` (Ctrl+C in its terminal), then run this again.`);
    process.exit(1);
  }
  // Node and pnpm come from nvm, which a service doesn't load: pin the paths this shell has.
  const pnpm = execSync('command -v pnpm', { encoding: 'utf8' }).trim();
  mkdirSync(dirname(unitFile), { recursive: true });
  writeFileSync(unitFile, `[Unit]
Description=Reader, the read-aloud app (http://localhost:${port})

[Service]
WorkingDirectory=${root}
Environment=PATH=${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin
Environment=PORT=${port}
ExecStart=${pnpm} start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`);
  // Linger starts user services when WSL boots, without waiting for a terminal to log in.
  // Named explicitly: without a user, loginctl looks for a login session, and scripts run by pnpm have none.
  execFileSync('loginctl', ['enable-linger', userInfo().username], { stdio: 'inherit' });
  systemctl('daemon-reload');
  systemctl('enable', '--now', NAME);
  console.log(`Reader runs in the background at http://localhost:${port}. Logs: journalctl --user -u ${NAME} -f`);
}

function off() {
  if (existsSync(unitFile)) {
    systemctl('disable', '--now', NAME);
    rmSync(unitFile);
    systemctl('daemon-reload');
  }
  console.log('Reader no longer runs in the background. `pnpm start` runs it in a terminal.');
}

// start and stop need the service installed first.
const installed = () => {
  if (existsSync(unitFile)) return true;
  console.error('Reader is not set up as a service. Run `pnpm service on` first.');
  process.exit(1);
};

function start() {
  installed();
  systemctl('start', NAME);
  console.log(`Reader runs at http://localhost:${port}.`);
}

function stop() {
  installed();
  systemctl('stop', NAME);
  console.log('Reader is stopped. `pnpm service start` runs it again; WSL starting up also does.');
}

const action = process.argv[2];
if (action === 'on') on();
else if (action === 'off') off();
else if (action === 'start') start();
else if (action === 'stop') stop();
else if (action === 'restart') { stop(); start(); }
else if (action === 'status') { try { systemctl('status', '--no-pager', NAME); } catch { /* status exits non-zero when stopped */ } }
else { console.error('Usage: pnpm service on | off | start | stop | restart | status'); process.exit(1); }
