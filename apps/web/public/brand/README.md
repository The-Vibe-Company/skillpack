# Skillpack brand assets

The September 2026 brand kit supplies the orange/amber/yellow S mark, monochrome
variants, app tiles, wordmarks, lockups, and favicons. Product surfaces use
`skillpack-mark.svg`; browser metadata uses `skillpack-favicon.svg` and the supplied
PNG favicon sizes. Next.js file-based icons mirror the 32px and 180px PNGs.

The four wordmark/lockup SVGs have Space Grotesk 600 text converted to paths, so
image rendering does not depend on an installed font or network access. Interface
text continues to use system fonts.

`skillpack-mark.png` is a 512px raster export for server-rendered social cards.
The `companion-*.png` paths remain compatibility aliases containing the new brand:
existing GitHub mirror READMEs link to the light/dark wordmark PNGs. The wordmarks
are exported at 1040 by 220 pixels. Do not remove these public aliases without
migrating already-published consumers.

`og.png` is generated from `scripts/og/og-preview.html` at 1200 by 630 pixels.
