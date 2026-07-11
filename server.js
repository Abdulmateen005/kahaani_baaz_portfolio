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

function loadEnvFile() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;
    const [rawKey, ...rawValueParts] = trimmed.split('=');
    const key = rawKey.trim();
    const value = rawValueParts.join('=').trim();
    if (!process.env[key]) {
      process.env[key] = value.replace(/^['"]|['"]$/g, '');
    }
  });
}

loadEnvFile();

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

function slugifyText(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function formatSectionLabel(section) {
  return section.label || section.title || section.name || (section.slug ? section.slug.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') : 'Section');
}

function normalizeChatText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeChatText(text).split(' ').filter(Boolean);
}

function buildKnowledgeBase(data) {
  const site = data.site || {};
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const frames = Array.isArray(data.frames) ? data.frames : [];
  const reels = Array.isArray(data.reels) ? data.reels : [];
  const music = data.music || {};
  const chunks = [];

  const addChunk = (title, content) => {
    if (content && String(content).trim()) {
      chunks.push({ title, content: String(content).trim() });
    }
  };

  const aboutText = [
    site.name,
    site.alias,
    site.location,
    site.heroSub,
    ...(site.aboutParagraphs || [])
  ].filter(Boolean).join(' ');

  addChunk('About', aboutText);
  addChunk('Contact', `${site.name} can be reached on Instagram at ${site.instagram || 'their social profile'} and is known as ${site.handle || 'the portfolio handle'}.`);
  addChunk('Location', `${site.name} is based in ${site.location || 'Lahore, Pakistan'}.`);
  addChunk('Sections', sections.length
    ? sections.map(section => `${formatSectionLabel(section)} — ${section.intro || ''}`.trim()).join(' ')
    : 'No extra sections have been added yet.');
  addChunk('Frames', frames.length
    ? frames.slice(0, 8).map(frame => `${frame.tag || frame.alt || 'Frame'} in ${frame.category || 'uncategorized'}`).join(' • ')
    : 'No frames are available yet.');
  addChunk('Reels', reels.length
    ? reels.map(reel => reel.id || reel.src || 'Reel').join(' • ')
    : 'No reels have been added yet.');
  addChunk('Music', music.src ? `The site currently includes ${music.label || 'music'} audio.` : 'No music is currently configured.');

  return chunks;
}

function scoreChunk(query, chunk) {
  const lowerQuery = normalizeChatText(query);
  const lowerContent = normalizeChatText(chunk.content);
  const tokens = tokenize(lowerQuery);
  let score = 0;

  tokens.forEach(token => {
    if (lowerContent.includes(token)) score += 2;
  });

  if (lowerQuery.includes('who') || lowerQuery.includes('about') || lowerQuery.includes('story')) score += 4;
  if (lowerQuery.includes('contact') || lowerQuery.includes('instagram') || lowerQuery.includes('follow')) score += 4;
  if (lowerQuery.includes('where') || lowerQuery.includes('location') || lowerQuery.includes('based')) score += 4;
  if (lowerQuery.includes('section') || lowerQuery.includes('category') || lowerQuery.includes('page')) score += 4;
  if (lowerQuery.includes('frame') || lowerQuery.includes('photo') || lowerQuery.includes('image') || lowerQuery.includes('gallery')) score += 4;
  if (lowerQuery.includes('reel') || lowerQuery.includes('video') || lowerQuery.includes('motion')) score += 4;
  if (lowerQuery.includes('music') || lowerQuery.includes('audio') || lowerQuery.includes('song')) score += 4;

  if (chunk.title === 'About' && (lowerQuery.includes('who') || lowerQuery.includes('about') || lowerQuery.includes('story'))) score += 3;
  if (chunk.title === 'Contact' && (lowerQuery.includes('contact') || lowerQuery.includes('instagram') || lowerQuery.includes('follow'))) score += 3;
  if (chunk.title === 'Location' && (lowerQuery.includes('where') || lowerQuery.includes('location') || lowerQuery.includes('based'))) score += 3;
  if (chunk.title === 'Sections' && (lowerQuery.includes('section') || lowerQuery.includes('category') || lowerQuery.includes('page'))) score += 3;
  if (chunk.title === 'Frames' && (lowerQuery.includes('frame') || lowerQuery.includes('photo') || lowerQuery.includes('image') || lowerQuery.includes('gallery'))) score += 3;
  if (chunk.title === 'Reels' && (lowerQuery.includes('reel') || lowerQuery.includes('video') || lowerQuery.includes('motion'))) score += 3;
  if (chunk.title === 'Music' && (lowerQuery.includes('music') || lowerQuery.includes('audio') || lowerQuery.includes('song'))) score += 3;

  return score;
}

function answerFromKnowledgeBase(query, data) {
  const site = data.site || {};
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const frames = Array.isArray(data.frames) ? data.frames : [];
  const reels = Array.isArray(data.reels) ? data.reels : [];
  const lowerQuery = normalizeChatText(query);
  const chunks = buildKnowledgeBase(data)
    .map(chunk => ({ ...chunk, score: scoreChunk(query, chunk) }))
    .sort((a, b) => b.score - a.score);

  const top = chunks[0] || { title: 'About', content: '' };
  const secondary = chunks[1];

  if (lowerQuery.includes('contact') || lowerQuery.includes('instagram') || lowerQuery.includes('follow')) {
    return {
      reply: `${site.name || 'The photographer'} can be followed on Instagram at ${site.instagram || 'their profile'} and the handle is ${site.handle || 'the portfolio handle'}.`,
      sources: [top.title, secondary && secondary.title].filter(Boolean)
    };
  }

  if (lowerQuery.includes('where') || lowerQuery.includes('location') || lowerQuery.includes('based')) {
    return {
      reply: `${site.name || 'The photographer'} is based in ${site.location || 'Lahore, Pakistan'}.`,
      sources: [top.title, secondary && secondary.title].filter(Boolean)
    };
  }

  if (lowerQuery.includes('section') || lowerQuery.includes('category') || lowerQuery.includes('page')) {
    const labels = sections.length ? sections.map(section => formatSectionLabel(section)).join(', ') : 'the main portfolio sections';
    return {
      reply: `The portfolio currently highlights ${labels}.`,
      sources: [top.title, secondary && secondary.title].filter(Boolean)
    };
  }

  if (lowerQuery.includes('frame') || lowerQuery.includes('photo') || lowerQuery.includes('image') || lowerQuery.includes('gallery')) {
    return {
      reply: `There are ${frames.length || 0} frames available in the portfolio right now, and the latest work is organized into the visible sections on the site.`,
      sources: [top.title, secondary && secondary.title].filter(Boolean)
    };
  }

  if (lowerQuery.includes('reel') || lowerQuery.includes('video') || lowerQuery.includes('motion')) {
    return {
      reply: `The site includes ${reels.length || 0} reel${reels.length === 1 ? '' : 's'} and the work is presented in a motion-first format for the scroll experience.`,
      sources: [top.title, secondary && secondary.title].filter(Boolean)
    };
  }

  if (lowerQuery.includes('music')) {
    return {
      reply: `Music is ${data.music && data.music.src ? 'enabled with the current track label ' + (data.music.label || 'Music') + '.' : 'not currently configured.'}`,
      sources: [top.title, secondary && secondary.title].filter(Boolean)
    };
  }

  if (lowerQuery.includes('who') || lowerQuery.includes('about') || lowerQuery.includes('story')) {
    return {
      reply: `${site.name || 'This portfolio'} is a story-led photography practice built around street and documentary moments, with a focus on honest, unposed scenes and short-form video.`,
      sources: [top.title, secondary && secondary.title].filter(Boolean)
    };
  }

  if (top.score < 2) {
    return {
      reply: `I can answer questions about the portfolio, including its story, sections, frames, reels, contact details, and music.`,
      sources: [top.title].filter(Boolean)
    };
  }

  return {
    reply: `I found this in the portfolio: ${top.content.slice(0, 220)}${top.content.length > 220 ? '…' : ''}`,
    sources: [top.title, secondary && secondary.title].filter(Boolean)
  };
}

async function getModelReply(query, data) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const context = JSON.stringify({
      site: data.site || {},
      sections: Array.isArray(data.sections) ? data.sections : [],
      frames: Array.isArray(data.frames) ? data.frames.slice(0, 10) : [],
      reels: Array.isArray(data.reels) ? data.reels : [],
      music: data.music || {}
    }, null, 2);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content: 'You are a friendly assistant for a photography portfolio website. Answer clearly, warmly, and briefly using only the provided portfolio context. If you are unsure, say so plainly.'
          },
          {
            role: 'user',
            content: `Question: ${query}\n\nPortfolio context:\n${context}`
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      const normalized = errorText || 'OpenAI request failed';
      if (normalized.includes('insufficient_quota') || normalized.includes('429') || normalized.includes('billing')) {
        console.warn('OpenAI chatbot unavailable: quota or billing issue. Falling back to local answers.');
      } else {
        console.warn('OpenAI chatbot unavailable:', normalized);
      }
      return null;
    }

    const result = await response.json();
    return result?.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.warn('OpenAI chatbot error', error.message || error);
    return null;
  }
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

    const cacheControl = filePath.endsWith('.html')
      ? 'public, max-age=300, must-revalidate'
      : 'public, max-age=31536000, immutable';

    const rangeHeader = req.headers.range;
    const size = stat.size;
    const contentType = getContentType(filePath);

    if (rangeHeader && rangeHeader.startsWith('bytes=')) {
      const [rangeUnit, rangeValue] = rangeHeader.split('=');
      if (rangeUnit !== 'bytes') {
        res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
        res.end();
        return;
      }

      const [startStr, endStr] = rangeValue.split('-');
      const start = Number.parseInt(startStr, 10);
      const end = endStr ? Number.parseInt(endStr, 10) : size - 1;

      if (Number.isNaN(start) || start < 0 || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
        res.end();
        return;
      }

      const safeEnd = end < size - 1 ? end : size - 1;
      const length = safeEnd - start + 1;
      const stream = fs.createReadStream(filePath, { start, end: safeEnd });
      res.writeHead(206, {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        ETag: etag,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${safeEnd}/${size}`,
        'Content-Length': length
      });
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        if (!res.destroyed) res.end();
      });
      stream.pipe(res);
      return;
    }

    const stream = fs.createReadStream(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      ETag: etag,
      'Accept-Ranges': 'bytes',
      'Content-Length': size
    });
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      if (!res.destroyed) res.end();
    });
    stream.pipe(res);
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

    if (req.method === 'POST' && pathname === '/api/chat') {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body.toString('utf8'));
      const message = payload.message || '';
      const data = readData();
      const modelReply = await getModelReply(message, data);
      const result = modelReply
        ? { reply: modelReply, source: 'openai' }
        : { ...answerFromKnowledgeBase(message, data), source: 'local' };
      sendJson(req, res, result);
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
  console.log(`Chatbot AI mode: ${process.env.OPENAI_API_KEY ? 'enabled' : 'disabled'}`);
  
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
