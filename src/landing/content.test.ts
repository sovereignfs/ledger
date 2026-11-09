import { describe, expect, it } from 'vitest';
import { landing } from './content';

describe('what the landing page says', () => {
  it('has something to say in every place it says anything', () => {
    for (const text of [
      landing.heading,
      landing.lead,
      landing.signIn,
      landing.signUp,
      landing.noSignIn,
    ])
      expect(text.trim()).not.toBe('');
    expect(landing.features.length).toBeGreaterThan(0);
    for (const feature of landing.features) {
      expect(feature.title.trim()).not.toBe('');
      expect(feature.body.trim()).not.toBe('');
    }
    expect(new Set(landing.features.map((f) => f.title)).size).toBe(landing.features.length);
  });

  it('promises nothing that is not built: no export, import, recap or chart of net worth yet', () => {
    const said = JSON.stringify(landing).toLowerCase();
    // A word comes off this list in the task that builds what it names.
    for (const word of ['export', 'import', 'recap', 'chart']) {
      expect(said, word).not.toContain(word);
    }
  });
});
