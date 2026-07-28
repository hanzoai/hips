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

`.hanzo/workflows/ci.yml` compares the index against `HIPs/` on every push and
FAILS on any of:

- a `README.md` link to a file that does not exist
- a spec in `HIPs/` unreachable from the index
- two files claiming one number
- frontmatter (`hip`, `title`, `status`, `author`) missing
- a `hip:` number disagreeing with its own filename

Every one of those has happened. Five specs were unreachable, two files both
claimed `hip: 0127`, and the check found three more unindexed on its first run.
The GitHub workflow it replaces printed the same errors and exited 0, so a HIP
with no status shipped green.

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

Copy `docs/templates/hip-template.md` to `HIPs/hip-<NNNN>-<slug>.md`, add its row
to the table in `README.md`, and keep the frontmatter number equal to the
filename. `ci.yml` enforces all of that, so a missing row fails the build rather
than going unnoticed.
