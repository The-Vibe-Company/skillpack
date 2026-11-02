import { preload } from "react-dom";

/** Inter Tight, the marketing display face declared in styles/landing.css. */
export const DISPLAY_FONT_URL = "/fonts/inter-tight-latin-wght-normal.woff2";

/**
 * Fetch the display face alongside the stylesheets instead of after them, so marketing headings (the
 * home LCP heading among them) paint in their final font without a swap that shifts the page.
 * Call it only from marketing surfaces: product pages never use this font.
 */
export function preloadDisplayFont(): void {
  preload(DISPLAY_FONT_URL, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
}
