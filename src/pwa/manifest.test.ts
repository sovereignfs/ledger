import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../app/manifest';

/** The manifest a browser reads to install Ledger (DESIGN.md §14.6): a name, standalone, an icon of each size it asks for, **and the icons are there, of the sizes they say**. */
const pngSize = (file: string): { width: number; height: number } => {
  const bytes = readFileSync(resolve(__dirname, '../../public', file));
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

describe('the web manifest', () => {
  const m = manifest();

  it('is an app that opens standalone at its front address, over the whole of the app', () => {
    expect(m).toMatchObject({
      name: 'Ledger',
      short_name: 'Ledger',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('has an icon of 192 and of 512 pixels, and one the platform may cut to its own shape', () => {
    const icons = m.icons ?? [];
    expect(icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBe(
      true,
    );
  });

  it('names icons that are there, as PNGs of the size each says', () => {
    for (const icon of m.icons ?? []) {
      const [width, height] = (icon.sizes as string).split('x').map(Number);
      expect(pngSize(icon.src.replace(/^\//, '')), icon.src).toEqual({ width, height });
      expect(icon.type).toBe('image/png');
    }
    expect(pngSize('icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });
});
