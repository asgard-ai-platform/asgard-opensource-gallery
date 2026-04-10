import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';

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
  return toHtml(hast!);
}
