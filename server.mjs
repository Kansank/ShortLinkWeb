import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');
const dataFile = join(root, 'data', 'links.json');
const port = Number(process.env.PORT || 3000);
let linkWriteQueue = Promise.resolve();

async function getLinks() {
  try {
    const links = JSON.parse(await readFile(dataFile, 'utf8'));
    if (!Array.isArray(links)) throw new Error('ไฟล์ข้อมูลต้องเป็นรายการลิงก์');
    return links;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`ไม่สามารถอ่านไฟล์ links.json ได้: ${error.message}`);
  }
}

async function saveLinks(links) {
  await mkdir(dirname(dataFile), { recursive: true });
  const tempFile = `${dataFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tempFile, JSON.stringify(links, null, 2) + '\n');
  await rename(tempFile, dataFile);
}

// All mutations go through one queue so requests cannot overwrite each other's changes.
function updateLinks(change) {
  const task = linkWriteQueue.then(async () => {
    const links = await getLinks();
    const result = await change(links);
    await saveLinks(links);
    return result;
  });
  linkWriteQueue = task.catch(() => {});
  return task;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 100_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('ข้อมูลไม่ถูกต้อง')); } });
    req.on('error', reject);
  });
}

function validUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol); }
  catch { return false; }
}

function safeCode(value) {
  return /^[a-zA-Z0-9_-]{3,32}$/.test(value || '');
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/links') return send(res, 200, JSON.stringify(await getLinks()));

    if (req.method === 'POST' && url.pathname === '/api/links') {
      const input = await readBody(req);
      if (!validUrl(input.url)) return send(res, 400, JSON.stringify({ error: 'กรุณาใส่ URL ที่ขึ้นต้นด้วย http:// หรือ https://' }));
      const requestedCode = (input.code || '').trim();
      if (requestedCode && !safeCode(requestedCode)) return send(res, 400, JSON.stringify({ error: 'รหัสใช้ได้เฉพาะ a-z, 0-9, - และ _ ความยาว 3–32 ตัว' }));
      const link = await updateLinks(links => {
        let code = requestedCode;
        const codeExists = candidate => links.some(item => item.code.toLowerCase() === candidate.toLowerCase());
        if (code && codeExists(code)) {
          const error = new Error('รหัสนี้ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น');
          error.status = 409;
          throw error;
        }
        while (!code) {
          const candidate = randomBytes(4).toString('base64url').slice(0, 6);
          if (!codeExists(candidate)) code = candidate;
        }
        const created = { code, url: input.url.trim(), title: (input.title || '').trim(), clicks: 0, createdAt: new Date().toISOString() };
        links.unshift(created);
        return created;
      });
      return send(res, 201, JSON.stringify(link));
    }

    const deleteMatch = url.pathname.match(/^\/api\/links\/([a-zA-Z0-9_-]+)$/);
    if (req.method === 'DELETE' && deleteMatch) {
      const deleted = await updateLinks(links => {
        const index = links.findIndex(link => link.code.toLowerCase() === deleteMatch[1].toLowerCase());
        if (index === -1) return false;
        links.splice(index, 1);
        return true;
      });
      if (!deleted) return send(res, 404, JSON.stringify({ error: 'ไม่พบลิงก์' }));
      return send(res, 204, '');
    }

    const code = url.pathname.slice(1);
    if (req.method === 'GET' && code && !code.includes('/') && safeCode(code)) {
      const links = await getLinks(); const link = links.find(item => item.code.toLowerCase() === code.toLowerCase());
      if (link) {
        const destination = await updateLinks(items => {
          const current = items.find(item => item.code.toLowerCase() === code.toLowerCase());
          if (!current) return null;
          current.clicks += 1;
          return current.url;
        });
        if (destination) { res.writeHead(302, { location: destination, 'cache-control': 'no-store' }); return res.end(); }
      }
    }

    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const target = normalize(join(publicDir, requested));
    if (!target.startsWith(publicDir)) return send(res, 403, 'Forbidden', 'text/plain');
    const content = await readFile(target);
    return send(res, 200, content, mime[extname(target)] || 'application/octet-stream');
  } catch (error) {
    if (error.code === 'ENOENT') return send(res, 404, 'Not found', 'text/plain');
    if (error.status) return send(res, error.status, JSON.stringify({ error: error.message }));
    console.error(error); return send(res, 500, JSON.stringify({ error: error.message || 'เกิดข้อผิดพลาด' }));
  }
});

server.listen(port, () => console.log(`Short link app: http://localhost:${port}`));
