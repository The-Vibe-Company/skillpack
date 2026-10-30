/** Select only headers that the deployment's ingress overwrites before reaching the API. */
export function betterAuthIpAddressHeaders(configured = process.env.BETTER_AUTH_IP_HEADERS): string[] {
  if (!configured?.trim()) return ["x-real-ip"];
  const headers = [...new Set(configured.split(",").map((header) => header.trim().toLowerCase()).filter(Boolean))];
  if (!headers.length || headers.some((header) => !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(header))) {
    throw new Error("BETTER_AUTH_IP_HEADERS must be a comma-separated list of HTTP header names");
  }
  return headers;
}
