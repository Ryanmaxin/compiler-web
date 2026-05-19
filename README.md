<<<<<<< HEAD
# Joos Frontend

This app keeps the simple left/right layout, but the right side is now an
inspector instead of only a raw output pane.

What it can show:

- clickable compiler pipeline stages
- token stream for the active file
- collapsible tree views from the compiler debug artifacts
- diagnostics panel with best-effort file/line hints
- generated assembly
- runtime output
- curated sample notes, feature checklist, and architecture overview

## Why there is a backend now

I tried the `js_of_ocaml` route first with a repo-local opam setup.

That path is not enough for your full goal right now because:

1. Your compiler emits x86 assembly, and the browser cannot directly assemble, link, and execute that native output.
2. Your current compiler also depends on filesystem-based parser/stdlib loading and file-based backend emission.
3. The local `js_of_ocaml` toolchain setup was already turning into infrastructure work before the compiler adaptation even began.

Because you said it should actually work, this version falls back to a tiny backend that runs the real compiler executable.

## Inspectability details

The inspector uses real compiler artifacts, not mocked data:

1. `dune exec scanner -- <file>` for token streams
2. `joosc --debug` for the frontend/resolved/hierarchy/disambiguated/typechecked/pre-backend trees
3. `joosc --a5` for assembly generation
4. `nasm` + `ld` + the generated executable for runtime output

One limitation is that `joosc` does not currently expose precise source
positions in its diagnostics, so editor-inline squiggles are not fully
trustworthy yet. The diagnostics panel uses the compiler's real error messages
plus a conservative best-effort location hint when it can infer one from the
message.

## Commands

```bash
npm install
npm run dev
```

That starts:

- the Vite frontend
- a small Express server on port `3001`

The frontend calls `POST /api/run`, which:

1. writes all source files to a temp directory
2. runs `/u6/rsmaxin/cs444/joos1w-compiler/joosc`
3. captures the generated assembly
4. assembles, links, and runs the produced binary
5. returns output to the UI
=======
# compiler-web
>>>>>>> 4b95065f7228743fb99d2d231114dd8f07180665
