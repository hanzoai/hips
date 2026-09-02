---
hip: "0041"
title: The Hanzo CLI — a Projection of the Served API
author: Hanzo AI
type: Standards Track
category: Interface
status: Final
created: 2026-02-23
updated: 2026-08-04
requires: HIP-0040, HIP-0111, HIP-0119, HIP-0128, HIP-0135
---

# HIP-0041: The Hanzo CLI — a Projection of the Served API

## Abstract

`github.com/hanzoai/cli` is the terminal surface of Hanzo Cloud: one binary,
`hanzo`, whose command tree is **generated from the API document the cloud
serves** rather than written by hand. Every operation the cloud publishes is
reachable as a command, and no command exists that the cloud does not publish.

That is the whole design, and everything else in this document follows from it.
A hand-written CLI drifts from its API the moment either changes, and the drift
is invisible until a user runs the command. A generated one cannot drift in one
direction at all: **a projection cannot describe a route its source lacks.**
Commands that do not exist upstream are impossible by construction, not by
diligence.

This HIP replaces its own earlier contents. The previous revision specified a
hand-written Go binary with a fixed command list (`hanzo chat`, `hanzo complete`,
`hanzo deploy`), a plugin system and an auto-updater. The CLI is written in Rust,
its commands are generated, and none of that command list survives. A
specification that describes something nobody built is worse than none, because
it gets quoted.

**Numbers here were measured on 2026-08-04**, each against the artifact named
beside it. Re-measure before quoting one.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The generation chain

The command tree MUST be derived from the API document the cloud serves, by this
chain and no other:

    cloud@<ref>/openapi.yaml
      -> genspec     -> spec/cloud.json
      -> genproduct  -> src/commands/product/generated.rs   (committed)

Four properties are normative:

1. **Generation happens at maintainer time, not at build or run time.** `genspec`
   sits behind a cargo feature of that name; there is no `build.rs`. The shipped
   binary parses no YAML and fetches no document. A CLI that reads a remote
   document at startup fails when the network does, and produces a different
   command tree for two users on one version.

2. **The generated source is committed.** It is reviewable, and the diff of a
   regeneration is the diff of the API surface. A capability appearing or
   disappearing shows up as lines in a pull request.

3. **The source is pinned by content, not by name.** `.spec-lock` records the
   repository, the path, the ref and the SHA-256 of the document that generation
   consumed. A ref alone is a moving target; the digest is what makes a
   regeneration reproducible.

4. **There is no default source, and guessing is refused.** `genspec` fails
   rather than assume which deployment a captured document describes — a host
   cannot say which deploy a capture came from, and a wrong guess produces a
   command tree that is confidently wrong. **Refusing to guess is a feature and
   MUST be preserved.**

### §2 The invariant, and its honest limit

**Phantom commands are impossible by construction.** Every command is projected
from an operation in the source document, so a command naming a route the cloud
does not serve cannot be generated. This direction of the invariant is
structural and needs no gate to hold.

The other direction is *not* structural. An operation the cloud serves may fail
to reach the CLI — because the pin is behind, because the operation is
unreachable in the projection, or because the document itself is inconsistent.
That direction MUST be measured by a gate comparing the generated tree against
the served document, reporting three counts:

- **present** — served and reachable as a command;
- **absent** — served and not reachable; a defect in this repository;
- **unfalsifiable** — the comparison cannot decide. This count MUST be reported
  rather than folded into either bucket. A gate that silently treats what it
  cannot check as passing is not a gate.

**Current result, and it is red.** The gate exits non-zero today: `2036 present,
8 absent, 177 unfalsifiable; products reachable 174 of 181`, plus six routes
under `/v1/ai/*` where the served document contradicts itself about its own
paths. Two of the reported phantoms are deliberately injected fixtures that prove
the gate detects them.

This HIP does not claim the surface is drift-free. It claims the invariant makes
one direction of drift impossible and requires the other direction to be counted.
**A standard that asserts a property its own gate disproves is worthless exactly
when it matters.** Closing the 8 and resolving the 177 is the work; the six
self-contradictions are a cloud defect and MUST be fixed there, not absorbed by
the projection.

### §3 Command grammar

    hanzo <product> [<node>...] <verb> [flags]

The tree is **variable-depth**, not two-level, because the API's own resource
nesting is. Measured depth distribution over the generated tree — intermediate
nodes between product and verb:

| Intermediate nodes | Commands |
|---:|---:|
| 0 | 655 |
| 1 | 1,040 |
| 2 | 355 |
| 3 | 74 |
| 4 | 5 |

The deepest real command is `hanzo iam scim v2 Users owner get`. A specification
fixing the grammar at `<product> <verb>` would describe 655 of 2,129 commands.

Rules:

1. `<product>` MUST be the first path segment after `/v1/`. The path is the
   authority for the name; there is no second list of product names to maintain.
2. Intermediate nodes MUST follow the resource nesting of the path, in order.
3. `<verb>` MUST be derived from the operation, and the same operation MUST
   produce the same command name on every regeneration.
4. A command name MUST NOT be hand-assigned. An operation whose generated name is
   wrong is fixed by fixing the operation upstream, which fixes it for the SDKs
   and the documentation in the same change.

Measured today: **2,127** commands at `HEAD` (2,129 in the working tree) against
**2,341** operations in the served document. These count different artifacts —
the generated tree and the live document — and MUST always be quoted as a pair
with the artifact named, never merged into one figure.

### §4 Typed arguments, and the 469

An operation with a typed request body MUST project to typed flags: one flag per
field, carrying the field's type, its documentation as help text, and required
fields enforced before any request is sent.

An operation **without** a typed request body has nothing to project, and falls
back to a single opaque `--data` blob. That is not a CLI design decision; it is
the CLI faithfully reflecting an operation that does not describe its own input.

Measured: **469 of 926 write operations — 50.6% — take an untyped `--data`
blob.** By product:

| Product | Untyped writes |
|:--------|---:|
| ai | 72 |
| iam | 43 |
| store | 19 |
| o11y | 16 |
| admin | 15 |
| platform | 13 |

**The fix does not belong in this repository.** Each is an operation in the cloud
that declares no request schema; adding the schema there types the CLI flag, the
SDK method and the documentation together. Typing them in the CLI would create a
second description of the request body — the drift this design exists to prevent.
This HIP therefore states the target, **zero untyped writes**, and locates the
work upstream.

### §5 Help

`--help` MUST work at every level of the tree, MUST exit 0, and MUST be generated
from the same source as the command it documents.

The root help MUST carry the sections a UNIX user expects, in this order: `NAME`,
`SYNOPSIS`, `DESCRIPTION`, `GLOBAL FLAGS`, `GROUPS`, `COMMANDS`.

**State: implemented.** `--help` returns 0 at every depth, and the root renders
that layout across 177 groups and 11 commands.

### §6 Man pages — REQUIRED, not implemented

The CLI MUST install manual pages in section 1, generated from the same source as
`--help`:

- `man hanzo` — the root page: name, synopsis, description, global flags, groups.
- `man hanzo-<product>` — one page per product, listing that product's commands.

Section 1 is where a user command's manual page belongs by long-standing UNIX
convention, and `man <tool>-<subcommand>` is the established shape for a
multi-command tool. Pages MUST be generated, never written, for the same reason
the commands are.

**State: absent.** There is no roff output and no man-page generator in the
dependency graph. `src/commands/man.rs` renders help text to a terminal; it does
not produce a manual page, and its name is misleading.

### §7 Shell completion — REQUIRED, not implemented

The CLI MUST emit completion scripts for **bash**, **zsh** and **fish**:

    hanzo completion bash
    hanzo completion zsh
    hanzo completion fish

Completion MUST cover the full command tree and each command's flags, and MUST be
generated from the command tree rather than maintained as a script.

**State: absent.** No completion generator appears in the manifest or the
lockfile. The subcommand name is reserved and unimplemented.

### §8 Output — REQUIRED, not implemented

Every command returning data MUST accept `--format` with exactly three values:

| Value | Meaning |
|:------|:--------|
| `table` | Human-readable columns. The default when stdout is a terminal. |
| `json` | The response body, unmodified. The default when stdout is not a terminal. |
| `yaml` | The same value, as YAML. |

Defaulting on whether stdout is a terminal is what lets one command be read by a
person and piped to a program without a flag in either case.

**State: absent.** Output is always pretty-printed JSON of the response
envelope's `data` field, with no way to select a format; the whole binary
declares only three command-line arguments. A `--raw` flag exists in name only,
and its three references contradict each other: one hardcodes it false, one
claims the flag exists, one states it does not. `--raw` MUST be deleted rather
than repaired — `--format json` is the same capability with a defined meaning.

### §9 Context: `--org` and `--project` — REQUIRED, not implemented

Hanzo is multi-tenant and every request is scoped to an organization. The CLI
MUST accept:

- `--org <slug>` — the organization to act as, sent as the identity header the
  gateway expects (HIP-0111).
- `--project <slug>` — the project within it.

Both MUST be settable persistently, resolving in the order **flag → environment →
config file → the identity's default**.

The CLI MUST NOT invent an org it was not given. Where no org resolves and the
operation requires one, it MUST fail with a message naming the flag rather than
guessing.

**State: absent, and currently refused.** No org flag exists, the org header is
never sent, and a test asserts that passing `--org` to `auth show` is an error.
The refusal is not the bug — sending an unvalidated org would be. The gap is that
the flag does not exist to be validated.

### §10 Configuration and profiles

Configuration MUST live in one file, `~/.config/hanzo/config.toml`, following the
XDG base directory convention, and MUST hold no secret in plaintext.

The file MUST support **named profiles** — one identity, org, project and
endpoint per profile — selected by `--profile <name>` or `HANZO_PROFILE`. One
person routinely holds more than one identity, and re-authenticating in order to
switch is the failure this replaces.

**State: partial.** The config file exists at the specified path. Named profiles
do not; the closest mechanism is multi-identity selection via `hanzo auth use`,
which switches the active identity but carries no org, project or endpoint with
it.

### §11 Exit codes

The CLI MUST distinguish failures by exit status, so a script can branch without
parsing output. `0` means success and non-zero means failure, per the UNIX
convention; beyond that:

| Code | Meaning |
|---:|:--------|
| 0 | Success |
| 1 | Unspecified error |
| 2 | Usage error — unknown command, missing or invalid flag |
| 3 | Authentication required or expired |
| 4 | Permission denied for the resolved identity and org |
| 5 | The named resource does not exist |
| 6 | The server failed (5xx) |
| 7 | The server could not be reached |

A caller MUST be able to tell "not logged in" (3) from "not allowed" (4) from
"not there" (5) without reading a message, because those three demand different
responses from a script and all three are reported identically today.

**State: absent.** Only 0 and 1 are produced, and no exit-code enumeration exists.

### §12 Authentication

`hanzo auth login` MUST authenticate against Hanzo IAM (HIP-0111) and MUST NOT
implement any authentication of its own. Credentials MUST be stored outside the
config file, in the platform credential store where one exists, and with file
permissions restricting them to the user otherwise.

The subcommands MUST be: `login`, `logout`, `show`, `list`, `use`, `token`.

**State: implemented.** All six exist, with `--brand` and `--provider` selection
and `--token -` to read a token from stdin rather than a command line, where it
would land in the shell history and the process table.

### §13 One name, one binary

**`hanzo` MUST name exactly one program.** It does not today, and this is a
correctness problem rather than a tidiness one:

- Two live crates both declare `name = "hanzo-cli"` with `[[bin]] name = "hanzo"`
  — this repository at 1.9.x, and the inference engine's CLI at 1.3.x — on
  unrelated version lines.
- Four Python distributions claim the `hanzo` entry point, and in at least one
  environment the winner is not the intended one.
- On a machine measured for this HIP, the `hanzo` first on `PATH` was 19 patch
  versions behind the source tree.

Requirements:

1. The crate published for this CLI MUST be `hanzo-cli`, and the binary it
   installs MUST be `hanzo`.
2. No other crate MAY install a binary named `hanzo`. The inference engine's CLI
   MUST be renamed.
3. Any document saying "the `hanzo-cli` crate" MUST disambiguate until rule 2
   holds.

**State: `hanzo-cli` is not published on crates.io.** Any documented
`cargo install hanzo-cli` instruction therefore fails, and MUST be removed or
corrected wherever it appears until publication.

### §14 Conformance

An implementation conforms when all of the following hold. Each is a command that
either succeeds or does not.

1. `hanzo --help` exits 0 and prints `NAME`, `SYNOPSIS`, `DESCRIPTION`,
   `GLOBAL FLAGS`, `GROUPS`, `COMMANDS`.
2. `--help` exits 0 at every depth of the tree.
3. The drift gate reports **0 absent** and **0 unfalsifiable**.
4. Untyped `--data` operations number **0**.
5. `man hanzo` and `man hanzo-<product>` resolve for every product.
6. `hanzo completion {bash,zsh,fish}` each emit a script the shell loads without
   error.
7. `--format {table,json,yaml}` is accepted by every data-returning command, and
   the default flips on whether stdout is a terminal.
8. `--org` and `--project` resolve flag → environment → config → identity default.
9. Named profiles select identity, org, project and endpoint together.
10. The exit codes of §11 are produced and documented.
11. `hanzo` on `PATH` resolves to exactly one program.

**Measured on 2026-08-04: 1, 2 and 12 pass. 3 through 11 do not.**

## Rationale

**Why generation rather than hand-written commands.** With 2,341 operations, a
hand-written CLI is a subset chosen by whoever had time, and the choice is
invisible to the user, who cannot tell "not supported" from "not written yet". A
projection has no such state.

**Why maintainer-time generation.** Generating at build time makes the build
depend on a network fetch and lets two builds of one commit differ. Generating at
run time moves that failure into the user's terminal. Generating at maintainer
time, committed and pinned by digest, puts the change in a diff where it can be
reviewed.

**Why the untyped-body fix is upstream.** Typing 469 request bodies inside the
CLI would create a second, competing description of each body. The first time one
changed upstream the CLI would be confidently wrong — precisely the failure the
generation chain removes. One description, in the document, projected everywhere.

**Why so much of this document describes things that do not exist.** Because they
do not, and a specification that quietly described only what was already built
would be a summary rather than a standard. The gaps carry counts so that progress
against them is countable.

## Security Considerations

- **Tokens.** Credentials MUST NOT be written to the config file in plaintext and
  MUST NOT be passed as command-line arguments — the process table and the shell
  history are both readable. `--token -` exists so a token can arrive on stdin.
- **Org scoping.** `--org` selects the tenant a request claims; it is not a grant.
  Authorization is the gateway's and IAM's decision (HIP-0111), and the CLI MUST
  NOT treat a locally configured org as evidence of anything.
- **The pin is a supply-chain control.** `.spec-lock` carries a digest, so a
  regeneration against a substituted document fails rather than silently
  producing a command tree that points somewhere else.
- **A stale binary is a security property, not only an annoyance.** With `hanzo`
  ambiguous across crates and package managers, a user may be running a build far
  behind the one that fixed a defect. §13 is the mitigation.

## References

- HIP-0040 — Multi-Language SDK Standard
- HIP-0111 — IAM Authentication Standard
- HIP-0119 — Hanzo Service Conventions
- HIP-0128 — Resource Surface Standard
- HIP-0135 — What Is Public
- RFC 2119 — Key words for use in RFCs to Indicate Requirement Levels

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
