import { createHash } from 'crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function stableChunkId(
  url: string,
  sectionPath: string[] | undefined,
  text: string
): string {
  const path = sectionPath?.join('/') ?? '';
  return sha256Hex(`${url}|${path}|${text}`);
}
