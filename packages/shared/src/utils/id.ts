/**
 * ID generation. Uses crypto.randomUUID when available (Node 19+, all modern
 * browsers/Electron); falls back to a random hex string.
 */
export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}
