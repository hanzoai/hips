# HIPs

Hanzo Improvement Proposals: the specs in `HIPs/`, indexed by `README.md`, and
the site at https://hips.hanzo.ai built from `docs/`.

## How this ships

    push  ->  github.com/hanzoai/hips   main
      ->  .github/workflows/ci.yml       the lint, on every push
      ->  .github/workflows/deploy.yml   builds docs/out, publishes it
      ->  api.hanzo.ai/v1/projects/hips/deploy   the Sites plane
      ->  hips.hanzo.ai

Both workflows run on GitHub Actions, on the hanzoai org runner labelled
`linux-amd64`. The forge mirror runs no actions for hanzoai repos. **Actions must
be enabled on the repo** (`gh api repos/hanzoai/hips/actions/permissions`): with
it off nothing runs and nothing fails.

Check a publish by reading the page, not the run: `curl -s
https://hips.hanzo.ai/docs/<file-stem>/` must answer 200 and carry the new text.

The site is static files the Sites plane serves: no image, no CR, no pods, no
GitHub or Cloudflare Pages.

## What checks what

`scripts/lint-hips.py` is the only implementation of the rules; a contributor
and CI run the same files:

    python3 scripts/lint-hips.py          # exits 1 on any ERROR
    python3 scripts/lint-hips.py --list   # the checks, by code
    python3 scripts/test-lint-hips.py     # proves the lint FAILS when it should
    python3 scripts/index.py              # project HIPs/ onto README
    python3 scripts/index.py --check      # exits 1 if README has drifted
    python3 scripts/test-index.py         # proves the generator REFUSES

The lint's self-test copies the corpus, breaks it once per check, and requires
the matching error code each time; a check without a test fails it. CI runs the
self-tests before the checks they test.

Checks are `FM*` front matter, `ST*` structure, `LK*` links, `IX*` numbering,
`PL*` policy. Two policy checks are narrow on purpose:

- **PL001** fires only when a comparative phrase sits within 80 characters of a
  *named* third-party product, and not on weighing two candidate upstream
  dependencies against each other.
- **PL002** fires on a specific private-org repository path, not the bare org
  name. HIP-0135 is exempt: it draws the line, so it names both sides.

## One index, generated

`HIPs/*.md` front matter is the only authority for what a HIP is. The site reads
`../HIPs` directly; `README.md`'s two tables are projected by `scripts/index.py`.

The generator writes nothing until everything validates: rows equal files
exactly, a table that shrinks says by how many (`--delete N`), a section that
cannot be rebuilt is an error, and every `requires:` resolves.
`scripts/test-index.py` breaks the corpus and requires each break to refuse and
leave `README.md` byte-identical. `scripts/index.py --check` regenerates in
memory and compares; that is how CI holds README to the files.

The vocabulary lives in `vocabulary.json`, which the lint, the generator and the
doc site all read.

**No committed index.** If one is needed, generate it during the build.

## Deploying the site

`deploy.yml` builds the static export and publishes it through `hanzoai/ci`'s
`site` action:

    pnpm build -> docs/out
      -> POST /v1/projects/hips/deploy {"source":"git"}   202 + an upload grant
      -> POST each file under the grant                   bytes skip the API
      -> POST .../deployments/<id>/complete {status,keys}

This repo holds no S3 credential. The 202 carries a presigned POST policy
confined to this site's prefix, expiring in 30 minutes. CI reports its manifest
as `keys` on completion and cloud prunes the prefix, because a write-only grant
cannot delete.

The deploy key is in KMS. The workflow passes only `KMS_CLIENT_ID` and
`KMS_CLIENT_SECRET` (hanzoai org secrets); the action reads the key from KMS at
run time.

## Writing a HIP

Copy `docs/templates/hip-template.md` to `HIPs/hip-<NNNN>-<slug>.md`, then run
`python3 scripts/index.py` and `python3 scripts/lint-hips.py`.

It lands as `Draft`. It becomes `Final` when the thing it specifies exists in the
code; nothing else moves a status. `Meta` and `Process` HIPs are `Living`:
amended in place, never finished.

A HIP states the design as it is: no revision history, dates or incident notes
in the text.

**One thing we build → one public repo → one HIP.** A Standards Track HIP
describes something that exists; `type: Process` is for how we work and need not
map to a repository. Before writing a HIP, check whether the thing already has
one, and rewrite that one rather than duplicate it.
