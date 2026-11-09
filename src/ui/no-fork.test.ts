import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **No navigation or data decision is forked by viewport** (DESIGN.md §14.6): the same addresses and the same data at every width, and only what is drawn
 * differs. A width is asked for by `useIsMobile`, `matchMedia` or `innerWidth`, and only the files below may (each draws something differently and decides
 * nothing else); a new file that asks must be added here, which is where someone looks at whether it is a rendering choice. And none of these may navigate or
 * fetch on the strength of it. The shell draws its two navigations and lets its stylesheet show one, so it appears in no list.
 */
const ROOT = path.resolve(__dirname, '..', '..');

/** Files that draw differently by width (or by the device's scheme), and why. */
const RENDERING_ONLY: Record<string, string> = {
  'src/theme/script.ts': 'the colour scheme the device prefers, not a width',
  'src/account/PreferencesSection.tsx': 'the colour scheme the device prefers, not a width',
  'src/entries/EntrySurface.tsx':
    'a Dialog on a wide screen and a Drawer on a narrow one, with the same content',
};
/** What a file that draws by width must not also do. */
const NOT_BY_WIDTH = /\b(router\.(push|replace)|window\.location\.(assign|replace)|fetch\()/;

function walk(folder: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, folder))) {
    const relative = path.join(folder, name);
    if (statSync(path.join(ROOT, relative)).isDirectory()) out.push(...walk(relative));
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative);
  }
  return out;
}

describe('a width', () => {
  const files = [...walk('src'), ...walk('app')];
  const asking = files
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) =>
      /\b(useIsMobile|matchMedia|innerWidth)\b/.test(readFileSync(path.join(ROOT, file), 'utf8')),
    );

  it('is asked for only by the files that draw differently by it', () => {
    expect(asking.filter((file) => !(file in RENDERING_ONLY))).toEqual([]);
  });

  it('decides nothing in those files but what is drawn: they do not navigate or fetch by it', () => {
    const offenders = asking
      .filter((file) => file in RENDERING_ONLY)
      .filter((file) => NOT_BY_WIDTH.test(readFileSync(path.join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('is not asked for in a route, a layout or a handler', () => {
    expect(asking.filter((file) => file.startsWith('app/'))).toEqual([]);
  });

  it('is asked for by something, so that the check looks at something', () => {
    expect(asking.length).toBeGreaterThan(0);
  });
});
