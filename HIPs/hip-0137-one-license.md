---
hip: 0137
title: One License
author: Hanzo AI
type: Process
category: Governance
status: Living
created: 2026-08-04
requires: HIP-0135
---

# HIP-0137: One License

## Abstract

Original Hanzo work is licensed **`MIT OR Apache-2.0`**. One expression, one
file layout, every repository. The consumer picks whichever of the two suits
them; we do not decide for them, and we do not decide it repository by
repository.

Two things this document exists to stop. A fork's license is not ours to
change. A license's text is not ours to edit.

## Motivation

`hanzoai/ml` shipped a file named `LICENSE` that called itself the Apache
License 2.0 and was not. Its body carried three alterations to operative text.
The one that matters sat inside §4(d), the attribution clause:

    canonical    excluding those notices that do not pertain to any part of
    ours         excluding any notices that do not pertain to any part of

One word. `those` refers back to the notices enumerated in the upstream NOTICE
file; `any` refers to nothing and excludes at the reader's discretion. The
altered clause lets a redistributor drop attribution we were obliged to carry
forward — which is the single obligation Apache-2.0 asks of anyone, and the
reason candle's authors are named in our tree at all.

Nobody set out to weaken the clause. Someone reflowed a license file. That is
the whole failure mode, and it is why §3 below is absolute rather than
sensible: there is no review process that reliably catches one word in eleven
thousand bytes, so the rule has to be *never edit the file*, enforced by hash.

The estate had also drifted to four answers for one question. Original Hanzo
repositories variously declared `BSD-3-Clause`, `BSD-3-Clause OR Apache-2.0`,
bare `Apache-2.0`, bare `MIT`, and — worst — nothing at all. Four answers is not
a convention with exceptions. It is the absence of one.

## Specification

### 1. Original work is `MIT OR Apache-2.0`

Every repository of our own new code, in `hanzoai`, carries exactly this SPDX
expression. Not one or the other. Both, with the choice belonging to whoever
uses it.

- **MIT** is the simplest license in wide use. A reader understands it in full,
  in one sitting, without counsel.
- **Apache-2.0** adds an express patent grant and a patent-retaliation
  termination clause. MIT has neither, and a corporate consumer's lawyer will
  ask for both.
- **Together** they cover the two audiences without either one arguing. The
  consumer takes MIT for simplicity or Apache-2.0 for the patent grant.

This is the Rust ecosystem's default and it is what **candle** carries — our
own largest upstream. Matching it means our forks of candle need no relicensing
argument at all: the target and the inheritance are already the same
expression.

`Apache-2.0` alone is not a defect and does not require a migration; it is one
half of the standard. But new work states both.

### 2. The file layout

    LICENSE-MIT       canonical MIT text, our copyright line
    LICENSE-APACHE    canonical Apache-2.0 text, byte-identical, unmodified
    LICENSE           the dual declaration, pointing at both
    NOTICE            only where §5 requires it

In the manifest, whichever the language uses:

    Cargo.toml        license = "MIT OR Apache-2.0"
    package.json      "license": "MIT OR Apache-2.0"
    pyproject.toml    license = "MIT OR Apache-2.0"
    go.mod            (no license field; the files govern)

In the README, one line. Not a section, not a table, not a restatement of the
rule — one line naming the expression and linking here.

Two failures are specific to this layout and both have already happened here.

**`LICENSE` must be the dual declaration, not a copy of one of the two texts.**
If `LICENSE` is byte-identical to `LICENSE-APACHE`, then a reader who opens the
file the ecosystem tells them to open sees Apache-2.0 and nothing else — the MIT
option is silently gone, whatever the manifest says. Check it by hash: `LICENSE`
and `LICENSE-APACHE` having the *same* hash is the bug, not the confirmation.

**`LICENSE-MIT` must carry a copyright holder line.** MIT's operative sentence
is "the above copyright notice ... shall be included in all copies." A
`LICENSE-MIT` that opens on "Permission is hereby granted" has no *above*
notice, so the clause points at nothing and the license conveys no attribution
at all. The word "copyright" appearing twice in the body is not a holder line.

### 3. License text is canonical and is never edited

A license is a document with a name. Change its operative text and it is no
longer that document, whatever the file is called. There is no such thing as
"our Apache-2.0."

The canonical Apache-2.0 is fixed and checkable:

    source     https://www.apache.org/licenses/LICENSE-2.0.txt
    size       11358 bytes
    sha256     cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
    git blob   d645695673349e3947e8e5ae42332d0ac3164cd7

Verify with `sha256sum`, `cmp`, or `git hash-object`. The copyright line goes in
`LICENSE-MIT` and in `NOTICE`, never inside the Apache body — Apache-2.0 carries
its ownership in the appendix and in `NOTICE`, not by amendment.

This applies to reflowing, re-wrapping, changing whitespace, "fixing" the
appendix, and substituting our name for the placeholder. If the hash does not
match, the file is not the license.

### 4. A fork carries its upstream's license, and cannot be relicensed

We may not relicense code we did not write. Not to `MIT OR Apache-2.0`, not to
anything. The upstream license came with conditions and one of them is that it
travels with the code.

Concretely, on any fork:

- the upstream `LICENSE` / `COPYING` / `AUTHORS` files are **not edited**, not
  even to add us;
- **the upstream copyright line stays inside the LICENSE file.** MIT requires
  that "the above copyright notice and this permission notice shall be included
  in all copies"; AGPL and GPL require the notice be kept intact in place.
  Moving the line to `NOTICE` and cleaning the `LICENSE` does not satisfy
  either — the obligation names the license file;
- a `NOTICE` naming the upstream project and its holder is added alongside.

Renaming a fork for our brand is expected. Restyling its license is not, and the
distinction is not cosmetic. A branding pass in this estate retitled Papermark's
commercial license and swapped the copyright holder over code that was 100%
upstream. Nothing was gained and the grant we relied on was breached.

Ancestry is established from **evidence**, never from a description or a docs
page: the copyright holder named in the LICENSE, the root or import commit,
foreign copyright headers in the sources, upstream import paths, and GitHub's
`parent` field. `hanzo/s3` publicly described itself as a fork of MinIO under
AGPL for months; it is SeaweedFS under Apache-2.0. Wrong ancestry and wrong
license, published together, because the description was believed.

GitHub's `fork` flag is **not** evidence. A repository imported by pushing a
clone reports `fork: false` and has no `parent`. Absence of a parent proves
nothing about authorship.

**Establish ancestry across every ref, not the default branch.** Foreign history
hides one branch away, and the default branch is the one place it reliably is
not. In this estate: a repository badged BSD-3-Clause carried GPL-3.0 upstream
code on two `backup/` and `rescue/` branches; another shows a five-commit
grafted `main` that conceals the real 176-commit upstream lineage on `master`;
a third's true origin sits on a `master` that is not an ancestor of `main` at
all. A default-branch audit clears all three. `git log --all`, and list the
roots — a repository with several unrelated root commits is several
repositories, and they may not share a license.

### 5. NOTICE is an Apache-2.0 obligation, and only that

Apache-2.0 §4(d) is the only one of our licenses that requires a `NOTICE` file
to be propagated. MIT, BSD and GPL discharge attribution by retaining the
copyright line in the license file itself, per §4.

Do not invent obligations that do not exist. A `NOTICE` is not required on an
MIT-only repository and claiming otherwise trains people to ignore the ones that
are required.

That said: a `NOTICE` naming upstreams is good practice on **any** fork,
regardless of license. It is the cheapest possible way to say where the code
came from, and it puts the answer where the next reader will look.

### 6. Relicensing requires holding the copyright

You cannot relicense what you do not own. Before assuming a repository is
single-origin:

    git shortlog -sne <default-branch>

Then dedupe by *identity*, not by email string — one person with three addresses
is one identity — and discount bots, which author nothing copyrightable.

Work by employees and contractors is work-for-hire and its copyright is the
company's; a contributor who is not the founder is not thereby an outside
party, and treating them as one blocks decisions that were never blocked. What
genuinely blocks is a **third-party** contributor. Their contributions need
their assent or a prior IP assignment. That is a paperwork question and it does
not have a git answer — resolve it or leave the license alone.

The same test applies at file granularity. `hanzoai/ml`'s `hanzo-bindgen-cuda`
stays MIT rather than going dual, because it derives from Nicolas Patry's MIT
`bindgen_cuda` and not from candle. One crate in thirty-one, correct on its own
facts.

Where a repository mixes our code with a weak-copyleft upstream, declare the
split rather than relicensing either side. EPL-2.0 §3.1 is file-level: the
EPL-covered files stay EPL, our files are `MIT OR Apache-2.0`, `NOTICE` lists
which paths are which. Whole-repository relicensing in either direction is
wrong — one way strips a grant, the other over-corrects.

### 7. Already-published metadata is not retracted

A published package version's license metadata is immutable. Correct the
repository, correct subsequent releases, and leave prior versions alone: the
LICENSE files govern, and yanking breaks every consumer in order to fix a
label. `hanzoai/ml` has 191 published crates.io versions carrying the previous
expression and none were yanked.

The corollary is that **a relicense is not finished when the repository merges.**
Some registries read the license from the repository at a tag, and those follow
along; others bake it into the published artifact, and those keep serving the
old expression until a release is cut, however correct the default branch looks.
Go modules are the first kind. npm is the second — the `license` field ships
inside the tarball. So the last step is a release, and until it happens the
registry and the repository disagree in public. That disagreement is invisible
precisely because the repository looks right, which is how it survives for
months.

### 8. BSD-3-Clause is out of scope for `hanzoai`

`BSD-3-Clause` and `BSD-3-Eco` are not used for original Hanzo work. They remain
available to `luxfi` and `zoo`, which is where the estate's BSD lineage lives.
This is a scoping decision, not a judgement about BSD.

BSD-3-Clause appearing on a `hanzoai` repository means one of two things, and
they are handled differently:

- **inherited** from a genuine BSD upstream — correct, leave it (§4);
- **applied by us** to our own code — a drift to correct to `MIT OR Apache-2.0`.

Tell them apart by the copyright holder in the LICENSE. "Copyright (c) 2015,
Pierre Curto" is an upstream we forked. "Copyright (c) 2026, Hanzo AI, Inc." on
a BSD-3-Clause file is ours, and is drift.

**Do not pin the check to the SPDX form.** A repository that never adopted SPDX
carries its terms in free text — `// Copyright (c) 2026, Hanzo AI, Inc.
BSD-3-Clause.` — and a scan for `SPDX-License-Identifier:\s*BSD-3-Clause`
returns a clean, confident zero over all of it. That happened during this
audit's own sweep: the SPDX pattern reported zero across eight repositories and
twelve real BSD headers were sitting in the tree. The check is *"does any
tracked file name a license"*, then classify what it finds. A confident zero is
worse than a noisy positive, because nobody runs it twice.

There is a third case, and it resolves to the second. A `hanzoai` repository may
hold a copy of code that originated in `luxfi` or `zoo` — same estate, different
entity, and those orgs are BSD by standard. Its LICENSE names Lux or Zoo as the
holder, not Hanzo. **That is an upstream like any other and §4 governs: leave the
license alone.** Being able to reach the copyright holder over lunch does not
make the code ours to relicense; the holder is a different legal entity and the
relicense is that entity's decision to make, deliberately, not a sweep's to
assume.

## Rationale

**Why dual rather than picking one.** Choosing for the consumer buys us nothing
and costs us the consumer who needed the other. Dual is not indecision; it is
declining to impose a decision that is theirs.

**Why this updates HIP-0135 §3.** HIP-0135 set Apache-2.0 for our own new code,
and its reasoning — explicit patent grant, attribution without reciprocity —
holds unchanged and is half of this rule. Adding MIT alongside costs one file
and removes the friction Apache-2.0 has with MIT-only ecosystems, chiefly Rust,
where we do most of our upstream work. Everything else in HIP-0135 stands: the
four states, the competition test, and that public-and-unlicensed is a defect.

**Why §3 is absolute.** Every alteration in the `hanzoai/ml` license was
plainly innocent. That is exactly the problem — a rule that depends on catching
a bad edit fails against good-faith ones. A hash does not.

**Why forks are strict.** Attribution is the cheapest condition any license
imposes. Stripping it saves nothing, and it is the one breach that costs the
grant.

## References

- HIP-0135 — What Is Public (§3 is updated by this document)
- MIT License — https://spdx.org/licenses/MIT.html
- Apache License, Version 2.0 — https://www.apache.org/licenses/LICENSE-2.0.txt
- Eclipse Public License 2.0 §3.1 — https://www.eclipse.org/legal/epl-2.0/
- `hanzoai/ml`, branch `legal/dual-mit-apache` — the worked example
