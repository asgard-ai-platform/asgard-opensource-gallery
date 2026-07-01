import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';

/**
 * A URL is safe to keep as an href/src if it is relative (no scheme) or uses an
 * allowlisted scheme. The output of this renderer is injected with `set:html`,
 * so a `[x](javascript:alert(1))` link would otherwise render a clickable
 * `javascript:` href that runs on the gallery origin. Control/whitespace chars
 * are stripped first so a broken-up scheme cannot slip past the scheme check.
 */
export function isSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string') return true;
  const s = url.replace(/[\x00-\x20]/g, '').toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*:/.test(s)) return true; // relative / fragment / query
  return /^(?:https?:|mailto:)/.test(s);
}

/** Drop unsafe href/src attributes from `a`/`img` nodes throughout a hast tree. */
function sanitizeUrls(node: any): void {
  if (node && node.type === 'element' && node.properties) {
    if ('href' in node.properties && !isSafeUrl(node.properties.href)) delete node.properties.href;
    if ('src' in node.properties && !isSafeUrl(node.properties.src)) delete node.properties.src;
  }
  if (node && Array.isArray(node.children)) {
    for (const child of node.children) sanitizeUrls(child);
  }
}

/**
 * Convert markdown string to HTML with GFM support (tables, strikethrough, etc).
 * Used at build time in Astro to render SKILL.md sections on detail pages.
 */
export function renderMarkdown(md: string): string {
  if (!md) return '';
  const tree = fromMarkdown(md, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const hast = toHast(tree);
  sanitizeUrls(hast);
  return toHtml(hast!);
}
