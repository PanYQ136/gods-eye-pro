import handler from './api/[...path].js';

function makeRes() {
  const chunks = [];
  const res = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    writeHead(s, h) {
      this.statusCode = s;
      this.headersSent = true;
      if (h) Object.assign(this.headers, h);
    },
    write(c) {
      this.headersSent = true;
      chunks.push(Buffer.from(c));
    },
    end(c) {
      if (c) chunks.push(Buffer.from(c));
      this.headersSent = true;
      this.body = Buffer.concat(chunks).toString('utf8');
      this.done = true;
    },
  };
  return res;
}

async function call(url) {
  const req = { url, method: 'GET', headers: {} };
  const res = makeRes();
  const t = setTimeout(() => {
    res.statusCode = 504;
    res.body = '(timeout — likely needs network/key)';
    res.done = true;
  }, 12000);
  try {
    await handler(req, res);
  } catch (e) {
    console.log(url, 'THREW:', e?.message || e);
    clearTimeout(t);
    return;
  }
  clearTimeout(t);
  console.log(url, '->', res.statusCode, '|', (res.body || '').slice(0, 160).replace(/\s+/g, ' '));
}

for (const u of [
  '/api/firms/status',
  '/api/setup/status',
  '/api/nonexistent-route',
  '/api/opensky',
]) {
  await call(u);
}
