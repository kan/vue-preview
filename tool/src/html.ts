// Assemble the final self-contained HTML document.
export interface HtmlParts {
  title: string;
  css: { label: string; css: string }[];
  body: string;
  teleports: string;
}

export function buildHtml(p: HtmlParts): string {
  const styles = p.css
    .filter((c) => c.css.trim())
    .map((c) => `<style data-vp="${c.label}">\n${c.css.replace(/<\/style/gi, '<\\/style')}\n</style>`)
    .join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
${styles}
</head>
<body>
<div id="app">${p.body}</div>
${p.teleports}
</body>
</html>
`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
