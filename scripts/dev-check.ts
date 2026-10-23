// Runs before `pnpm dev`: the dev server and the service use the same ports and the same data/, so only one runs at a time.
import { connect } from 'node:net';

const taken = (port: number) =>
  new Promise<boolean>(resolve => {
    const socket = connect({ port, host: 'localhost' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });

const port = Number(process.env.PORT) || 4400;
if (await taken(port) || await taken(8882)) {
  console.error(`Reader or HeadTTS is already running (port ${port} or 8882). Stop it first: \`pnpm service stop\`, or Ctrl+C in the terminal running \`pnpm start\`. When you finish, \`pnpm service start\` brings the service back.`);
  process.exit(1);
}
