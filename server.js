const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const zlib = require('zlib');

const rootDir = __dirname;
const port = process.env.PORT || 3000;
const dataPath = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(rootDir, 'data.json');
const uploadDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(rootDir, 'images');
const publicUploadPrefix = process.env.PUBLIC_UPLOAD_PREFIX || 'images';

fs.mkdirSync(path.dirname(dataPath), { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

// ⚡ CACHING: In-memory data cache with automatic invalidation
let dataCache = null;
let dataCacheTime = 0;
const CACHE_TTL = 5000; // Cache for 5 seconds

fs.watchFile(dataPath, () => {
  dataCache = null; // Invalidate cache when file changes
});

function readData() {
  const now = Date.now();
  if (dataCache && (now - dataCacheTime) < CACHE_TTL) {
    return dataCache;
  }
  
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  dataCache = data;
  dataCacheTime = now;
  return data;
}

async function autoCommitToGit() {
  try {
    // Only commit if in a git repo
    execSync('git rev-parse --git-dir', { cwd: rootDir, stdio: 'pipe' });
    
    const timestamp = new Date().toISOString();
    execSync('git add data.json', { cwd: rootDir });
    execSync(`git commit -m "Auto-backup: portfolio data updated ${timestamp}"`, { cwd: rootDir });
    
    // Try to push, but don't fail if push fails (may not have git credentials)
    try {
      execSync('git push origin main', { cwd: rootDir, timeout: 10000 });
      console.log('✅ Auto-backup: changes pushed to GitHub');
    } catch (pushErr) {
      console.log('ℹ️  Auto-backup: changes committed locally (push skipped)');
    }
  } catch (err) {
    // Silently ignore if not in a git repo or git is not available
    // This is normal on hosting platforms without git
  }
}

function writeData(payload) {
  fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2));
  dataCache = null; // Invalidate cache immediately on write
  
  // Auto-commit in background (don't block the response)
  setImmediate(() => autoCommitToGit());
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sanitizeFileName(name) {
  return (name || 'upload')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'upload';
}

function respondWithBuffer(req, res, statusCode, buffer, headers = {}) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const shouldCompress = buffer.length > 1024 && (acceptEncoding.includes('gzip') || acceptEncoding.includes('deflate'));

  if (shouldCompress) {
    const encoding = acceptEncoding.includes('gzip') ? 'gzip' : 'deflate';
    const compressor = encoding === 'gzip' ? zlib.createGzip() : zlib.createDeflate();
    const responseHeaders = { ...headers, 'Content-Encoding': encoding, 'Vary': 'Accept-Encoding' };

    res.writeHead(statusCode, responseHeaders);
    compressor.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      if (!res.destroyed) res.end();
    });
    compressor.pipe(res);
    compressor.end(buffer);
    return;
  }

  const responseHeaders = { ...headers, 'Content-Length': buffer.length };
  res.writeHead(statusCode, responseHeaders);
  res.end(buffer);
}

function sendJson(req, res, payload, statusCode = 200) {
  const body = Buffer.from(JSON.stringify(payload));
  respondWithBuffer(req, res, statusCode, body, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=30, stale-while-revalidate=60'
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.mp4': return 'video/mp4';
    case '.mp3': return 'audio/mpeg';
    default: return 'application/octet-stream';
  }
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs / 1000)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': filePath.endsWith('.html') ? 'public, max-age=300, must-revalidate' : 'public, max-age=31536000, immutable' });
      res.end();
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const cacheControl = filePath.endsWith('.html')
        ? 'public, max-age=300, must-revalidate'
        : 'public, max-age=31536000, immutable';

      respondWithBuffer(req, res, 200, data, {
        'Content-Type': getContentType(filePath),
        'Cache-Control': cacheControl,
        ETag: etag
      });
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (req.method === 'POST' && pathname === '/api/save') {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body.toString('utf8'));
      writeData(payload);
      sendJson(req, res, { ok: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/upload') {
      const body = await readRequestBody(req);
      const fileName = requestUrl.searchParams.get('name') || 'upload.bin';
      const safeName = `${Date.now()}-${sanitizeFileName(fileName)}`;
      fs.mkdirSync(uploadDir, { recursive: true });
      const targetPath = path.join(uploadDir, safeName);
      fs.writeFileSync(targetPath, body);
      sendJson(req, res, { ok: true, path: `${publicUploadPrefix}/${safeName}` });
      return;
    }

    if (pathname === '/api/site') {
      sendJson(req, res, readData());
      return;
    }

    if (pathname === '/api/frames') {
      const data = readData();
      const category = requestUrl.searchParams.get('category') || '';
      const frames = (data.frames || []).filter((frame) => {
        if (!category) return true;
        return (frame.category || '').toLowerCase() === category.toLowerCase();
      });
      sendJson(req, res, { frames });
      return;
    }

    if (pathname === '/health') {
      sendJson(req, res, { status: 'ok' });
      return;
    }

    if (pathname === '/data.json') {
      serveFile(req, res, dataPath);
      return;
    }

    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^([.][.][/\\])+/, '');
    const filePath = path.join(rootDir, safePath.replace(/^\//, ''));

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveFile(req, res, filePath);
    } else {
      const fallbackPath = path.join(rootDir, 'index.html');
      serveFile(req, res, fallbackPath);
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error');
  }
});

server.listen(port, () => {
  console.log(`Portfolio server running at http://localhost:${port}`);
  
  // Initialize git config for auto-backups
  try {
    execSync('git rev-parse --git-dir', { cwd: rootDir, stdio: 'pipe' });
    
    // Set git config for commits (Railway environment)
    try {
      execSync('git config user.email "kahaani-baaz@backup.local"', { cwd: rootDir });
      execSync('git config user.name "Kahaani Baaz Auto-Backup"', { cwd: rootDir });
      console.log('✅ Git auto-backup initialized');
    } catch (e) {
      // Ignore config errors
    }
  } catch (e) {
    console.log('ℹ️  Not in a git repository - auto-backup disabled');
  }
});
