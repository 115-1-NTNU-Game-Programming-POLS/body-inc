// Cold start measurement (docs/perf/cold-start.md, issue #15).
//
//   chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<empty dir>
//   node tools/perf/cold-start.mjs <url> [--runs 5] [--throttle] [--port 9333] [--block <pattern>]...
//
// Each run opens a fresh tab with the cache disabled and the site's storage cleared (a saved host
// name would load extra font slices), optionally throttled to 10 Mbps down with 20 ms latency,
// and waits for the 'title-ready' mark that TitleScene sets on the first frame drawn with the
// title. It reports the mark's time from navigation start, and the requests and bytes
// (encodedDataLength, headers included) that finished by then.
const args = process.argv.slice(2);
const url = args[0];
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const runs = Number(opt('--runs', 5));
const port = opt('--port', '9333');
const throttle = args.includes('--throttle');
const blocked = args.flatMap((a, i) => (a === '--block' ? [args[i + 1]] : []));
if (!url) {
  console.log('usage: node tools/perf/cold-start.mjs <url> [--runs 5] [--throttle] [--port 9333] [--block <pattern>]...');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CATEGORIES = [
  [/fonts\.gstatic\.com/, 'font woff2 (Google)'], [/fonts\.googleapis\.com/, 'font CSS (Google)'], [/\.woff2/, 'font woff2'], [/fonts.*\.css/, 'font CSS'],
  [/\.js(\?|$)/, 'JavaScript'], [/portraits\//, 'portraits'], [/atlases\/.*\.png/, 'atlas PNG'], [/atlases\/.*\.json/, 'atlas JSON'],
  [/maps\//, 'maps'], [/tilesets\//, 'tilesets'], [/\/(index\.html)?(\?|$)/, 'HTML'],
];
const category = (u) => CATEGORIES.find(([re]) => re.test(u))?.[1] ?? 'other';

async function coldLoad() {
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const reqs = new Map();
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    const p = msg.params;
    if (msg.method === 'Network.requestWillBeSent') reqs.set(p.requestId, { url: p.request.url, start: p.timestamp });
    if (msg.method === 'Network.loadingFinished' && reqs.has(p.requestId)) Object.assign(reqs.get(p.requestId), { end: p.timestamp, bytes: p.encodedDataLength });
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.result?.value;

  await send('Network.enable');
  await send('Runtime.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Storage.clearDataForOrigin', { origin: new URL(url).origin, storageTypes: 'all' });
  if (blocked.length) await send('Network.setBlockedURLs', { urls: blocked });
  if (throttle) await send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 10e6 / 8, uploadThroughput: 10e6 / 8 });
  await send('Page.navigate', { url });
  let title;
  for (let i = 0; i < 300 && title === undefined; i++) {
    await sleep(100);
    title = await evaluate(`performance.getEntriesByName('title-ready')[0]?.startTime`);
  }
  await sleep(300);
  await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
  if (title === undefined) return { title: undefined, requests: 0, bytes: 0, byCategory: {} };
  // CDP timestamps are in seconds; the document request is the first one of the navigation.
  const t0 = Math.min(...[...reqs.values()].map((r) => r.start));
  const done = [...reqs.values()].filter((r) => /^https?:/.test(r.url) && r.end !== undefined && r.end - t0 <= title / 1000 + 0.05);
  const byCategory = {};
  for (const r of done) {
    const c = (byCategory[category(r.url)] ??= { requests: 0, bytes: 0 });
    c.requests++;
    c.bytes += r.bytes;
  }
  return { title, requests: done.length, bytes: done.reduce((a, r) => a + r.bytes, 0), byCategory };
}

const results = [];
for (let i = 0; i < runs; i++) {
  const r = await coldLoad();
  results.push(r);
  console.log(r.title === undefined ? 'title never appeared (30 s)' : `title ${r.title.toFixed(0)} ms | ${r.requests} requests | ${(r.bytes / 1000).toFixed(1)} kB`);
}
const shown = results.filter((r) => r.title !== undefined);
if (shown.length > 0) {
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`median: title ${median(shown.map((r) => r.title)).toFixed(0)} ms, ${(median(shown.map((r) => r.bytes)) / 1000).toFixed(1)} kB`);
  for (const [c, v] of Object.entries(shown.at(-1).byCategory)) console.log(`  ${c.padEnd(20)} ${String(v.requests).padStart(3)} requests ${(v.bytes / 1000).toFixed(1).padStart(8)} kB`);
}
process.exit(shown.length === results.length ? 0 : 1);
