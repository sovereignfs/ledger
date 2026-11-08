import { Landing } from '@/src/landing/Landing';

// The front address for a visitor (DESIGN.md §14.3). For someone with a session cookie the proxy shows Overview here instead and the address stays `/`
// (`proxy.ts`). Decided per request, since sign-in is set up by the environment and not at build time.
export const dynamic = 'force-dynamic';

export default function Front() {
  return <Landing />;
}
