const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = __dirname;
const port = process.env.PORT || 3000;
const dataPath = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(rootDir, 'data.json');
const uploadDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(rootDir, 'images');
const publicUploadPrefix = process.env.PUBLIC_UPLOAD_PREFIX || 'images';

fs.mkdirSync(path.dirname(dataPath), { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

function listImageFiles() {
  if (!fs.existsSync(uploadDir)) return [];
  return fs.readdirSync(uploadDir).filter((name) => fs.statSync(path.join(uploadDir, name)).isFile());
  if (!fs.existsSync(imagesDir)) return [];
  return fs.readdirSync(imagesDir).filter((name) => fs.statSync(path.join(imagesDir, name)).isFile());
}

function resolveMediaPath(src) {
  if (!src || typeof src !== 'string') return src;
  const trimmed = src.trim();
  if (!trimmed) return trimmed;

  const normalized = trimmed.replace(/^\/+/, '').replace(/\\/g, '/');
  const absolutePath = path.join(rootDir, normalized);
  if (fs.existsSync(absolutePath)) return normalized;

  const fileName = path.basename(normalized);
  const ext = path.extname(fileName);
  const baseName = fileName.slice(0, -ext.length);
  const comparableBase = baseName
    .replace(/^frame-/i, '')
    .replace(/^reel-/i, '')
    .replace(/^bg-music-/i, '')
    .replace(/^\d+-/, '');

  const candidates = listImageFiles();
  for (const candidate of candidates) {
    const candidateExt = path.extname(candidate);
    const candidateBase = candidate.slice(0, -candidateExt.length);
    const candidateComparable = candidateBase
      .replace(/^frame-/i, '')
      .replace(/^reel-/i, '')
      .replace(/^bg-music-/i, '')
      .replace(/^\d+-/, '');

    if (candidateComparable === comparableBase || candidateBase === baseName || baseName.includes(candidateComparable) || candidateComparable.includes(comparableBase)) {
      return `images/${candidate}`;
    }
  }

  return normalized;
}

function normalizePayload(payload) {
  const normalized = JSON.parse(JSON.stringify(payload));
  if (Array.isArray(normalized.frames)) {
    normalized.frames = normalized.frames.map((frame) => ({
      ...frame,
      src: resolveMediaPath(frame && frame.src)
    }));
  }
  if (Array.isArray(normalized.reels)) {
    normalized.reels = normalized.reels.map((reel) => ({
      ...reel,
      src: resolveMediaPath(reel && reel.src)
    }));
  }
  if (normalized.music && normalized.music.src) {
    normalized.music = {
      ...normalized.music,
      src: resolveMediaPath(normalized.music.src)
    };
  }
  return normalized;
}

function readData() {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  return normalizePayload(data);
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
  const normalized = normalizePayload(payload);
  fs.writeFileSync(dataPath, JSON.stringify(normalized, null, 2));
  
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

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
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

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(data);
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
      sendJson(res, { ok: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/upload') {
      const body = await readRequestBody(req);
      const fileName = requestUrl.searchParams.get('name') || 'upload.bin';
      const safeName = `${Date.now()}-${sanitizeFileName(fileName)}`;
      fs.mkdirSync(uploadDir, { recursive: true });
      const targetPath = path.join(uploadDir, safeName);
      fs.writeFileSync(targetPath, body);
      sendJson(res, { ok: true, path: `${publicUploadPrefix}/${safeName}` });
      return;
    }

    if (pathname === '/api/site') {
      sendJson(res, readData());
      return;
    }

    if (pathname === '/api/frames') {
      const data = readData();
      const category = requestUrl.searchParams.get('category') || '';
      const frames = (data.frames || []).filter((frame) => {
        if (!category) return true;
        return (frame.category || '').toLowerCase() === category.toLowerCase();
      });
      sendJson(res, { frames });
      return;
    }

    if (pathname === '/health') {
      sendJson(res, { status: 'ok' });
      return;
    }

    if (pathname === '/data.json') {
      serveFile(res, dataPath);
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
      serveFile(res, filePath);
    } else {
      const fallbackPath = path.join(rootDir, 'index.html');
      serveFile(res, fallbackPath);
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
