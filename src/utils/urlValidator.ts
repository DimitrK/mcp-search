const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
};

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'igshid',
  'mc_cid',
  'mc_eid',
]);

export function isHttpUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const removeTrackingParams = (params: URLSearchParams): void => {
  for (const key of Array.from(params.keys())) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
};

const sortParams = (params: URLSearchParams): string => {
  const sorted = new URLSearchParams();
  Array.from(params.keys())
    .sort()
    .forEach(k => sorted.append(k, params.get(k)!));
  return sorted.toString();
};

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported');
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (url.port && DEFAULT_PORTS[url.protocol] === url.port) {
    url.port = '';
  }

  url.hash = '';

  const params = new URLSearchParams(url.search);
  removeTrackingParams(params);
  url.search = sortParams(params);

  let pathname = url.pathname;
  if (!pathname) pathname = '/';
  pathname = pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  url.pathname = pathname;

  return url.toString();
}
