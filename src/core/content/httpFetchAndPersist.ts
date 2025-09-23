import { fetchUrl } from './httpContentFetcher';
import { sha256Hex } from './hasher';
import { normalizeUrl } from '../../utils/urlValidator';
import { getDocument, upsertDocument } from '../vector/store/duckdbVectorStore';

export interface PersistResult {
  url: string;
  statusCode: number;
  notModified: boolean;
  etag?: string;
  lastModified?: string;
  bodyText?: string;
  contentHash?: string;
}
export async function fetchAndPersistDocument(inputUrl: string): Promise<PersistResult> {
  const url = normalizeUrl(inputUrl);
  const existing = await getDocument(url);

  const res = await fetchUrl(url, {
    etag: existing?.etag,
    lastModified: existing?.last_modified,
  });

  const nowIso = new Date().toISOString();

  if (res.notModified) {
    await upsertDocument({
      url,
      title: existing?.title,
      etag: existing?.etag,
      last_modified: existing?.last_modified,
      last_crawled: nowIso,
      content_hash: existing?.content_hash,
    });
    return {
      url,
      statusCode: res.statusCode,
      notModified: true,
      etag: existing?.etag,
      lastModified: existing?.last_modified,
      contentHash: existing?.content_hash,
    };
  }

  const bodyText = res.bodyText;
  const contentHash = sha256Hex(bodyText);

  await upsertDocument({
    url,
    title: existing?.title,
    etag: res.etag ?? existing?.etag,
    last_modified: res.lastModified ?? existing?.last_modified,
    last_crawled: nowIso,
    content_hash: contentHash,
  });

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
