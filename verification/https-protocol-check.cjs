// Read-only checks against the deployed gateway. Never sends SMS or reads private data.
const https = require('node:https');
const http2 = require('node:http2');
const assert = require('node:assert/strict');
const origin = process.argv[2] || 'https://sms.example.com:8443';
const authority = new URL(origin).host;
function http1() {
  return new Promise((resolve, reject) => {
    const req = https.get(origin, res => {
      res.resume(); res.on('end', () => { try { assert.equal(res.statusCode, 200); resolve(); } catch(e) { reject(e); } });
    });
    req.setTimeout(15000, () => req.destroy(Error('HTTP/1.1 timeout'))); req.on('error', reject);
  });
}
async function main() {
  await http1(); console.log('PASS HTTP/1.1 trusted TLS');
  const client = http2.connect(origin);
  client.setTimeout(15000, () => client.destroy(Error('HTTP/2 timeout')));
  try {
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
    assert.equal(client.alpnProtocol, 'h2');
    async function request(path, expected, headers = {}) {
      return new Promise((resolve, reject) => {
        const req = client.request({ ':path': path, ...headers });
        let status, body = '';
        req.on('response', h => status = h[':status']);
        req.on('data', b => body += b);
        req.on('error', reject);
        req.on('end', () => { try { assert.equal(status, expected, path); resolve(body); } catch(e) { reject(e); } });
        req.end();
      });
    }
    const html = await request('/', 200);
    for (const [, path] of html.matchAll(/(?:src|href)="(\/[^\"]+)"/g)) await request(path, 200);
    await request('/api/status', 401);
    await request('/', 403, { ':authority': 'wrong.invalid:8443' });
    await request('/', 403, { ':authority': authority, host: 'wrong.invalid:8443' });
    await request('/api/pair', 403, { ':method': 'POST', origin: 'https://wrong.invalid' });
    console.log('PASS HTTP/2 page and assets; unauthorized API, wrong authority, conflicting Host, cross-origin POST rejected');
  } finally { client.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
