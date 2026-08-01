import fs from 'node:fs';
import http from 'node:http';
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
  // Readiness is a real `/api/rojo` handshake, so a fake that only prints — or
  // only accepts TCP — proves nothing. FAKE_ROJO_SILENT never listens at all,
  // and FAKE_ROJO_NOT_ROJO listens but answers like some other server, which is
  // the port-stolen-between-check-and-bind case.
  const server = process.env.FAKE_ROJO_SILENT === '1' ? undefined : http.createServer((req, res) => {
    if (req.url !== '/api/rojo' || process.env.FAKE_ROJO_NOT_ROJO === '1') {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      sessionId: 'fake-session',
      serverVersion: process.env.FAKE_ROJO_SERVER_VERSION || '7.7.0',
      protocolVersion: 4,
      projectName: 'Game',
    }));
  });
  const timer = setInterval(() => {}, 1000);
  server?.listen(port, address, () => {
    process.stdout.write(`Rojo server listening on ${address}:${port}\n`);
    // Stands in for the managed child losing the port race: a Rojo answers the
    // handshake, but *this* process dies of EADDRINUSE right after. Only the
    // settle window tells the two apart.
    const exitAfter = Number(process.env.FAKE_ROJO_EXIT_AFTER_MS || 0);
    if (exitAfter > 0) setTimeout(() => process.exit(3), exitAfter);
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
