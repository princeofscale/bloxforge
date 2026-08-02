// Self-contained diagnostics page (no external assets) served at /dashboard.
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BloxForge dashboard</title>
<style>
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #14161c; color: #e6e6ea; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .card { background: #1d2029; border: 1px solid #2a2e3a; border-radius: 8px; padding: 12px 16px; min-width: 160px; }
  .label { font-size: 11px; text-transform: uppercase; color: #8a8f9c; }
  .value { font-size: 18px; margin-top: 4px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .ok { background: #4ade80; } .bad { background: #f87171; }
  button { background: #2a2e3a; color: #e6e6ea; border: 1px solid #3a3f4d; border-radius: 6px; padding: 8px 14px; cursor: pointer; font: inherit; }
  button:hover { background: #343a48; }
  pre { background: #1d2029; border: 1px solid #2a2e3a; border-radius: 8px; padding: 12px; overflow: auto; max-height: 50vh; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>BloxForge dashboard</h1>
<div class="row">
  <div class="card"><div class="label">Studio</div><div class="value" id="conn"><span class="dot bad"></span>—</div></div>
  <div class="card"><div class="label">Places connected</div><div class="value" id="count">—</div></div>
  <div class="card"><div class="label">Server version</div><div class="value" id="ver">—</div></div>
  <div class="card"><div class="label">Pending requests</div><div class="value" id="pending">—</div></div>
</div>
<div class="row">
  <button onclick="refresh()">Reconnect / Refresh</button>
  <button onclick="document.getElementById('ops').textContent=''">Clear logs</button>
  <button onclick="exportDiag()">Export diagnostics</button>
</div>
<div class="label">Recent operations</div>
<pre id="ops">loading…</pre>
<script>
let last = {};
async function refresh() {
  try {
    const r = await fetch('/dashboard/data');
    const d = await r.json();
    last = d;
    document.getElementById('conn').innerHTML = '<span class="dot ' + (d.pluginConnected ? 'ok' : 'bad') + '"></span>' + (d.pluginConnected ? 'Connected' : 'Disconnected');
    document.getElementById('count').textContent = d.instanceCount;
    document.getElementById('ver').textContent = d.serverVersion || '—';
    document.getElementById('pending').textContent = d.pendingRequests;
    document.getElementById('ops').textContent = d.operations || 'none';
  } catch (e) {
    document.getElementById('ops').textContent = 'Failed to reach server: ' + e;
  }
}
function exportDiag() {
  const blob = new Blob([JSON.stringify(last, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bloxforge-diagnostics.json';
  a.click();
}
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
