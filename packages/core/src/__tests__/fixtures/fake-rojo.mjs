import fs from 'node:fs';
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
  if (process.env.FAKE_ROJO_SILENT !== '1') {
    process.stdout.write('Rojo server listening on 127.0.0.1:34872\n');
  }
  const timer = setInterval(() => {}, 1000);
  const stop = () => {
    clearInterval(timer);
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
