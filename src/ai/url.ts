export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function joinUrl(baseUrl: string, suffix: string): string {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (suffix.startsWith("/")) {
    return `${normalizedBase}${suffix}`;
  }
  return `${normalizedBase}/${suffix}`;
}

export function joinVersionedPath(baseUrl: string, versionSegment: string, pathAfterVersion: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const version = trimSlashes(versionSegment);
  const path = ensureLeadingSlash(pathAfterVersion);

  if (!version) {
    return `${base}${path}`;
  }

  const versionSuffix = `/${version}`;
  if (base.toLowerCase().endsWith(versionSuffix.toLowerCase())) {
    return `${base}${path}`;
  }

  return `${base}${versionSuffix}${path}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function ensureLeadingSlash(value: string): string {
  if (value.startsWith("/")) {
    return value;
  }
  return `/${value}`;
}
