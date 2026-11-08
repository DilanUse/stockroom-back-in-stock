import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Fetch the client's public simulator at a fixed revision. It stays outside our Git repository.
const revision = 'f997f1da5030476fc15ecf582a8614f1bd3a684f';
const expected = 'ceb8feb2280f4f599692bbf79d3c04c5487e5fcab904ae615b6a1ec9163384fe';
const response = await fetch(`https://raw.githubusercontent.com/yitzi-farla/back-in-stock-challenge/${revision}/harness/server.js`);
if (!response.ok) throw new Error(`Simulator download failed (${response.status}).`);
const source = (await response.text()).replaceAll('\r\n', '\n');
if (createHash('sha256').update(source).digest('hex') !== expected) throw new Error('Simulator checksum mismatch.');
const binding = '}).listen(PORT, () =>';
if (!source.includes(binding)) throw new Error('Simulator bind statement changed.');
await mkdir(new URL('../.harness/', import.meta.url), { recursive: true });
await writeFile(new URL('../.harness/server.cjs', import.meta.url), source.replace(binding, "}).listen(PORT, '127.0.0.1', () =>"));
console.log(`Prepared official simulator ${revision} on loopback only.`);
