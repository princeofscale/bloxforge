import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

if (command === '--version') {
  process.stdout.write(process.env.FAKE_ROJO_VERSION || 'Rojo 7.7.0\n');
} else if (command === 'serve') {
  if (process.env.FAKE_ROJO_CRASH === '1') {
    process.stderr.write('fake crash\n');
    process.exit(2);
  }
  const flag = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const address = flag('--address', '127.0.0.1');
  const port = Number(flag('--port', '34872'));
  // Readiness is now a TCP probe, so a fake that only prints proves nothing.
  // FAKE_ROJO_SILENT means "never accepts connections", which is the timeout case.
  const server = process.env.FAKE_ROJO_SILENT === '1' ? undefined : net.createServer();
  const timer = setInterval(() => {}, 1000);
  server?.listen(port, address, () => {
    process.stdout.write(`Rojo server listening on ${address}:${port}\n`);
  });
  const stop = () => {
    clearInterval(timer);
    server?.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else if (command === 'syncback' && process.env.FAKE_ROJO_SYNCBACK_FAIL === '1' && !args.includes('--dry-run')) {
  const sourceDir = path.join(process.cwd(), 'src');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'existing.lua'), 'mutated');
  fs.writeFileSync(path.join(sourceDir, 'created.lua'), 'created');
  process.stderr.write('fake syncback failure\n');
  process.exit(2);
} else if (command === 'sourcemap' || command === 'build' || command === 'syncback') {
  process.stdout.write(JSON.stringify({ command, args: args.slice(1) }));
} else {
  process.stderr.write(`unknown fake command: ${command}\n`);
  process.exit(1);
}
