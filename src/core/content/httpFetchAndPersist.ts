import { fetchUrl } from './httpContentFetcher';
import { sha256Hex } from './hasher';
import { normalizeUrl } from '../../utils/urlValidator';
import { getDocument, upsertDocument } from '../vector/store/duckdbVectorStore';
import { generateCorrelationId } from '../../utils/logger';

export interface PersistResult {
  url: string;
  statusCode: number;
  notModified: boolean;
  etag?: string;
  lastModified?: string;
  bodyText?: string;
  contentHash?: string;
}
export async function fetchAndPersistDocument(
  inputUrl: string,
  correlationId?: string
): Promise<PersistResult> {
  const url = normalizeUrl(inputUrl);
  const cid = correlationId ?? generateCorrelationId();
  const existing = await getDocument(url, { correlationId: cid });

  const res = await fetchUrl(url, {
    etag: existing?.etag,
    lastModified: existing?.last_modified,
  });

  const nowIso = new Date().toISOString();

  if (res.notModified) {
    await upsertDocument(
      {
        url,
        title: existing?.title,
        etag: existing?.etag,
        last_modified: existing?.last_modified,
        last_crawled: nowIso,
        content_hash: existing?.content_hash,
      },
      { correlationId: cid }
    );
    return {
      url,
      statusCode: res.statusCode,
      notModified: true,
      etag: existing?.etag,
      lastModified: existing?.last_modified ?? undefined,
      contentHash: existing?.content_hash ?? undefined,
    };
  }

  const bodyText = res.bodyText;
  const contentHash = sha256Hex(bodyText);

  await upsertDocument(
    {
      url,
      title: existing?.title,
      etag: res.etag ?? existing?.etag,
      last_modified: res.lastModified ?? existing?.last_modified,
      last_crawled: nowIso,
      content_hash: contentHash,
    },
    { correlationId: cid }
  );

  return {
    url,
    statusCode: res.statusCode,
    notModified: false,
    etag: res.etag,
    lastModified: res.lastModified,
    bodyText,
    contentHash,
  };
}
