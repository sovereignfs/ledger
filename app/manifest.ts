import { manifest } from '@sovereignfs/pwa';
import { site } from '@/src/site';

/**
 * What a browser reads to install Ledger (DESIGN.md §14.6), made by the suite's `@sovereignfs/pwa`: a window of its own, an icon of each size it asks for (and
 * one that the platform may cut to its own shape), and what lets a link into the app, from Sovereign's launcher or anywhere else, open the installed app where
 * the device allows it (Sovereign research 0010). It opens at `/`, which for someone signed in is Overview. The colours are the design system's grey 900 and
 * white.
 */
export default function webManifest() {
  return manifest({
    name: site.name,
    description: site.description,
    // How a browser knows the installed app. It is what a browser derived from `start_url` before it was written, so existing installs stay the same app:
    // never change it.
    id: '/',
    backgroundColor: '#ffffff',
    themeColor: '#18181b',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
}
