/** Parse misc_emailtemplate.content (Quill delta, HTML, or plain text) into plain body text. */

function sanitizeTemplateText(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function tryParseDelta(input) {
  try {
    const parsed = JSON.parse(input);
    const ops = parsed?.delta?.ops || parsed?.ops;
    if (Array.isArray(ops)) {
      const text = ops.map((op) => (typeof op?.insert === 'string' ? op.insert : '')).join('');
      return sanitizeTemplateText(text);
    }
  } catch {
    // ignore
  }
  return null;
}

function cleanHtml(input) {
  let text = input;
  const htmlMatch = text.match(/html\s*:\s*(.*)/is);
  if (htmlMatch) text = htmlMatch[1];
  text = text
    .replace(/^{?delta\s*:\s*\{.*?\},?/is, '')
    .replace(/^{|}$/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\r/g, '');
  return sanitizeTemplateText(text);
}

function parseEmailTemplateContent(rawContent) {
  if (!rawContent) return '';

  let text = tryParseDelta(rawContent);
  if (text !== null) return text;

  text = tryParseDelta(
    rawContent
      .replace(/^"|"$/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t'),
  );
  if (text !== null) return text;

  const normalised = rawContent
    .replace(/\\"/g, '"')
    .replace(/\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
  const insertRegex = /"?insert"?\s*:\s*"([^"\n]*)"/g;
  const inserts = [];
  let match;
  while ((match = insertRegex.exec(normalised))) {
    inserts.push(match[1]);
  }
  if (inserts.length > 0) {
    return sanitizeTemplateText(inserts.join('').replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
  }

  return sanitizeTemplateText(cleanHtml(rawContent));
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function containsRTL(text) {
  if (!text) return false;
  return /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F]/.test(text);
}

function formatPlainEmailHtml(plainBody) {
  if (!plainBody) return '';

  let htmlBody = plainBody;
  const hasHtmlTags = /<[a-z][\s\S]*>/i.test(htmlBody);

  if (!hasHtmlTags) {
    htmlBody = htmlBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
  } else {
    htmlBody = htmlBody
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/(<br\s*\/?>|\n)/gi, '<br>')
      .replace(/\n/g, '<br>');
  }

  if (containsRTL(htmlBody)) {
    return `<div dir="rtl" style="text-align: right; direction: rtl; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
  }
  return `<div dir="ltr" style="text-align: left; direction: ltr; font-family: 'Segoe UI', Arial, 'Helvetica Neue', sans-serif;">${htmlBody}</div>`;
}

function stripRemainingBraces(text) {
  return text
    .replace(/\{\{\s*[a-z_]+\s*\}\}/gi, '')
    .replace(/\{\s*[a-z_]+\s*\}/gi, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/\{|\}/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeTemplateBraces(text) {
  return String(text ?? '').replace(/\uFF5B/g, '{').replace(/\uFF5D/g, '}');
}

/** Replace {name}, {{date}}, etc. in misc_emailtemplate bodies (booking, CRM). */
function fillEmailTemplateParams(content, vars) {
  let out = normalizeTemplateBraces(content);
  Object.entries(vars || {}).forEach(([key, value]) => {
    const safe = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const v = value != null ? String(value) : '';
    out = out.replace(new RegExp(`\\{\\{\\s*${safe}\\s*\\}\\}`, 'gi'), v);
    out = out.replace(new RegExp(`\\{\\s*${safe}\\s*\\}`, 'gi'), v);
  });
  return out;
}

module.exports = {
  parseEmailTemplateContent,
  escapeHtml,
  formatPlainEmailHtml,
  stripRemainingBraces,
  fillEmailTemplateParams,
};
