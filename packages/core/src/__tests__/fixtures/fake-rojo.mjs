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
} else if (command === 'sourcemap' || command === 'build' || command === 'syncback') {
  process.stdout.write(JSON.stringify({ command, args: args.slice(1) }));
} else {
  process.stderr.write(`unknown fake command: ${command}\n`);
  process.exit(1);
}
