const https = require('https');
const fs = require('fs');
const path = require('path');

const RSS_FEEDS = [
  'https://www.newsinlevels.com/feed/'
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function cleanArticle(raw) {
  let text = raw
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(/^\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+/, '');
  text = text.replace(/\s*The post .+ appeared first on .+\.?\s*$/i, '');
  text = text.replace(/\s*This post .+ appeared first on .+\.?\s*$/i, '');

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const paragraphs = [];
  let chunk = '';
  for (const s of sentences) {
    const clean = s.trim();
    if (!clean) continue;
    if (chunk.length + clean.length < 200) {
      chunk += (chunk ? ' ' : '') + clean;
    } else {
      if (chunk.trim()) paragraphs.push(chunk.trim());
      chunk = clean;
    }
  }
  if (chunk.trim()) paragraphs.push(chunk.trim());

  return paragraphs.filter(p => p.length > 40);
}

function normalizeTitle(title) {
  return title
    .replace(/\s*[–\-—]\s*level\s+\d+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  let allArticles = [];

  const existingPath = path.join(__dirname, 'articles.json');
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
  } catch(e) {}

  const existingKeys = new Set(existing.map(a => normalizeTitle(a.title)));

  for (const feedUrl of RSS_FEEDS) {
    try {
      const apiUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(feedUrl);
      console.log('Fetching:', feedUrl);
      const data = await fetchJson(apiUrl);
      if (data.status !== 'ok' || !data.items) {
        console.log('  Status:', data.status, '| Items:', (data.items||[]).length);
        continue;
      }

      data.items.sort((a, b) => {
        const lenA = (a.description || '').length + (a.content || '').length;
        const lenB = (b.description || '').length + (b.content || '').length;
        return lenB - lenA;
      });

      let kept = 0;
      for (const item of data.items) {
        const rawTitle = (item.title || '').replace(/<[^>]*>/g, '').trim();
        const key = normalizeTitle(rawTitle);
        if (!rawTitle || existingKeys.has(key)) continue;

        const raw = (item.description || '') + ' ' + (item.content || '');
        const paragraphs = cleanArticle(raw);
        if (paragraphs.length < 2) continue;

        allArticles.push({
          title: rawTitle,
          paragraphs: paragraphs.slice(0, 5),
          fetchedAt: new Date().toISOString().split('T')[0]
        });
        existingKeys.add(key);
        kept++;
      }
      console.log(`  Items: ${data.items.length} | Kept: ${kept}`);
    } catch(e) {
      console.error('  Failed:', e.message);
    }
  }

  const merged = [...allArticles, ...existing].slice(0, 200);
  fs.writeFileSync(existingPath, JSON.stringify(merged, null, 2));
  console.log(`New: ${allArticles.length} | Total: ${merged.length}`);
}

main().catch(console.error);
