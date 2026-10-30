/** Public request origin when Next's internal listener differs from the requested host. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto");
  if (protocol === "https" || protocol === "http") url.protocol = `${protocol}:`;
  const host = request.headers.get("host");
  if (host) {
    url.port = "";
    url.host = host;
  }
  return url.origin;
}
