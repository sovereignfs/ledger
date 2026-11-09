import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A Frankfurter for tests (DESIGN.md §19): a server on this machine that answers `GET /v1/latest?base=USD` the way the real one does, and can be told to answer
 * otherwise, so that rate fetching is tried with no network and every way the other side can go wrong. It keeps what it was asked, so a test can say what a fetch
 * did and did not send.
 */
export type FakeBehaviour =
  | { kind: 'rates' }
  | { kind: 'status'; status: number }
  | { kind: 'redirect' }
  | { kind: 'body'; body: string }
  | { kind: 'hang' };

export interface FakeFrankfurter {
  /** The address to give `LEDGER_FX_URL`. */
  readonly url: string;
  /** Every request so far, as its path and query. */
  readonly requests: string[];
  /** The day it says the rates are for. */
  date: string;
  /** Currency to the decimal text it is written as in the answer: written as a JSON number exactly as given, so a test can try a long one. */
  rates: Record<string, string>;
  behaviour: FakeBehaviour;
  close(): Promise<void>;
}

/** What the real service answers with, close enough that a client written against this works against it. */
const DEFAULT_RATES: Record<string, string> = {
  EUR: '0.86312',
  GBP: '0.75521',
  JPY: '154.38',
  BHD: '0.376',
  CAD: '1.4012',
};

export async function startFakeFrankfurter(): Promise<FakeFrankfurter> {
  const sockets = new Set<import('node:net').Socket>();
  const fake: FakeFrankfurter = {
    url: '',
    requests: [],
    date: '2026-11-06',
    rates: { ...DEFAULT_RATES },
    behaviour: { kind: 'rates' },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  const server: Server = createServer((request, response) => {
    fake.requests.push(request.url ?? '');
    const behaviour = fake.behaviour;
    if (behaviour.kind === 'hang') return; // never answers: the client's time limit is what ends it
    if (behaviour.kind === 'status') {
      response.writeHead(behaviour.status).end('not that');
      return;
    }
    if (behaviour.kind === 'redirect') {
      response.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }).end();
      return;
    }
    if (behaviour.kind === 'body') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(behaviour.body);
      return;
    }
    const url = new URL(request.url ?? '/', 'http://fake');
    if (url.pathname !== '/v1/latest' || url.searchParams.get('base') !== 'USD') {
      response.writeHead(404).end('{"message":"not found"}');
      return;
    }
    const rates = Object.entries(fake.rates)
      .map(([code, rate]) => `"${code}":${rate}`)
      .join(',');
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(`{"amount":1.0,"base":"USD","date":"${fake.date}","rates":{${rates}}}`);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  (fake as { url: string }).url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
