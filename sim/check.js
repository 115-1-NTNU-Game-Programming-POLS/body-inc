// Usage: node check.js [n=500] [--param key=value ...]   exit code 1 if any expectation fails.
import { evaluate, print } from './expect.js';

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) || 500);
const params = {};
for (let i = 0; i < args.length; i++) if (args[i] === '--param') {
  const [k, v] = args[++i].split('=');
  params[k] = v === 'true' ? true : v === 'false' ? false : Number(v);
}
const out = evaluate(params, n);
print(out);
process.exitCode = out.res.every((r) => r.pass) ? 0 : 1;
