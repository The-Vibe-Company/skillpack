/** Plain text of inline Markdown: code spans, emphasis, links and escapes unwrapped. */
export function inlineMarkdownText(markdown: string): string {
  // Backslash-escaped punctuation is literal, so park it before the emphasis and link passes.
  const escaped: string[] = [];
  return markdown
    .replace(/\\([!-/:-@[-`{-~])/g, (_match, char: string) => `\uE000${escaped.push(char) - 1}\uE001`)
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/\uE000(\d+)\uE001/g, (_match, index: string) => escaped[Number(index)] ?? "")
    .trim();
}
