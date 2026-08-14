# Third-party notice — Beautiful UI

The `.tsx` files in this directory, other than `atoms.tsx`, are copied from
**Beautiful UI** (https://www.beautifului.dev/), a component library published
by Turbo. They are MIT licensed, and the MIT licence requires that this notice
travel with the copies — which is the entire reason this file exists rather
than the per-file headers being considered enough.

Changes made to the originals, in full:

- the Next-only `"use client"` directive removed (Vite has no such concept and
  esbuild warns about the stray top-level string on every build);
- imports of `@/components/atoms/Shimmer` and `@/components/atoms/StreamText`
  repointed at `./atoms.js` — those two atoms are imported by the published
  components but are not themselves published, so `atoms.tsx` reimplements
  their props;
- a `@ts-nocheck` header, because this project sets `noUncheckedIndexedAccess`
  and Beautiful UI does not.

No colours, spacing or class names were altered. The palette is set entirely by
redefining the semantic tokens in `beautiful-ui.css`, which is what makes these
files updatable: re-copying an upstream component is a copy, not a merge.

`atoms.tsx` is original work in this repository and is covered by the
repository's own licence, not the one below.

Two components are deliberately **not** vendored. `ChatComposer` and
`PromptBar` both depend on `glimm`, an npm package that declares no source
repository, and its only role in them is a decorative WebGL sweep. An
unauditable dependency that compiles and runs shaders is not worth a cosmetic
effect.

---

MIT License

Copyright (c) 2026 Shane Levine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
