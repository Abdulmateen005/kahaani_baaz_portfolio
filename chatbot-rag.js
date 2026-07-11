function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeText(text).split(' ').filter(Boolean);
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

function getSections(data) {
  const fromData = Array.isArray(data.sections) ? data.sections : [];
  if (fromData.length) return fromData;

  const fallbackSections = [
    { slug: 'portraits', label: 'Portraits', intro: 'A closer look at faces, gestures and quiet stories.', description: 'Portraits and intimate human moments.' },
    { slug: 'street-style', label: 'Street Style', intro: 'City textures, movement and everyday scenes.', description: 'Street scenes and urban movement.' },
    { slug: 'randoms', label: 'Randoms', intro: 'Small observations and unexpected details.', description: 'Unplanned observations and candid moments.' }
  ];

  return fallbackSections;
}

function buildDocuments(data) {
  const site = data.site || {};
  const sections = getSections(data);
  const frames = Array.isArray(data.frames) ? data.frames : [];
  const reels = Array.isArray(data.reels) ? data.reels : [];
  const music = data.music || {};
  const docs = [];

  const addDoc = (title, body, type, meta = {}) => {
    if (!body || !String(body).trim()) return;
    docs.push({ title, body: String(body).trim(), type, meta });
  };

  const overviewBody = [
    site.name,
    site.alias,
    site.location,
    site.heroSub,
    ...(site.aboutParagraphs || [])
  ].filter(Boolean).join(' ');

  addDoc('Portfolio overview', overviewBody, 'overview');
  addDoc('Contact details', `${site.name || 'The photographer'} can be followed on Instagram at ${site.instagram || 'their profile'} and the handle is ${site.handle || 'the portfolio handle'}.`, 'contact');
  addDoc('Location', `${site.name || 'The photographer'} is based in ${site.location || 'Lahore, Pakistan'}.`, 'location');

  sections.forEach((section) => {
    const label = formatSectionLabel(section);
    const body = `${label} — ${section.intro || 'Portfolio section'}. ${section.description || ''}`.trim();
    addDoc(`Section: ${label}`, body, 'section', { slug: slugifyText(section.slug || label) });
  });

  frames.slice(0, 10).forEach((frame) => {
    const body = `${frame.tag || frame.alt || 'Frame'} in ${frame.category || 'uncategorized'}${frame.feature ? ' and featured' : ''}. ${frame.alt || ''}`.trim();
    addDoc(`Frame: ${frame.tag || frame.alt || 'Frame'}`, body, 'frame');
  });

  if (reels.length) {
    addDoc('Reels', `The portfolio includes ${reels.length} reel${reels.length === 1 ? '' : 's'} for motion storytelling.`, 'reel');
  }

  if (music.src) {
    addDoc('Music', `The site includes music with the label ${music.label || 'Music'}.`, 'music');
  }

  return docs;
}

function scoreDocument(query, doc) {
  const lowerQuery = normalizeText(query);
  const lowerBody = normalizeText(doc.body);
  const tokens = tokenize(lowerQuery);
  let score = 0;

  tokens.forEach((token) => {
    if (lowerBody.includes(token)) score += 2;
  });

  if (lowerQuery.includes('who') || lowerQuery.includes('about') || lowerQuery.includes('story')) {
    if (doc.type === 'overview') score += 5;
  }
  if (lowerQuery.includes('contact') || lowerQuery.includes('instagram') || lowerQuery.includes('follow')) {
    if (doc.type === 'contact') score += 5;
  }
  if (lowerQuery.includes('where') || lowerQuery.includes('location') || lowerQuery.includes('based')) {
    if (doc.type === 'location') score += 5;
  }
  if (lowerQuery.includes('section') || lowerQuery.includes('category') || lowerQuery.includes('page')) {
    if (doc.type === 'section') score += 5;
  }
  if (lowerQuery.includes('frame') || lowerQuery.includes('photo') || lowerQuery.includes('image') || lowerQuery.includes('gallery')) {
    if (doc.type === 'frame') score += 5;
  }
  if (lowerQuery.includes('reel') || lowerQuery.includes('video') || lowerQuery.includes('motion')) {
    if (doc.type === 'reel') score += 5;
  }
  if (lowerQuery.includes('music') || lowerQuery.includes('audio') || lowerQuery.includes('song')) {
    if (doc.type === 'music') score += 5;
  }

  if (doc.type === 'overview' && (lowerQuery.includes('portfolio') || lowerQuery.includes('story') || lowerQuery.includes('photography'))) score += 2;
  if (doc.type === 'section' && (lowerQuery.includes('section') || lowerQuery.includes('gallery'))) score += 2;

  return score;
}

function retrieveRelevantDocuments(query, data, limit = 4) {
  return buildDocuments(data)
    .map((doc) => ({ ...doc, score: scoreDocument(query, doc) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function buildContextText(query, data) {
  const docs = retrieveRelevantDocuments(query, data, 4);
  return docs.map((doc, index) => `[${index + 1}] ${doc.title}: ${doc.body}`).join('\n\n');
}

function getContextAwareReply(query, data) {
  const docs = retrieveRelevantDocuments(query, data, 4);
  const top = docs[0];
  const lowerQuery = normalizeText(query);
  const site = data.site || {};
  const sections = getSections(data);
  const frames = Array.isArray(data.frames) ? data.frames : [];
  const reels = Array.isArray(data.reels) ? data.reels : [];

  if (!top) {
    return {
      reply: 'I can help with the portfolio story, sections, frames, reels, contact info, and music.',
      sources: [],
      context: ''
    };
  }

  if (lowerQuery.includes('contact') || lowerQuery.includes('instagram') || lowerQuery.includes('follow')) {
    return {
      reply: `${site.name || 'The photographer'} can be followed on Instagram at ${site.instagram || 'their profile'} and the handle is ${site.handle || 'the portfolio handle'}.`,
      sources: docs.map((doc) => doc.title),
      context: buildContextText(query, data)
    };
  }

  if (lowerQuery.includes('section') || lowerQuery.includes('category') || lowerQuery.includes('page')) {
    const labels = sections.length ? sections.map((section) => formatSectionLabel(section)).join(', ') : 'the main portfolio sections';
    return {
      reply: `The portfolio currently highlights ${labels}.`,
      sources: docs.map((doc) => doc.title),
      context: buildContextText(query, data)
    };
  }

  if (lowerQuery.includes('frame') || lowerQuery.includes('photo') || lowerQuery.includes('image') || lowerQuery.includes('gallery')) {
    return {
      reply: `There are ${frames.length || 0} frame${frames.length === 1 ? '' : 's'} available in the portfolio right now, and they are organized into the visible sections on the site.`,
      sources: docs.map((doc) => doc.title),
      context: buildContextText(query, data)
    };
  }

  if (lowerQuery.includes('reel') || lowerQuery.includes('video') || lowerQuery.includes('motion')) {
    return {
      reply: `The site includes ${reels.length || 0} reel${reels.length === 1 ? '' : 's'} and presents the work in a motion-led format for the scroll experience.`,
      sources: docs.map((doc) => doc.title),
      context: buildContextText(query, data)
    };
  }

  if (lowerQuery.includes('who') || lowerQuery.includes('about') || lowerQuery.includes('story')) {
    return {
      reply: `${site.name || 'This portfolio'} is a story-led photography practice rooted in street and documentary moments, with a focus on honest, unposed scenes and short-form video.`,
      sources: docs.map((doc) => doc.title),
      context: buildContextText(query, data)
    };
  }

  return {
    reply: `Based on the portfolio content, ${top.body.slice(0, 220)}${top.body.length > 220 ? '…' : ''}`,
    sources: docs.map((doc) => doc.title),
    context: buildContextText(query, data)
  };
}

async function getModelReplyFromContext(query, data) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const context = buildContextText(query, data);
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
            content: 'You are a helpful assistant for a photography portfolio website. Answer in a warm, concise way using the retrieved context below. If the context is weak, say so plainly.'
          },
          {
            role: 'user',
            content: `Question: ${query}\n\nRetrieved context:\n${context}`
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes('insufficient_quota') || errorText.includes('429') || errorText.includes('billing')) {
        console.warn('OpenAI chatbot unavailable: quota or billing issue. Falling back to local answers.');
      } else {
        console.warn('OpenAI chatbot unavailable:', errorText);
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

module.exports = {
  buildDocuments,
  retrieveRelevantDocuments,
  buildContextText,
  getContextAwareReply,
  getModelReplyFromContext
};
