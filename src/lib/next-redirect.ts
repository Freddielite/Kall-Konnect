/**
 * Returns a safe same-origin relative path from a `next` query param,
 * defaulting to "/".
 *
 * Browsers treat "\" like "/" in URLs, so "/\evil.com" is read as
 * "//evil.com" (an off-site redirect). React Router <7.18 doesn't catch
 * that either (GHSA-wrjc-x8rr-h8h6), so the check lives here: reject
 * backslashes and control characters outright, then confirm the result
 * resolves to this origin.
 */
export function safeNext(search: string): string {
  try {
    const next = new URLSearchParams(search).get("next");
    if (!next) return "/";
    if (!next.startsWith("/") || next.startsWith("//")) return "/";
    // eslint-disable-next-line no-control-regex
    if (/[\\\u0000-\u001f\u007f]/.test(next)) return "/";
    const base = "https://app.invalid";
    const resolved = new URL(next, base);
    if (resolved.origin !== base) return "/";
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return "/";
  }
}
