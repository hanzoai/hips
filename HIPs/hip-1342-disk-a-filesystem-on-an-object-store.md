---
hip: 1342
title: Disk — A Filesystem on an Object Store
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: partial
created: 2026-11-15
requires: HIP-0027, HIP-0107, HIP-0135, HIP-0302, HIP-1165
---

# HIP-1342: Disk — A Filesystem on an Object Store

## Abstract

A Disk is a filesystem whose every byte lives in an S3-compatible bucket under
one prefix. One writer owns it at a time, fenced by a monotone Round. Its whole
state becomes durable through one conditional write of a small Head object.
Every object is sealed under the Disk's own key before it leaves the writer, so
the store holds ciphertext only. A local append-only journal lets writes and
fsync run at local-storage speed while one publisher moves them to the store
inside a stated bound. It is implemented in `hanzoai/vfs` (Apache-2.0), where the
library's type for it is `Volume`; the sandbox runtime that runs against it is
HIP-1343.

The bytes of the layout, the fence and the sealing are fixed, and pinned by tests
that rebuild them from the text, in `docs/SPECIFICATION.md` of `hanzoai/vfs`. The
bytes of the journal are in its `docs/journal.md`. This HIP states what an
implementation must do and does not copy either document's encodings.

What is shipped and what is Draft:

| Part | State |
|---|---|
| §2 the objects, the Head, extension objects, the metadata tree and chunks | shipped |
| §3 sealing: the Cipher, its context and its tag | shipped |
| §4 sparse extents | shipped |
| §5 the fence, the commit, moving a Disk | shipped |
| §6 the journal as a package: log, watermarks, bound, backpressure, recovery | shipped as `hanzoai/vfs/journal`; not connected to the Disk |
| §6 the journal's integration, §7 the `local` policy, the close and fsync rows of §8 | Draft |
| §9 backpressure of the journal | shipped in the package |
| §9 deadlines on store requests | Draft |
| §10 crash outcomes of a commit and of the journal package | shipped |
| §11 the mount: no request answered as interrupted, SIGTERM, unsupported operations refused | shipped |
| POSIX operations beyond those in §11 (rename, links, attributes, locks, statistics) | Draft |
| §13 concurrency targets, §14 collection | Draft |
| snapshots, links and base layers (reserved bits of §2), quota and usage accounting | Draft |

## Motivation

A sandbox that edits code needs a disk that survives its node, can be attached
to another node, and costs object-store prices rather than block-device prices.
The first engine stored one object per 4 KiB block: a 150 GiB tree is
39,321,600 objects, and every sync rewrote one metadata blob that grew with the
inode count. It had no fence, so two mounts of one prefix kept whichever
metadata blob was written last and the other mount's blocks became orphans. It
had no local write tier, so every byte was chunked, hashed, sealed and uploaded
inside the call that wrote it.

This HIP specifies the engine that replaces it: objects whose count follows
bytes divided by megabytes, metadata whose commit cost follows what changed, a
fence the store enforces, and a durability contract that says exactly what each
call guarantees and what a lost node costs.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

The object store is the one HIP-1165 specifies. The sink interface a Disk writes
through is the one HIP-0107 names; this HIP adds requirements on the store (§12)
and does not restate either.

### §1 Words

- **Round** — a positive integer that orders writers. The caller mints it from
  its own compare-and-set. A Disk enforces that it only grows and never mints one.
- **Place** — where a Disk lives: a prefix of a bucket, or a directory. Its
  canonical location string is the same for every process that opens it:
  `s3://<bucket>/<prefix>`, or `file://<absolute directory>`. The prefix has no
  leading or trailing `/`; a directory is absolute, cleaned and free of symbolic
  links. The string holds no credential, endpoint or query.
- **Head** — the one mutable object of the tree (§2). Replacing it is the commit.
- **Sequence** — every mutation the journal admits takes the next number, 1, 2, 3
  and so on without gaps, in the order the appends are admitted. The watermarks of
  §6 speak in sequence numbers. A Head's commit number `Seq` counts attempts to
  commit and is another thing.
- **Acknowledged** — a call has returned success to its caller.
- **Generation** — an immutable run of mutations, everything up to a durable
  sequence, that the publisher takes under a lock held only for the cut.
- **Publisher** — the single actor that uploads a generation and commits its Head.
- **Policy** — `local` or `remote` (§7).

### §2 The objects

**Keys.** Every key of a Disk is 1 to 511 bytes of `a-z`, `0-9` and `-`, in
segments of 1 to 255 bytes separated by `/`, and all keys of one kind have the same
number of segments, so none is a prefix of another. A prefix is slash-separated
segments, none empty, `.` or `..`, none holding a control character, at most 512
bytes in all; a prefix that fails this MUST be refused and not cleaned, because a
store may treat `a//b` as another spelling of `a/b`. A Disk's prefix MUST NOT nest
inside another's, in either direction.

**Kinds.** A Disk is three kinds of object, and may hold others.

| Key | What | Name |
|---|---|---|
| `head` | the Head, inside a fence record (§5); the one mutable object of the tree | fixed |
| `meta/<2 hex>/<64 hex>` | a metadata shard, immutable | BLAKE3-256 of its sealed bytes; the 2 hex digits are its first byte |
| `pack/<2 hex>/<32 hex>` | a pack of sealed chunks, immutable | 128 random bits; the 2 hex digits are its first byte |

Every object is sealed (§3), so the store sees ciphertext only. A writer MAY write
an immutable object again, or after its caller gave up: the second write puts the
same bytes at the same name. A reader MUST check a shard against its name and a
chunk against its id, and MUST treat a mismatch as corruption and not retry it.

**Integers.** An integer in a record is in its shortest form, and a value is as
wide as its field and no wider (a mode and an extent's length are 32 bits, a node's
level is 8). A decoder MUST reject another spelling of a number, a value wider than
its field, a truncated item, and bytes left after the last item. Without this one
record has many byte strings, and a shard's ref, a hash of its bytes, names one.

**The Head.** The Head is the root of everything a reader may see. Its plaintext is,
in order: `Seq`, `Root`, `Next`, `ID`, `Seed`, `Journal`, `Needs`, and the Tail.

- `Seq` numbers attempts to commit. A writer takes the next number for every
  attempt, including one whose reply was lost, so no two Heads of a Disk share one;
  it can skip.
- `Root` is the ref of the root shard, or 32 zero bytes for the empty tree. `Next`
  is the next inode number. `ID` is 16 random bytes that name the Disk.
- `Seed` is 32 random bytes. It draws the Disk's chunking table, keys the boundaries
  of the metadata tree and keys the names of extension objects. It never changes: a
  commit and a move write it back as it was, and a new Seed is a new Disk.
- `Journal` is the highest journal sequence whose effects the Head includes: the
  journal's `Published`, as the store holds it. It is 0 when there is no journal.
- `Needs` is a set of feature bits, 0 today. Bit N says that the field of the Tail
  with tag N is present and must be understood. A reader MUST refuse a Head whose
  `Needs` has a bit it does not know (`ErrNeeds`) and change nothing, and MUST refuse
  one that sets a bit it knows without that field (`ErrCorrupt`). A writer sets a bit
  only for a feature it implements, and writes the field with it. No feature is only
  for writers: a bit refuses every build that lacks the feature, readers included.
- The Tail is the fields of later builds, none today, each
  `[tag][length][value]`, with tags strictly increasing. A reader MUST check its
  form whether or not it knows a field: every field whole, tags strictly increasing,
  at most 256 fields, nothing after the last (`ErrCorrupt` otherwise). It MUST skip
  a field it does not know, and a writer that rewrites the Head MUST write every
  field back byte for byte and in order. A field whose bit is not set is ignorable.
- A Head is read in this order and the first failure is the error: a fixed field
  that is short or not in its shortest form is `ErrCorrupt`; a `Needs` bit the build
  does not know is `ErrNeeds`, whatever the Tail holds; then the Tail.
- Bits and tags 1, 2 and 3 are reserved for `snapshots` (retained roots, as
  extension objects, that a collector must keep), `links` (link counts that every
  unlink must adjust) and `base` (chunks read through a layer shared across Disks).
  Bit and tag 63 is an escape for a Head that needs more than 62 features, and 0 is
  unassigned. A reserved bit is unusable until its encoding is in the text: an
  implementation MUST NOT set a bit, nor write a field of a tag, whose encoding is
  not specified.
- The `head` object, which is the fence record of §5 and the sealed Head, is at most
  65,536 bytes, and the bound binds writers as well as readers: a commit that would
  make it longer is refused with an error before any request is made and changes
  nothing. A feature keeps its fields small and keeps what is large in an extension
  object that a field names.

**Chunks.** The bytes of a file larger than 16 KiB are cut into chunks by FastCDC
with normalized chunking: at least 64 KiB, averaging 512 KiB, at most 4 MiB, except
that the last chunk of a run may be shorter. A cut MUST depend only on the bytes
since the previous cut, so an edit rewrites the chunks it touches and the cuts
re-synchronize after it. The gear table is drawn per Disk from the BLAKE3 extendable
output over a fixed string and `Seed`, so the lengths of a file's chunks cannot be
matched against a known file in another Disk. A chunk id is the BLAKE3-256 of its
plaintext. Equal ids in one Disk mean equal bytes: that is dedupe. Disks never share
chunks.

**Packs.** Each chunk is sealed on its own and laid end to end in the open pack,
which is uploaded at 16 MiB (and may exceed it by one frame) or at a commit. A pack
has no header and no index: where a chunk lies (pack id, offset, length) is a record
in the metadata tree, and a read fetches exactly that range, opens it and MUST check
that the plaintext hashes to the chunk id.

**Small files.** A file of at most 16 KiB is not chunked; its bytes are a record
beside its inode.

**Metadata.** All metadata is records in one ordered Merkle search tree whose nodes
are the immutable shards. Numbers in keys are big-endian, so one directory's records
are contiguous.

| Record | Key | Value |
|---|---|---|
| inode | `[1][ino]` | tagged fields: mode, size, mtime, atime, ctime |
| directory entry | `[2][dir ino][name]` | child inode, type bits of the mode |
| inline bytes | `[3][ino]` | the bytes of a small file |
| extent | `[3][ino][offset]` | chunk id, length |
| chunk table | `[4][chunk id]` | pack id, offset, length |

An inode's fields are `[tag][length][value]` with ascending tags, and tags 1 to 5 MUST
be present. A reader MUST keep the fields it does not know and write them back
unchanged. The bits of the mode are fixed (permissions in bits 0 to 8; sticky, setgid,
setuid; directory, symbolic link, device, pipe, socket, character device and
irregular file at fixed bits), and a writer MUST NOT set a bit the text does not
list. A field that some writer must maintain for the Disk to stay consistent is
critical and MUST be announced by a bit in `Needs`. A new kind of record takes a new
first byte of the key, and a reader MUST ignore a table it does not know. A name is 1
to 255 bytes, has no `/` and no NUL, and is not `.` or `..`. Inode numbers are never
reused in a Disk.

The shape of the tree is a pure function of its records and `Seed`: the tree built by
a sequence of changes is identical, shard for shard, to the tree built from scratch
from the same records, and a writer MUST produce that shape. An entry ends its shard
when a keyed hash of it falls under a threshold proportional to its size, so shards
average 64 KiB, and a shard also ends once it holds 512 KiB of plaintext. The key is derived from
`Seed`, and that is its purpose: with an unkeyed hash a party who chooses file names
can choose names that each end a shard, and 2,000 such names cost 2,007 shards
instead of 4. A commit writes the changed leaves and their ancestors and no other
shard, so its cost follows what changed and not the size of the tree.

**Extension objects.** Something that is not the tree, such as a hint that makes the
next attachment faster, is stored beside it as an extension object.

- It lives at `ext/<name>/<rest>`. `<name>` is 1 to 32 bytes of `a-z`, `0-9` and
  `-`. `<rest>` is 64 hex digits of a BLAKE3 hash keyed from `Seed` over the
  extension's name and the caller's key, so the store cannot confirm a guess at a
  key, and the same key in two Disks is two names.
- `snapshots`, `links` and `base` are reserved names, and an extension MUST NOT take
  them. Nothing but an extension of this form uses `ext/`.
- It is sealed with the context kind `ext` and the fields Disk id, name and `<rest>`
  (§3), so it moves with the Disk, and an object of another Disk, name or key does
  not open. It is at most 32 MiB, and a reader MUST bound its read of one.
- It is created with `PutIfAbsent` and replaced with `PutIfVersion`. The Round does
  not fence it: a writer that has been fenced out can still write one, so an
  extension MUST be safe to find stale, and MUST NOT hold state the tree depends on.
- A reader MUST ignore a key it does not know. A tool that removes objects MUST NOT
  delete an object it does not know: it deletes only objects under `meta/` and
  `pack/` of exactly the shape of the table, that no Head it must keep reaches.

**Object budget.** A tree of 100,000 files totalling 150 GiB MUST be stored in at
most 40,000 objects whatever the file sizes. At one object per 4 KiB the same tree is
39,321,600. The reference test `TestObjectBudget150GiB` computes 14,690 objects for a
mixed tree and 34,937 for its worst shape, 99,000 files of exactly 16 KiB plus 1,000
huge ones.

### §3 Sealing

The Cipher is the only door to key material.

1. A Cipher seals and opens every object: `Seal(plaintext)` returns the sealed bytes
   and the id of the key used, 1 to 255 bytes that reveal nothing secret;
   `Open(sealed, key id)` returns the plaintext, and fails for an object that was
   not produced by `Seal` under that key, that was altered, or whose key the Cipher
   does not hold (a distinct error). A Cipher MUST be safe for concurrent use.
2. Authenticated means against the holder of the key material that opens: `Open`
   MUST refuse an object that a party without that material could have made. A
   public-key construction does not give that alone, since whoever holds the public
   recipient can encrypt to the Disk; the Cipher MUST add something only the holders
   of the secret can produce.
3. Every object is stored as `[length of key id][key id][sealed]`. A Cipher that
   holds several keys opens old objects and seals new ones under its current key:
   rotation needs no bulk re-encryption. Once a key is dropped, what only it sealed
   no longer opens. A retired key stays trusted for as long as the Cipher holds it.
4. The caller supplies the keys, taken from a secret manager (HIP-0027), through a
   provider. The library MUST NOT read a key from a file, the environment or a
   default location, and MUST NOT store one. The command line reads keys from
   standard input and nowhere else, because standard input cannot leave a key in an
   argument list, the environment or a file.
5. The default Cipher seals each chunk, each shard and the Head as one age file to a
   hybrid post-quantum recipient, ML-KEM-768 with X25519 (HIP-0302), and appends a
   final 32-byte tag, a BLAKE3 keyed hash of everything before it under a key
   derived from the secret identity; `Open` compares all 32 bytes. A party that
   holds only the recipient can encrypt to the Disk and cannot make an object the
   Disk accepts. A deployment MAY supply another Cipher that keeps properties 1 to
   4.
6. **Every object is sealed together with what it is.** The sealed plaintext begins
   with a 32-byte context, the BLAKE3 digest of a fixed string and the length-framed
   kind and fields of the object: for the Head, `head` and the place; for a shard,
   `shard` and the Disk's id; for a chunk, `chunk`, the Disk's id and the chunk's id;
   for an extension object, `ext`, the Disk's id, the name and `<rest>`. The reader
   supplies the context it expects, and after `Open` MUST check that the first 32
   bytes equal it, and refuse the object otherwise. A context has a fixed length and
   a length-framed preimage, so none is a prefix of another and an object of another
   Disk, kind or place fails closed even under a Cipher both Disks share. A Head is
   bound to its place; shards, chunks and extension objects are bound to the Disk and
   move with it (§5).
7. A Disk MUST check its Cipher when it is configured: seal a random probe, refuse
   the Cipher unless the sealed bytes contain neither the probe nor its first 16
   bytes, `Open` returns the probe, and `Open` fails when one bit of the sealed bytes
   is flipped. It MUST also check every `Seal`: sealed bytes that contain the context
   are an error and not a write, because a Cipher can stop sealing after it was
   checked.
8. After an object opens, a chunk MUST hash to its id and a shard to its ref; one
   that does not is corrupt and MUST be refused, never served.

### §4 Sparse extents

A file's size is its inode's and is at most 2^62 bytes. A file larger than 16 KiB is
a set of extents, each saying that bytes `[offset, offset + length)` are one chunk;
extents never overlap, and a length is at most 4 MiB and equals the length of the
chunk's plaintext. A byte that no extent covers is a hole and reads as zero, and a
hole costs no record, no chunk and no object however large. Extending a file, by
truncate or by a write past its end, MUST NOT store anything for the gap. Truncating a
file smaller discards the extents past the new size and shortens the one that crosses
it, so extending it again reads zeros and never the discarded bytes. Each run of
consecutive written bytes is cut into chunks on its own, from its first byte. The
bytes a Disk stores are the bytes written, never the sum of its files' apparent
sizes.

Acceptance: truncate a file to 1 PiB and write one byte at an offset of a petabyte.
The store gains the chunks of the written runs and the shards those writes touch, no
memory is held for the gap, `stat` reports the apparent size, and the gap reads as
zeros. A random sequence of writes, truncates and reads matches a plain model byte for
byte.

### §5 The fence and the commit

**The fence record.** The `head` object is `fence-magic || round || token ||
sealed-head`: a 6-byte magic, the Round of the writer that wrote it as 8 big-endian
bytes, a 16-byte random token that identifies the writer and not the Disk, and the
sealed Head. The store's conditional write enforces the Round:

- **Create** writes the first Head with `PutIfAbsent` at round 0, and refuses a
  prefix that already holds a Disk. **Open** is read-only, claims nothing and fences
  no one.
- **Put at Round `r`** reads `head`. If its bytes are exactly the record this writer
  would write (same Round, token and payload), an earlier attempt landed and the Put
  succeeds. Otherwise, if `r` is below the recorded Round it fails as stale and the
  object is untouched; otherwise it writes with `PutIfVersion` on the version it read.
  On a lost race it reads again and repeats, at most 8 times.
- **Claim at Round `r`** takes the Disk over. It reads `head`, fails as stale if `r`
  is below the recorded Round, and writes the same payload with Round `r` and its own
  token with `PutIfVersion`, carrying forward whatever the winner wrote, at most 8
  times. A retry that finds exactly its own bytes has landed and succeeds.

**Attach** claims the Disk at Round `r`, which MUST exceed the recorded Round and
MUST NOT be 0 or 2^64-1. After any error other than a refusal for a Round that is too
low, the claim may or may not have landed, and a caller that tries again MUST use a
higher Round: a claim that landed with its reply lost is recognised as the claimant's
own only by a retry inside the same call, and a later call at the same Round is told
it is stale. After a claim lands, no commit by a lower Round can land: its
conditional write finds a different version, or its read finds a higher Round. A
fenced Disk answers every write with a stale-round error for the rest of its life.
The store, and not any process, decides which Round owns the Disk.

**Commit.** A commit settles every file with unsettled writes into chunks, uploads the
open pack, writes the shards that changed, leaf to root, and then writes the Head once,
at the writer's Round, with the next `Seq`. Only the Head changes any object a reader
can reach, so a crash or failure before it leaves the previous tree whole; the objects
already written are unreferenced garbage and never corruption (§14). The shard and
pack writes are idempotent by name, so repeating them is harmless. A commit that
returns `nil` landed. Any other error leaves its outcome unknown to the caller, which
keeps its changes for the next attempt. A stale-round error means the writer was
fenced and can never commit again, and if the store's Head then holds exactly the
writer's root and Disk id, an earlier attempt landed and was carried forward, and the
commit counts as landed.

A later change MAY keep the version token of the last commit and skip the read before
the conditional write, provided a lost race or an ambiguous reply is reconciled by
reading the Head.

A store that returns an older Head it once held cannot be told from the current one
by this protocol. A caller that must notice a rollback keeps the `Seq` of the last Head
it saw and compares it.

**Moving a Disk.** Only the Head is bound to the place. To move a Disk, copy every
object under its prefix to the new place and then reseal the Head there: read `head`
through the fence, open it, check that it decodes as a Head, seal it under the context
of the new place, and write it with the Claim procedure at a Round above the recorded
one. The reseal fences the copy only, so a writer still attached at the old place MUST
be stopped first. The payload is opened under the old place if it is given; if that
fails because the context differs, the Head is already sealed at the new place and
only the Round is claimed, so a reseal can be repeated at a higher Round; if the old
place is not given, with the key alone, which trusts the key and the Head found. The
copy is checked before anything is written: the root shard the Head names MUST open at
the new place under the Disk's id and MUST hold the root directory. A full check reads
every shard, checks that every pack a chunk record names is present and long enough,
and that every chunk an extent names has a record in the chunk table; it reads no
chunk. A Head that needs a bit the build does not know is refused without claiming the
Round.

### §6 The journal and the three watermarks

The journal is an append-only log on storage local to the node that owns the Disk. It
exists so that a write is acknowledged and an fsync returns at local speed while the
store catches up behind it. It is a package that knows nothing of Disks, chunks or
Heads (`hanzoai/vfs/journal`). It is shipped. Connecting it to the Disk is Draft.

**Records and watermarks.** Every record has a sequence. Three watermarks are kept,
each a sequence that only grows:

| Watermark | Means | Reached by |
|---|---|---|
| `Visible` | the record exists; a replay in this run returns it | `Append` returning |
| `Durable` | the record is on the local disk's media | `Sync(seq)` returning |
| `Published` | the store holds the record | `Publish(seq)` |

`Published` ≤ `Durable` ≤ `Visible`. `Publish` MUST refuse a sequence that no local
sync has covered (`ErrAhead`) and change nothing, so the store never holds a record the
journal's disk could still lose. `Published` is the Head's `Journal` field.

**The calls.**

- `Append` makes the record visible, in order, with the next sequence. It is not
  durable. Near capacity it slows, and at capacity, or when no segment file can be
  made, it fails with `ErrFull` and changes nothing.
- `Sync(seq)` returns success only when record `seq` and every record before it are
  durable. Concurrent calls share one sync. A call is released only by a sync that
  began after its record was written; a sync already in flight never releases it.
  After a failed write or sync, it fails for anything not yet durable, forever, and
  every later `Append` fails.
- `Replay` yields every record after `Published`, in order and without gaps, and
  changes nothing: replaying twice yields the same records.
- `Reclaim` makes the space of fully published segments available again. It never
  touches an unpublished record or the segment being written.
- `Due(age)` completes when the oldest unpublished record has been acknowledged for
  `age`, measured from that record's own acknowledgement. Later appends never move it;
  `Publish` moves it to the next unpublished record; with nothing unpublished no timer
  is pending. It is one timer for the exact deadline, and not a poll.
- `State` reports the bytes acknowledged and unpublished (`Backlog`), the age of the
  oldest (`Age`), `Degraded`, and the error that stopped the journal.
- `Close` makes everything appended durable and writes the final mark.

**Lineage.** Sequence numbers mean something only inside one history of a Disk. The
caller supplies an opaque lineage, the Disk and the Round of the writer, which is
written into every segment header and mixed into every record's checksum. `Open`
refuses a directory whose segments carry another lineage (`ErrLineage`), so an old
owner's records are never replayed over a newer Head.

**The bound is per record.** `Due` is how the 5-second bound of §7 is kept. The
bound's default is 5 seconds, and the publisher acts a margin before it. A restarted
journal counts a record as acknowledged no later than the restart, so after a restart
no record has more than the whole bound left, and a clock found behind where it was
starts the age again.

**Layout.** The journal is a directory of segment files of one size, each a header,
two marks and records, with CRC-32C checksums. The header carries four fixed bytes
(`JRNL`) that are not a version, the sequence of the segment's first record, a random
`life` fresh each time the file is reused, and the lineage. A mark records a sequence
that a completed sync covered (`through`) and a sequence the store held (`floor`).
There is one layout and no version: an implementation MUST NOT read, reuse or delete a
file that is not in it, and a change of layout is made by publishing everything,
closing the journal and deleting its directory. The journal MUST hold an exclusive
lock on its directory (`ErrLocked`), MUST refuse a directory on volatile memory
(`ErrVolatile`), and SHOULD create the directory and files readable by their owner
alone. Only Linux on amd64 and arm64 is supported.

**Recovery.** `Open` decides before it writes. It is told the store's sequence, the
Head's `Journal`, which is the truth. It MUST refuse, writing nothing, when the store
holds less than the floor the journal recorded, or holds more than the last record of
a non-empty log (`ErrMismatch`); when a segment's lineage is not the caller's
(`ErrLineage`); when records a surviving mark proves durable are gone or damaged
(`ErrCorrupt`); and when a file is not in the layout (`ErrFormat`). Otherwise it keeps
the longest valid prefix, makes it durable, starts a fresh segment for new records,
and reports through `Recovery` what it kept, what a mark proves was durable, and what
it gave up. `Discard(first, last)` is the only way to give records up and removes
nothing unless the journal holds exactly that range (`ErrRange`).

**Integration (Draft).** The records are opaque bytes; the Disk chooses the encoding
of a mutation. Connecting the journal to the Disk MUST do the following.

1. At mount, open the journal with the Head's `Journal` and a lineage of the Disk and
   the Round recorded in the Head. `ErrMismatch`, `ErrLineage`, `ErrCorrupt` and
   `ErrFormat` mean the journal is not this Disk's current history: the Disk falls
   back to the Head and reports that an unpublished tail may be missing, and the open
   is never retried with another Head. `ErrLocked` means another journal holds the
   directory; it is a fence and is not retried either. Then replay each record in
   order into the Disk's state, and start the publisher.
2. Seal each mutation before appending it, append it before applying it, and take the
   journal's sequence as the Disk's write sequence. The journal stores a payload as
   given and does not encrypt.
3. Under `local`, an fsync waits for `Sync` of the sequence of the last record its
   file depends on, and never for a generation. Under `remote` it waits for the
   generation that contains every write it must cover.
4. One publisher per Disk takes a generation under a short lock, releases the lock,
   uploads the objects, commits the Head carrying the generation's sequence, then
   calls `Publish` with a sequence no greater than `Durable` and then `Reclaim`. It
   acts on `Due`, and earlier on dirty bytes, an explicit Flush, Detach, suspend or
   end. It is stopped before `Close` and before a `Replay`.
5. A mutation that arrives after a cut belongs to the next generation, and a call
   that waits for publication waits for the generation that contains every write it
   must cover, never an earlier one.
6. Detach, suspend and end ask the kernel to flush its dirty pages for the mount
   first, since the journal sees only what reaches the daemon, then publish
   everything, then `Close`.
7. A takeover opens its own journal under its own Round with `Published` set to the
   Head's `Journal`. The old owner's unpublished tail is on its disk and is not
   visible to the new owner; an old owner that returns is refused by its lineage.
8. Payloads above about 64 KiB bypass the ordered log, in a second journal or a spool
   of files made durable first, and the ordered log carries only the small record that
   names them; otherwise bulk data written beside fsync callers delays them. The
   journal SHOULD NOT be enabled on a disk that flushes slowly without that split and
   a measurement.
9. One directory per Disk and Round. A journal directory MUST NOT be restored from a
   backup, copied between nodes or reused for another history; a restored directory
   opens under its lineage and replays an older timeline with no sign that records are
   missing. If a node's disk is lost or doubtful, the directory is deleted and the
   unpublished tail is treated as lost.
10. `ErrFull` is answered as out of space or try again. A journal that has failed
    makes the Disk read-only, since no later write can be made durable.

### §7 Durability policy (Draft)

A Disk is attached under one policy, and the policy is part of the Attach. The default
is `remote`. `local` MUST be requested explicitly, and the Disk MUST report the policy
in force in its status (§9).

- **`remote`** — fsync returns after the Head commit that covers it. An acknowledged
  fsync survives the loss of the node. This is what the Disk does today.
- **`local`** — fsync returns when the write is durable in the journal. The Disk
  publishes acknowledged data to the store within 5 seconds of its acknowledgement. A
  lost node can lose that tail.

The bound is per acknowledged write. It starts when the write, or fsync, is
acknowledged, and a later write never resets or extends it. The publisher MUST commit
a generation before the acknowledgement time of its oldest unpublished write plus 5
seconds while the store is healthy. It does so with the journal's deadline timer and
not a poll, and earlier whenever dirty bytes, pending operations, an explicit Flush, or
a Detach say so. The bound applies under both policies to writes that no fsync covers.

`local` is for disposable work: development sandboxes and coding runs whose delivery
is a push to a remote repository. A deployment MUST NOT apply it to state that needs
zero acknowledged loss across the permanent loss of a node.

### §8 What each call guarantees

"Today" is what the Disk does now. The target columns bind the Disk once the journal
is connected, and where they differ from today the row says so.

| Call | Today | `remote`, target | `local`, target |
|---|---|---|---|
| write, truncate, create, make directory, remove | held in memory, lost if the process dies; nothing durable | the same | visible; in the journal; not durable |
| close of a handle | releases the handle; nothing durable. On a mount every close is a flush, and a flush commits what any handle wrote, so a read-only close can publish another handle's writes | settles that handle only; MUST NOT commit by itself | the same |
| `fsync` | the same as a flush: a full commit | a full commit | returns when the write is durable in the journal |
| flush | everything written before the call, committed; returns only after the Head advanced | the same | the same |
| Detach | a flush, then close of the Disk | the same | the same |
| close of the Disk | nothing; it does not flush | the same | the same |
| end of a mount | one flush | the same | the same |
| attach (takeover) | every commit the previous owner saw acknowledged is in the new tree, and no commit by an older Round lands afterwards | the same | the same |

A flush with nothing to commit makes no store request (`TestCleanFlushMakesNoStoreRequest`).

### §9 Backpressure, the degraded state and stalled stores

**Backpressure (shipped in the journal).** The journal has a fixed capacity, an explicit
parameter set from the node's storage budget, and its disk use never exceeds it. Below
75 % of the capacity an append is not delayed. From 75 % to 100 % it is delayed so that
the admitted rate falls linearly toward 64 MiB/s, and the delay ends early if the
caller's context does. At 100 % it fails with `ErrFull`, nothing is appended and
nothing is dropped. When the publisher publishes and reclaims, appends succeed again
and a replay returns the older records first.

**The state.** `degraded` is true when the oldest unpublished record is older than the
bound, when the journal is slowing appends, or when it has failed. During a store
outage the 5-second bound cannot hold, and the journal says so through `degraded`,
with `Age` and `Backlog` saying how far behind it is, keeps accepting writes only
within its capacity, and never drops data. The Disk's status, once the journal is
connected, reports the policy, the Round, the three watermarks, the backlog, the age of
the oldest unpublished write, whether the Disk is fenced, and `degraded`. Under
`remote`, an fsync that cannot be published returns an error and never success.

**Deadlines (Draft).** A store request has no deadline today, and the Disk's lock is
held across the store calls of a commit. A store that has stopped answering therefore
stalls its callers, and a caller that is killed is not freed: the kernel keeps a
request the daemon holds until the daemon answers it. Killing the daemon frees every
caller at once, in about 20 ms, and loses what was not committed. The daemon holds about
134 KiB for each abandoned request. The next change gives every store request a
deadline and the Disk a lock that honours a request's context, and a collector (§14)
waits for it. Until then a supervisor MUST, before it gives a tenant a mount, watch the
store's latency and kill the daemon when the store does not answer, limit the processes
and the memory of the mount's callers and of the daemon, and unmount lazily at
teardown, because a mount in use refuses a plain unmount.

### §10 Crash outcomes

**A commit (shipped).** A process killed at any point of a commit leaves the last
committed tree whole: before the first pack write, after it, before the first shard
write, after it, before the Head write, and after it. Each write of a commit failing in
turn leaves the same. A Head that landed with its reply lost is recognised by the retry
and committed once. A takeover loses no acknowledged commit. Whatever was not committed
is lost with the process.

**The journal package (shipped).** What `Replay` returns after the next `Open`:

| What happens | Outcome |
|---|---|
| process killed, disk and OS intact | every record the writer had written to the file, which includes every record whose `Sync` returned; records still in memory are lost, and none of them was durable |
| operating system crash or power loss | a prefix of the appended records that contains every record whose `Sync` returned; which unsynced records survive is up to the disk, and they survive as a prefix, never with a gap |
| torn write | the valid prefix before the damaged record; `Recovery` says what was dropped |
| damage to a record a mark proves durable | `ErrCorrupt`, nothing dropped; the disk lost something acknowledged and the Disk falls back to the store |
| damage to a record that no surviving mark covers: any record acknowledged by a `Sync` in the last sixteen rounds, or the last megabyte, before a kill | treated as a torn tail and dropped although its `Sync` had returned, because marks are spaced out; a clean `Close` leaves no such window |
| damage to the header of the tail segment, even after a clean `Close` | `Open` succeeds, that segment's records are lost, and a warning names the segment and its size: a media error in that block is the loss of the disk |
| a directory holding a file that is not in the layout | `ErrFormat`; nothing is read, reused or deleted |
| permanent loss of the disk | nothing; the unpublished tail is lost, the journal cannot know what it lost, and the caller MUST report that an unpublished tail may be missing and MUST NOT report those writes durable |

**The Disk with the journal connected (Draft).** The state recovered after any failure
is the state after some prefix of the sequence order that includes every acknowledged
fsync of the policy.

| Failure | Outcome |
|---|---|
| process killed, journal intact | the journal is replayed; no acknowledged fsync is lost; replay is safe if the Head landed and its reply was lost |
| killed before or after a journal append, during a group commit, after a Head commit, or twice during replay | a prefix of the sequence order that includes every acknowledged fsync |
| disk lost, then takeover under `local` | the takeover recovers the last committed Head; every write acknowledged after it is lost |
| disk lost, then takeover under `remote` | no acknowledged fsync is lost; a write that no fsync covered and that was not yet published is lost |
| store unreachable, node intact | nothing is lost; the Disk is `degraded`; the backlog drains on recovery |
| takeover during a publication | the old owner's commit is refused by the Head's conditional write at its stale Round; the new owner recovers the last acknowledged durable state; no unacknowledged generation is reported acknowledged |

A takeover that does not hold the previous writer's journal MUST report, with the Disk,
the last published sequence, which is the Head's `Journal`, and that acknowledged
writes beyond it may be missing, and MUST NOT report those writes durable.

### §11 The mount

A Disk is mounted into a host through the kernel's user-space filesystem interface.
The mount maps `FSYNC` and the `FLUSH` the kernel sends on every close to the calls of
§8.

**No request is answered as interrupted.** A signal that reaches a waiting caller makes
the kernel interrupt the request. Every call waits for its own result, runs on a
context no request owns, and no interrupt cancels a commit or a fetch. The reason is
what callers do with the answer: a C caller does not retry `fsync`, so a database over
a mount reported an I/O error (7 runs of 7 on one kernel; a C caller under a timer saw
246,912 interrupted fsyncs in 5,000); `stat` and directory reads so answered reached C
callers as errors; a `read` so answered reaches its caller as `EIO`; `close` is never
restarted; a restarted exclusive create meets its own file. The exception is a lookup,
a getattr and a readdir, which change nothing: an interrupt ends them 3 seconds later,
so a killed caller of a cold lookup is freed. The cost is §9.

**End of a mount.** SIGTERM commits what the daemon holds, asks for the unmount, detaches
a mount in use lazily after 5 seconds and returns within 3 seconds more. The commit at
the end has a deadline of 3 seconds: when the store has stopped answering, the daemon
says that the last commit did not finish and that what it held may be lost, and exits
non-zero. With a stalled store the whole takes up to 21 seconds.

**Unsupported operations.** Rename, links, symbolic links, owner and mode changes,
extended attributes, locks and file-system statistics have no records yet. A mount
answers them as not supported. An operation the Disk does not implement MUST fail with
an explicit not-supported error and MUST NOT report success without effect. Adding them
is Draft.

**Write-back.** With the kernel's write-back cache enabled, the kernel acknowledges
`write(2)` while the data is still in its page cache and before the Disk has seen it.
The guarantees of §7 and §8 therefore start when the Disk acknowledges, at the journal
entry, and not when the application's `write(2)` returns. Only fsync and syncfs, which
force delivery, make an application's write count. Acceptance: write, receive the
kernel's acknowledgement, kill the daemon before the write reaches it, remount; the
mount's documentation states exactly what survives.

### §12 What the store must do

A Disk needs a keyed store of byte strings with these operations, with keys relative to
the Disk's prefix joined by one `/`.

| Operation | Contract |
|---|---|
| `Get(key, max)` | the bytes at `key` and a version token naming exactly those bytes; absent is not found; an object longer than `max` is too large and is not returned |
| `GetRange(key, off, n)` | exactly `n` bytes from `off`; a range past the end is an error, never a short read |
| `Put(key, data)` | store `data`, replacing any object; used only for objects no one else writes |
| `PutIfAbsent(key, data)` | store `data` only if `key` does not exist, atomically with the check; a conflict otherwise; returns the new version |
| `PutIfVersion(key, data, v)` | store `data` only if `key` exists and its version is `v`, atomically with the check; of several calls naming one `v` exactly one succeeds; returns the new version |
| `Delete(key)` | remove; removing an absent key is not an error |
| `List(prefix)` | every object whose key begins with `prefix` as a string, each with its key, its size and the time the store last modified it by the store's own clock; none is hidden |
| `Stat(key)` | the size of the object without its body |

A Disk reads and writes with the first six; `List` and `Stat` are for tools, a collector
and the check of a copied Disk.

1. **Conditional writes** are atomic (HIP-1165, A1). A failed precondition answers 412
   and writes nothing. A store that ignores the headers silently makes the fence a
   fiction. A store, or a client of it, that cannot write an object atomically under a
   condition MUST refuse the conditional write as too large and MUST NOT perform it
   unconditionally; the reference object-store client sends an object in one request up
   to 64 MiB and refuses conditional writes above that, and uploads an unconditional
   object above it in parts that it aborts when the upload fails. A client SHOULD probe a
   store before trusting it: create a probe key twice with `If-None-Match: *`; the second
   MUST answer 412.
2. **Read your writes.** A read after a successful write by any client returns that write
   or a later one, together with the version token `If-Match` compares. A version token
   is opaque and compared only for equality.
3. **Keys.** A store MUST keep every key of the grammar of §2 exactly as given, and `List`
   it by string prefix with none hidden. It MAY keep other keys and the text promises
   nothing for them. A store that keeps keys as files refuses a key that is the
   directory of another, which the same-number-of-segments rule of §2 prevents.
4. **Bounded reads.** A reader names the largest size it will accept for an object. A
   Head is read with a bound of 64 KiB, a shard of 1 MiB, an extension object of 32 MiB
   and the room its seal takes.
5. **Trust.** The store is trusted to return the object it holds, with availability and
   with ordering, and not with confidentiality: it learns object sizes, key names and
   timing, and no content.

### §13 Concurrency

Today a commit holds the Disk's lock across its store calls, so one slow request stalls
every call on the Disk (§9). What follows binds the Disk once the journal and the
deadlines are in (Draft).

1. One publisher commits at a time. Reads, lookups and local writes proceed concurrently
   with uploads of immutable objects.
2. No Disk-wide lock is held across a call to the store. A request held at the store, a
   `GET`, a `PUT` of a pack, a shard or the Head, for 2 seconds MUST NOT stall `stat`,
   `open`, a buffered write or a `close` on unrelated files.
3. Chunking, hashing, sealing, pack uploads and shard uploads share one bounded worker
   and memory budget and not three pools. Packs are uploaded with several requests in
   flight, and independent shards in parallel waves, children before their parents, the
   Head after every object.
4. Every store call carries a deadline. A call that timed out may still complete at the
   store: its outcome is reconciled (§5) and a stale writer stays fenced.
5. Simultaneous misses for one immutable object share one fetch. A local cache of chunks
   holds clean, validated data only and never the only copy of a write.

### §14 Reclamation (Draft)

An object that no retained Head reaches is garbage. The collector is decided and not
built, and a change to one of these rules is a change to this text.

- It runs online, against live writers, and is mark and sweep. It marks from the Head's
  `Root` and from every retained root, following every shard to its children and every
  chunk record to its pack. A Disk with the `snapshots` bit has retained roots, and a
  collector that does not know the bit refuses the Disk.
- It deletes an object only if it is under `meta/` or `pack/` with exactly the shape of
  §2, is not marked, and is older than the grace. It deletes nothing under a key it does
  not know, and nothing under `ext/`.
- Age is the store's: the object's modification time as `List` reports it, against the
  store's own time, which the collector learns by writing an object of its own and listing
  it, never a writer's clock or its own. A store's time has a granularity (S3 reports
  whole seconds, truncated down), so the grace MUST exceed it by one second.
- The grace is longer than the longest a commit can take, which is bounded only when every
  store request has a deadline, so no collector is built before them; it is more than twice
  the sum of the deadlines of a commit's requests. The collector marks from the Head it
  reads after the listing and not before.
- Disks never share chunks until a build that sets the `base` bit exists.
- `Open` pins nothing. A reader that holds one Head for longer than the grace, while the
  Disk goes on committing, finds a shard gone and sees `ErrCorrupt`, so the grace is the
  longest a Head may be held, and it is published with the collector.

### §15 Conformance

An implementation conforms when these hold against a real store that satisfies §12, and
not only an in-memory one. The tests named are the reference suite's.

| Property | Tests |
|---|---|
| every byte of the layout | `TestSpecContexts`, `TestSpecFrameAndTag`, `TestSpecHead`, `TestSpecFenceRecord`, `TestSpecRecords`, `TestSpecNodeAndBoundary`, `TestSpecChunker`, `TestSpecExtension`, `TestObjectKeysAreTheSpecShapes`, `TestFenceTokenIsSixteenBytes`, `TestTheSizesOfTheText`, `TestTheCipherOpensAGoldenObject` |
| the Head: fields, bits, the Tail, the bound | `TestHeadRejectsGarbage`, `TestHeadNeeds`, `TestHeadTailRules`, `TestNeededFieldsMustBePresent`, `TestTailSurvivesAnOrdinaryWriter`, `TestHeadMatrix`, `TestHeadParserFuzz`, `TestAKnownBitIsHeldToItsField`, `TestOneSpellingPerHead`, `TestWriterNeverWritesAHeadItsReadersRefuse`, `TestStoreNeverWritesWhatItWouldNotRead`, `TestTheHeadHasRoomForTheJournalSequence`, `TestHeadFieldsSurviveACommit`, `TestHeadOfALaterBuildIsRefusedByEveryDoor` |
| a crash at any point leaves the last commit | `TestSigkill` (six kill points), `TestFailureAtEveryWrite`, `TestLostAcknowledgementOfHead`, `TestKillOverRealServer` |
| the fence: one winner, an older Round refused, takeover loses nothing, lost acknowledgements | `TestFenceRefusesOlderRound`, `TestAttachNeedsAHigherRound`, `TestTakeoverLosesNoAcknowledgedCommit`, `TestRacingClaims`, `TestSameRoundRace`, `TestAttachLostAckIsNotStale`, `TestAttachAfterALostClaimNeedsAHigherRound`, `TestRoundMaxIsRefused`, `TestHeadSeqNeverRepeats` |
| the store contract and its keys | the `internal/storetest` suite on every backend, `TestRealServerCAS`, `TestRealServerRaceStress`, `TestValidKey`, `TestListTimesAndPages` |
| extension objects | `TestExtensionObjectsOnEveryStore`, `TestExtensionObjectsAndTheFence`, `TestExtensionObjectsRaced`, `TestExtensionObjectIsSealedToItsVolumeNameAndKey`, `TestStrayKeysAreIgnoredAndKept`, `TestExtNameRevealsTheKey`, `TestExtNamesMatchAnIndependentBLAKE3`, `TestExtNamesFollowTheVolume` |
| sealing: context, Cipher, rotation | `TestSealedToItsContext`, `TestHeadContextIsExact`, `TestContextsDoNotCollide`, `TestSwappedHeadIsRefused`, `TestChunkHashIsChecked`, `TestIdentityCipherIsRefused`, `TestCipherThatStopsSealingIsCaughtAtEverySeal`, `TestRecipientAloneCannotForge`, `TestEveryByteOfTheTagIsChecked`, `TestWrongKeyFailsClosed`, `TestTamperedObjectsAreRefused`, `TestSwappedChunkIsRefused`, `TestRotation` |
| places and moving a Disk | `TestPlaceSpellings`, `TestPlacesAreRefusedNotCleaned`, `TestResealMovesAVolume`, `TestResealIsRepeatable`, `TestResealWithoutThePlace`, `TestResealRacesAWriter`, `TestResealChecksTheCopy`, `TestVerifyFindsAnExtentWithoutItsChunk`, `TestCLIReseal` |
| integers, the keyed tree, chunks | `TestHeadNonMinimalUvarint`, `TestIntegersAreInTheirShortestFormAndFitTheirField`, `TestGroundNamesDoNotBloatTheTree`, `TestBoundariesDependOnTheSeed`, `TestTreeMatchesModel`, `TestTreeForcedCuts`, `TestCutBounds`, `TestCutStableUnderEdit`, `TestGearDiffersPerVolume`, `TestChunkListIsTheWholeFileCut` |
| holes and truncation | `TestSparseExact`, `TestSparseRandom`, `TestSparsePetabyte`, `TestModelFuzz` |
| the object budget | `TestObjectBudget150GiB` |
| the mount | `TestFUSEFsyncSurvivesKill`, `TestFUSEInterruptsAreNotErrors`, `TestFsyncWaitsForItsCommit`, `TestCloseWaitsForItsCommit`, `TestKilledColdLookupIsFreedAfterTheGrace`, `TestFinishCommitsWhatTheMountWrote`, `TestFinishDoesNotWaitForAStalledCommitForever`, `TestFUSETermStopsAMountInUse`, `TestFUSESQLite` |
| the journal: order, barrier, grouping | `TestSyncGenerationOrder`, `TestSyncGroupsWaiters`, `TestPublishRefusesWhatIsNotDurable`, `TestConcurrentWriters` |
| the journal: crashes, recovery, lineage, exactness | `TestCrashSequential`, `TestCrashConcurrent`, `TestCrashReclaim`, `TestCrashDuringRecovery`, `TestCrashExplorationWithProductionCadence`, `TestProcessCrashKeepsSyncedRecords`, `TestStoreAheadOfTheLog`, `TestWrongPublishedIsRefusedAndHarmless`, `TestAnotherLineageIsRefused`, `TestStaleLineageIsNotReplayedOnANewerHead`, `TestDiscardIsExact`, `TestUnknownFormatIsRefusedAndKept`, `TestSecondJournalOnALiveDirectory`, `TestOpenRefusesMemory`, `TestRestoredBackupIsInvisible` |
| the journal: the bound, backpressure, the state | `TestDueFiresAtTheDeadline`, `TestDueIsNotResetByLaterWrites`, `TestBoundHoldsUnderContinuousWrites`, `TestRestartWithTheClockBehindStartsTheBoundAgain`, `TestBackpressure`, `TestOutageIsReported`, `TestStateBacklogIsExact`, `TestCapacityOnRealFiles` |

Acceptance for the Draft parts, each a test that fails if its requirement is removed.

*The policies and the bound.* A model-checked history of concurrent writers, flushes and
fsyncs under randomised interleavings never acknowledges the wrong generation: an fsync
that returns implies every write that completed before it began is covered, and a write
issued after a cut is never reported published by that generation's commit. A clock the
test controls and a continuous writer show that no write is unpublished for more than 5
seconds while the store is healthy. A Head that landed with its reply lost is recognised,
published once, and loses no write that arrived after the cut. A takeover during a
publication refuses the old owner's commit at its stale Round and loses no acknowledged
fsync. A store outage with a continuous writer, a slow store, and a full journal each end
in `degraded`, throttling and a clear error, and drain in order. The matrix of kills
before and after a journal append, during a group commit, after a Head commit, during a
takeover and twice during replay recovers a prefix that includes every acknowledged fsync.

*Concurrency.* Hold one store request for 2 seconds while 32 to 128 concurrent callers do
cached reads, lookups and writes on unrelated files: their p99 stays within twice the
unstalled baseline.

*Cost, on one host, one store and one cache state, against the host's own local
filesystem.* A clean close makes 0 store requests, and a buffered close 0 synchronous
store requests. A tree of small files costs at most 0.4 objects per file. Buffered
sequential write of data that fits the journal reaches at least 90 % of the local rate.
Small-file create, close and `stat` stay within 2x of local. Under `local`, fsync stays
within 1.5x of the local fsync. A report states two write numbers and never one: the
burst rate while the journal absorbs, and the sustained rate once it is full, which the
drain to the store bounds.

A process that mounts a Disk MUST NOT open files on its own mount: the kernel asks the
filesystem for readiness while the process's poller is the thing that would answer. A
test serves the Disk from a child process.

## Rationale

*One conditional write, not a lock service.* The store already decides atomically which of
two writers wins a key. A separate coordinator would be a second authority that can
disagree with the store about who owns the Disk; here the Head and the Round are one
object and advance in one write, so there is no window between admitting a Round and
writing its data.

*Chunks and packs, not blocks.* An object store charges and delays per request. A 4 KiB
block per object makes a 150 GiB tree 39 million requests. Chunks that cut on content
keep an edit local, and packs make the request count follow bytes divided by 16 MiB.

*A journal, and a bound, not a synchronous commit.* Making every fsync wait for the store
costs several sequential round trips, which is the difference between a disk and a
network share. The journal makes fsync local; the 5-second bound, the watermarks and the
degraded state make the price explicit. The price is that a lost node loses the tail, so
the policy is a choice the caller makes and `remote` is the default.

*A tagged Head, with bits that refuse.* A layout that must never be versioned still has to
grow. A field that can be ignored is carried; a field that every writer or every collector
must honour sets a bit, so a build that lacks the feature refuses the Disk and does not
damage it.

*Per-Disk keys, no cross-Disk dedupe.* Sharing chunks between Disks would need a key both
can use, or a hash of the plaintext visible to the store. Either lets the store, or another
tenant, learn that two Disks hold the same bytes.

## Security Considerations

A holder of the store credential but not the key sees object sizes, counts, key names and
the timing of writes, and nothing else: file names, sizes and structure are all in sealed
shards. Keyed tree boundaries stop a guest who picks file names from bloating the tree;
they do not hide from an observer of the store how many shards each commit writes. An
attacker with write access to the bucket can delete or corrupt objects, which the Disk
detects and refuses to serve. It can also replace the Head with an earlier sealed Head,
because sealing authenticates content and not freshness; a caller that must notice a
rollback keeps the `Seq` of the last Head it saw and compares. The Round in the fence
header is checked by conditional writes and not by the Cipher, so whoever can write the
store can set it, as they can delete the Head. Tenants MUST NOT hold the store's write
credentials.

A public recipient must not be enough to forge an object: the default Cipher's tag is
what makes a Head or a shard that only a holder of the secret could have made (§3).
Loss of the key is loss of the Disk, and exposure of the key exposes every object it ever
sealed, including those already deleted. The key lives in a secret manager and is handed
to the library per Attach. Rotation seals new objects under a new key; old objects stay
readable by the old key until they are rewritten, so retiring a compromised key needs a
rewrite of the Disk.

The fence is only as good as the store's conditional write (§12). A store that ignores
`If-Match` gives two writers the same Disk and no error. Two writers holding one Round
defeat it too: the Round is the caller's to mint uniquely. An extension object is outside
the fence, so a fenced writer can still write one; that is why an extension is only a
hint.

The journal stores a payload as given. A Disk that appends unsealed payloads leaves
plaintext on the node's disk, so the Disk seals before it appends (§6). The journal's
directory is created readable by its owner alone and is released at Detach. A restored
or copied journal directory replays an older timeline with no sign that records are
missing, which is why it is never restored.

A checkpointed sandbox, a snapshot or a move of the Disk carries what the Disk holds
(HIP-1343). Moving a Disk is a copy and a reseal; the reseal fences the copy only, so the
old writer is stopped first.

## References

- HIP-0027 — Secrets Management Standard
- HIP-0107 — Streaming Replication over VFS
- HIP-0135 — What Is Public
- HIP-0302 — Hanzo Replicate: Encrypted SQLite Durability for Base Services
- HIP-1165 — S3 — Buckets and Objects
- HIP-1343 — Visor — The Sandbox Runtime
- RFC 2119 — Key words for use in RFCs
- RFC 9110 — HTTP Semantics, section 13.1, preconditions
- W. Xia et al., FastCDC: A Fast and Efficient Content-Defined Chunking Approach
  for Data Deduplication, USENIX ATC 2016
- NIST FIPS 203 — Module-Lattice-Based Key-Encapsulation Mechanism Standard
- BLAKE3: one function, fast everywhere

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
