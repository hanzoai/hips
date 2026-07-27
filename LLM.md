# HIPs

Hanzo Improvement Proposals: the specs in `HIPs/`, indexed by `README.md`, and
the site at https://hips.hanzo.ai built from `docs/`.

## How this ships

One way, and it runs on our own stack:

    push  ->  github.com/hanzoai/hips        (a mirror)
              .github/workflows/sync.yml      carries refs onward
      ->  git.hanzo.ai/hanzoai/hips           CANONICAL
              .hanzo/workflows/ci.yml         checks the index
              .hanzo/workflows/deploy.yml     builds ghcr.io/hanzoai/hips
      ->  hanzoai/universe crs/hips.yaml      names the tag that is live
      ->  hanzoai/operator                    reconciles the App
      ->  hanzoai/static behind hanzoai/ingress serves hips.hanzo.ai

**git.hanzo.ai is canonical; GitHub is a mirror.** `.github/workflows/` holds
exactly one file, `sync.yml`, and its only job is getting refs to the forge. Every
build, check and deploy is a workflow under `.hanzo/workflows/`, which the forge
reads. `.hanzo/workflows` uses GitHub Actions syntax, so a workflow moves between
the two by changing directory and nothing else.

The forge takes the FIRST workflow directory that exists, so `.hanzo/workflows`
also shadows `.github/workflows` there — mirrored GitHub workflows cannot execute
on the forge by accident.

No GitHub Pages and no Cloudflare Pages. The site is an image the operator runs,
like every other Hanzo surface.

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

A build never deploys itself. `deploy.yml` publishes
`ghcr.io/hanzoai/hips:<sha>`; a human sets `spec.image.tag` in
`hanzoai/universe` `infra/k8s/operator/crs/hips.yaml` and adds `- hips.yaml` to
that directory's `kustomization.yaml`. The CR is inert until both are done, which
is deliberate: an App promoted with an empty tag takes the host down instead of
leaving it alone.

Order: publish an image -> set the tag -> add the line -> confirm the pod is
Running -> only then repoint `hips.hanzo.ai` off Pages.

## Writing a HIP

Copy `docs/templates/hip-template.md` to `HIPs/hip-<NNNN>-<slug>.md`, add its row
to the table in `README.md`, and keep the frontmatter number equal to the
filename. `ci.yml` enforces all of that, so a missing row fails the build rather
than going unnoticed.
