import { createHash } from 'crypto';

/**
 * Creates a SHA-256 hash hex string from input text.
 * Used for content hashing per specification: content_hash = sha256(extracted_main_text)
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Creates a stable chunk ID following the specification:
 * chunk_id = sha256(url + '|' + sectionPath + '|' + text)
 */
export function stableChunkId(
  url: string,
  sectionPath: string[] | undefined,
  text: string
): string {
  const path = sectionPath?.join('/') ?? '';
  return sha256Hex(`${url}|${path}|${text}`);
}
