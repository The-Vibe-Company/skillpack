/** Plain text of inline Markdown: code spans, emphasis, links and escapes unwrapped. */
export function inlineMarkdownText(markdown: string): string {
  // Backslash-escaped punctuation is literal, so park it before the emphasis and link passes.
  const escaped: string[] = [];
  return markdown
    .replace(/\\([!-/:-@[-`{-~])/g, (_match, char: string) => `${escaped.push(char) - 1}`)
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(\d+)/g, (_match, index: string) => escaped[Number(index)] ?? "")
    .trim();
}
