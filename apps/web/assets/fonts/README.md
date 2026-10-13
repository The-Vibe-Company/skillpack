# Open Graph image fonts

`next/og` cannot read WOFF2 or variable fonts, so the blog share images use static TrueType
instances of the site's own Inter Tight (`public/fonts/inter-tight-latin-wght-normal.woff2`):

- `inter-tight-semibold-latin.ttf`: `wght` 600
- `inter-tight-regular-latin.ttf`: `wght` 400

Both were produced with fontTools (`fontTools.varLib.instancer.instantiateVariableFont`) from that
file. Inter Tight is licensed under the SIL Open Font License 1.1 (`OFL-inter-tight.txt`).
