/** Returns a safe same-origin relative path from a `next` query param, defaulting to "/". */
export function safeNext(search: string): string {
  try {
    const next = new URLSearchParams(search).get("next");
    if (!next) return "/";
    if (!next.startsWith("/") || next.startsWith("//")) return "/";
    return next;
  } catch {
    return "/";
  }
}
