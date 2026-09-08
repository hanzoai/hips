# Implementation audit

Where each proposal's `implementation-go`, `implementation-cpp` and
`implementation-rust` came from. One row per verdict:

    <language>:<number>	<shipped|partial|none>	<evidence>

The evidence is a path and line, or a symbol, that a reader can check. A
verdict without its reasoning is a claim nobody can re-derive.

The audit read the code and looked for the proposal that specifies it, rather
than reading the corpus and guessing. **An absent key means that runtime was
never the language for this proposal** — the model and training specs are
Python, the frontend and docs HIPs are TypeScript, and saying `none` about
those would read as "we looked for Rust and found none" when the honest
statement is that Rust was never the question.

## Held back

A proposal whose status is `Final` while the audit found nothing implementing
it in Go is a contradiction: `Final` is defined as the thing existing in the
code, and `lint-hips.py` FM011 refuses the pair. Those values were NOT
written, because resolving one means deciding whether the proposal is really
Final or whether the search missed the code. Six here: HIP-0065, 0089, 0098,
0103, 0521 and 0902. HIP-0521 settles itself — its own section 136 reads "Not
yet implemented."
