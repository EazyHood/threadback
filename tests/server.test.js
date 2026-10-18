import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
let server;
let port;

before(async () => {
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {...process.env, PORT: '0'},
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  port = await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timer = setTimeout(() => {
      server.kill();
      reject(new Error(`Server did not become ready. ${errors}`));
    }, 8000);
    server.stderr.on('data', chunk => { errors += chunk; });
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Threadback: http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => {
      clearTimeout(timer);
      if (port === undefined) reject(new Error(`Server exited before readiness (${code}). ${errors}`));
    });
  });
});

after(async () => {
  if (!server || server.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 3000);
    server.once('exit', () => { clearTimeout(timer); resolve(); });
    server.kill();
  });
});

function get(rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({hostname: '127.0.0.1', port, path: rawPath, method}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8')}));
      response.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('HTTP test timed out')));
    req.on('error', reject);
    req.end();
  });
}

test('the development server uses an ephemeral port and serves the actual homepage', async () => {
  assert.ok(Number.isInteger(port) && port > 0);
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.body, await readFile(path.join(root, 'dist', 'index.html'), 'utf8'));
});

test('ES modules are served intact with a JavaScript type, including requests with a query', async () => {
  const response = await get('/model.js?test=1');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/javascript/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body, await readFile(path.join(root, 'dist', 'model.js'), 'utf8'));
});

test('HEAD sends the same content type without a response body', async () => {
  const response = await get('/model.js', 'HEAD');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/javascript/);
  assert.equal(response.body, '');
});

test('write methods cannot turn the static server into a mutation endpoint', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const response = await get('/model.js', method);
    assert.equal(response.status, 405, method);
  }
});

test('missing files, invalid URL encoding and attempts to leave dist are rejected', async () => {
  assert.equal((await get('/missing-threadback-test-file.json')).status, 404);
  assert.equal((await get('/%zz')).status, 400);
  const traversals = ['/%2e%2e%2fpackage.json', '/%2e%2e%2f%2e%2e%2fLEEME.md'];
  if (process.platform === 'win32') traversals.push('/%2e%2e%5cpackage.json');
  for (const traversal of traversals) {
    const response = await get(traversal);
    assert.equal(response.status, 403, traversal);
    assert.doesNotMatch(response.body, /"scripts"|Qué es:/);
  }
});
