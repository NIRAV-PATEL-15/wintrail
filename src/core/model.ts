export const MAX_ENTRY_CHARS = 500;

/** "!Cut latency #perf" → star, tags parsed (lower-cased, unique); tags stay visible in the text. */
export function parseQuickAdd(raw: string): { text: string; star: boolean; tags: string[] } {
  let text = String(raw ?? "").trim();
  const star = text.startsWith("!");
  if (star) text = text.slice(1).trim();
  text = text.slice(0, MAX_ENTRY_CHARS);
  const tags = [...new Set([...text.matchAll(/#([\w-]+)/g)].map((m) => m[1].toLowerCase()))];
  return { text, star, tags };
}
