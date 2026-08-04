# HIPs

Hanzo Improvement Proposals: the specs in `HIPs/`, indexed by `README.md`, and
the site at https://hips.hanzo.ai built from `docs/`.

## How this ships

One way, and it runs on our own stack:

    push  ->  github.com/hanzoai/HIPs        (development lands here)
      ->  git.hanzo.ai/hanzoai/hips           CANONICAL
              .hanzo/workflows/sync-from-github.yml  PULLS main, every 10 min
              .hanzo/workflows/ci.yml                checks the index
              .hanzo/workflows/deploy.yml            builds + publishes the site
      ->  api.hanzo.ai/v1/projects/hips/deploy  the Sites plane
      ->  hips.hanzo.ai

**git.hanzo.ai is canonical; GitHub is where people push.** Every check and
deploy is a workflow under `.hanzo/workflows/`, which the forge reads.
`.hanzo/workflows` uses GitHub Actions syntax, so a workflow moves between the
two by changing directory and nothing else.

The forge takes the FIRST workflow directory that exists, so `.hanzo/workflows`
also shadows `.github/workflows` there — mirrored GitHub workflows cannot execute
on the forge by accident.

**The sync is a PULL, and that direction is load-bearing.** It used to be a push
from `.github/workflows/sync.yml`; `3047c73` deleted that on the belief the Hanzo
GitHub App webhook had superseded it. No such webhook exists on this repo, so the
forge froze at `9f792bf` while GitHub moved on 15 commits, `deploy.yml` never
reached a runner, and the site stopped publishing for a day without failing
anything. A pull cannot fail that way: it needs no credential (this repo is
public), no webhook, and no GitHub runner — and hanzoai currently has **zero**
online GitHub runners, which is why the old push job queued for hours and never
ran. Fast-forward only; a divergence fails loudly rather than force-pushing.

No GitHub Pages and no Cloudflare Pages. The site is static files the Sites plane
serves — no image, no CR, no pods, because nothing here executes.

## What checks what

**One lint, two callers.** `scripts/lint-hips.py` is the only implementation of
the rules, and both a contributor and CI run the same file:

    python3 scripts/lint-hips.py          # exits 1 on any ERROR
    python3 scripts/lint-hips.py --list   # the checks, by code
    python3 scripts/test-lint-hips.py     # proves the lint FAILS when it should

`.hanzo/workflows/ci.yml` used to carry its own copy of the checks as an inline
heredoc. That meant the gate existed only on the forge and a failure could not be
reproduced without pushing. It now calls the script, and calls the self-test
first.

The self-test copies the corpus, breaks it 22 ways — one per check — and requires
the matching error code each time. It also asserts that every check the lint
declares has a test, so adding a check without one fails. This matters here more
than most places: the GitHub workflow this lineage replaced printed every missing
field and then exited 0, so a HIP with no status shipped green. **A check that
has only been seen to pass has not been shown to work.**

Checks are `FM*` front matter, `ST*` structure, `IX*` index, `PL*` policy. Each
fired on a real defect when it was written: 101 H1 headings disagreeing with their
own front matter, 16 files with no H1 at all, 9 files using a status word outside
the vocabulary, a `requires:` pointing at a HIP that never existed, 5 duplicate
headings, and 4 subsections numbered outside their parent section.

Two policy checks are worth knowing about because both were wrong on the first
attempt and had to be narrowed:

- **PL001** fires only when a comparative phrase sits within 80 characters of a
  *named* third-party product. Firing on the phrase alone reported 15 lines of
  which 12 were ordinary English ("only as good as the source behind it"). It
  deliberately does NOT fire on weighing two candidate upstream dependencies
  against each other — that is engineering rationale, not a claim about us.
- **PL002** fires on a specific private-org repository path, not the bare org
  name. HIP-0135 is exempt: it is the document that draws the line, so it must be
  able to name both sides.

## One index, generated

`HIPs/*.md` front matter is the only authority for what a HIP is. The site reads
`../HIPs` directly; `README.md`'s table is projected by `scripts/update-index.py`
and verified row-by-row by the lint (title, type, category and status must all
match the file).

Four committed `hip-index.json` files used to exist alongside it. They are gone.
`docs-old/` — 16 tracked files including its own index — described **25** HIPs
while 138 existed, and claimed four (16, 21, 22, 23) that do not exist at all;
nothing referenced it. `docs/hip-index.json` and `docs/site/hip-index.json` were
generated-and-committed, already 3 behind, and read only by `docs/site/index.html`,
which is not in the deployed export. **Do not reintroduce a committed index.** If
one is needed, generate it during the build.

## Deploying the site

`deploy.yml` builds the static export and publishes it to the Sites plane. There
is no image, no CR and no operator step: this is a Next.js export, ~170 MB of
files that never execute, and baking them into a container so a Go binary can
serve `/public` buys nothing.

    pnpm build -> docs/out
      -> POST /v1/projects/hips/deploy {"source":"git"}   202 + an upload grant
      -> POST each file under the grant                   bytes skip the API
      -> POST .../deployments/<id>/complete {status,keys}

**This repo holds no S3 credential.** It used to need the `hanzo-sites` bucket
keys — one shared bucket separated only by key prefix, so those keys were write
access to every org's site. The 202 now carries a presigned POST policy confined
to this site's prefix and expiring in 30 minutes. Deletion moved with it: CI
reports its manifest as `keys` on completion and cloud prunes the prefix, because
a write-only grant cannot delete.

The one secret is `HANZO_DEPLOY_TOKEN`, which identifies us rather than granting
storage. It is set **on the forge**, since `.hanzo/workflows/` is what the forge
reads; GitHub's secret store is not in this path at all.

## Writing a HIP

Copy `docs/templates/hip-template.md` to `HIPs/hip-<NNNN>-<slug>.md`, then run
`python3 scripts/update-index.py` and `python3 scripts/lint-hips.py`.

The template exists now. It did not until 2026-08-04, although this file had told
every author to copy it for months — which is the simplest explanation for why
138 HIPs drifted into four H1 styles, eight status words and three different
spellings of "Security Considerations".

**One thing we build → one public repo → one HIP.** A Standards Track HIP
describes something that exists; `type: Process` is for how we work and is not
expected to map to a repository.

Measured on 2026-08-04, the corpus is a long way from that rule and it is worth
knowing before adding to it:

- **96 of 121** public `hanzoai` repositories are named by no HIP.
- **69 of 123** Standards Track HIPs name no `hanzoai` repository at all.
- **24** Standards Track HIPs specify only PRIVATE repositories — including
  HIP-0106 (`cloud`), HIP-0027 (`kms`), HIP-0068 (`ingress`) and the whole
  CRD family (`operator`). By HIP-0135's own rule a private repository in
  `hanzoai` is mislabelled or in the wrong org, so the fix is to publish, not to
  withdraw the HIP.
- **Fragmentation:** 19 HIPs describe `operator`, 7 describe `cloud`.

Before writing a new HIP, check whether the thing already has one. HIP-0041 was
rewritten rather than duplicated for exactly this reason: a brief asserted no CLI
HIP existed, and HIP-0041 had specified the CLI since February.
