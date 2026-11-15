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

The layout, the sealing, sparse extents, the fence, the commit and the rule for
operations that are not supported (§2 to §5, §11) are what the engine rebuild in
`hanzoai/vfs` (pull request 8) implements. Its `docs/SPECIFICATION.md` holds the
byte-level encodings, which this HIP does not copy. The journal, the durability
policies, backpressure and the degraded state (§6 to §9) are the contract of work
in progress and are not implemented yet.

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
- **Head** — the one mutable object (§2). Replacing it is the commit.
- **Sequence** — every mutation the Disk applies takes the next number in one
  total order. The journal and the watermarks of §6 speak in sequence numbers. A
  Head's commit number (§2) counts attempts to commit and is another thing.
- **Acknowledged** — a call has returned success to its caller.
- **Generation** — an immutable run of mutations cut from the journal for
  publication (§6).
- **Publisher** — the single actor that uploads a generation and commits its Head.
- **Policy** — `local` or `remote` (§7).

### §2 The objects

A Disk is a prefix of a bucket holding three kinds of object. Nothing else writes
under the prefix. A prefix is slash-separated segments, none empty, `.` or `..`
and none holding a control character, at most 512 bytes in all; a prefix that
fails this MUST be refused and not cleaned, because a store may treat `a//b` as
another spelling of `a/b`.

| Key | What | Name |
|---|---|---|
| `head` | the one mutable object | fixed |
| `meta/<2 hex>/<hash>` | a metadata shard, immutable | BLAKE3-256 of its sealed bytes |
| `pack/<2 hex>/<id>` | a pack of sealed chunks, immutable | 128 random bits |

`<2 hex>` is the first byte of the hash or id. Only `head` is ever overwritten.
Every object is sealed (§3), so the store sees ciphertext only.

**Head.** The Head names the committed state: the root ref of the metadata tree,
the next inode number, a commit number, the Disk's identity (16 random bytes) and
the seed of its chunking table (32 random bytes). The commit number is taken anew
for every attempt, including one whose reply was lost, so no two Heads of a Disk
share one; it can skip. A fence header, with the Round, sits in front of the
sealed Head (§5). A reader MUST bound its read of the Head. Records are tagged: a
reader MUST ignore a table it does not know and MUST keep the fields of an inode
it does not know, and a reader MUST refuse an object it cannot parse. There is one
format: no version number, no negotiation, no reader for any other layout.

**Chunks.** The bytes of a file larger than 16 KiB are cut into chunks by
FastCDC with normalized chunking: at least 64 KiB, targeting 512 KiB on average,
at most 4 MiB, except that the last chunk of a run may be shorter. A cut MUST
depend only on the bytes since the previous cut, so an
edit rewrites the chunks it touches and the cuts re-synchronize after it. The
gear table is drawn per Disk, from the BLAKE3 extendable output over a fixed
string and the seed in the Head, so the lengths of a file's chunks cannot be
matched against a known file in another Disk. The derivation and the masks are
part of the format and are pinned by a test, because changing either changes every
chunk id. A chunk id is the BLAKE3-256 of its plaintext. Equal ids in one Disk mean
equal bytes: that is dedupe. Disks never share chunks.

**Packs.** Each chunk is sealed on its own and appended to the open pack, which
is uploaded at 16 MiB or at a flush. A pack has no header and no index: where a
chunk lies (pack id, offset, sealed length) is a record in the metadata tree, and
a read fetches exactly that range. A pack MUST be smaller than the store's
single-request limit.

**Small files.** A file of at most 16 KiB is not chunked; its bytes are a record
beside its inode. A file's form is a function of its size alone.

**Metadata.** All metadata is records in one ordered Merkle search tree whose
nodes are the immutable shards. Numbers in keys are big-endian, so byte order is
numeric order and one directory's records are contiguous.

| Record | Key | Value |
|---|---|---|
| inode | `[1][ino]` | mode, size, mtime, atime, ctime |
| directory entry | `[2][dir ino][name]` | child inode, type |
| inline bytes | `[3][ino]` | the bytes of a small file |
| chunk reference | `[3][ino][offset]` | chunk id, length |
| chunk table | `[4][chunk id]` | pack id, offset, sealed length |

An entry ends its shard when a hash of its key falls under a threshold
proportional to the entry's size, so shards average 64 KiB and none exceeds
512 KiB. The shape of the tree is therefore a pure function of its records: the
root built incrementally MUST equal the root built from scratch from the same
records. A commit writes the changed leaves and their ancestors and no other
shard, so its cost follows what changed and not the size of the tree.

**Object budget.** A tree of 100,000 files totalling 150 GiB MUST be stored in at
most 40,000 objects whatever the file sizes. At one object per 4 KiB the same
tree is 39,321,600. The reference test `TestObjectBudget150GiB` computes 14,742
objects for a mixed tree and 35,189 for its worst shape, 99,000 files of exactly
16 KiB plus 1,000 huge ones.

### §3 Sealing

The Cipher is the only door to key material.

1. A Cipher seals and opens every object: `Seal(plaintext)` returns the sealed
   bytes and the id of the key used; `Open(sealed, key id)` returns the
   plaintext. `Seal` MUST authenticate as well as encrypt, and an object that was
   altered MUST fail `Open`. A Cipher MUST be safe for concurrent use.
2. Every object is stored as `[length of key id][key id][sealed]`. A Cipher that
   holds several keys opens old objects and seals new ones under its current key:
   rotation needs no bulk re-encryption. Once a key is dropped, what only it
   sealed no longer opens.
3. The caller supplies the keys, taken from a secret manager (HIP-0027), through
   a provider. The library MUST NOT read a key from a file, the environment or a
   default location, and MUST NOT store one. The command line reads keys from
   standard input and nowhere else, because standard input cannot leave a key in
   an argument list, the environment or a file.
4. The default Cipher seals each chunk, each shard and the Head as one age file to
   a hybrid post-quantum recipient, ML-KEM-768 with X25519 (HIP-0302). A
   deployment MAY supply another Cipher that keeps properties 1 to 3.
5. The key is per Disk. An object of one Disk MUST NOT open under another Disk's
   Cipher. After an object opens, a chunk MUST hash to its id and a shard MUST
   hash to its ref; an object that does not is corrupt and MUST be refused, never
   served.
6. **Every object is sealed together with what it is.** The sealed bytes cover a
   context that is not stored and that the reader supplies: for the Head, the
   Disk's place (its canonical location, `s3://<bucket>/<prefix>`); for a shard,
   the Disk's identity; for a chunk, the Disk's identity and the chunk's id. After
   `Open` the reader MUST check the context and refuse the object when it differs.
   An object of another Disk, of another kind, or in another place therefore fails
   closed even under a Cipher both Disks share. A Head is bound to its place, so a
   Disk copied to another place does not open there until its Head is sealed again
   for that place; shards and chunks are bound to the Disk and move with it.
7. When a Disk is configured it MUST check its Cipher: seal a random probe, refuse
   the Cipher unless the sealed bytes contain neither the probe nor its first 16
   bytes, `Open` returns the probe, and `Open` fails when one bit of the sealed
   bytes is flipped. That refuses a Cipher wired to nothing and does not prove a
   Cipher strong.

### §4 Sparse extents

A file's size is its inode's. A file larger than 16 KiB is a set of extents, each
saying that bytes `[offset, offset + length)` are one chunk, and extents never
overlap. A range that no extent covers is a hole and reads as zeros. Extending a
file, by truncate or by a write past its end, MUST NOT store anything for the gap,
and truncating a file smaller discards the extents past the new size, so extending
it again reads zeros and never the discarded bytes. Each run of consecutive
written bytes is cut into chunks on its own, from its first byte. The bytes a Disk
stores are the bytes written, never the sum of its files' apparent sizes. A file is
at most 2^62 bytes.

Acceptance: create a file, truncate it to 1 PiB, and write one byte at an offset of
a petabyte. The store gains at most the chunks of the written runs and the shards
those writes touch, no memory is held for the gap, `stat` reports the apparent
size, and reading the gap returns zeros. A random sequence of writes, truncates and
reads on a Disk matches a plain model byte for byte.

### §5 The fence and the commit

**Create** writes the first Head only if none exists (`If-None-Match: *`) and
refuses a prefix that already holds a Disk. **Open** is read-only, claims nothing
and fences no one.

**Attach** claims the Disk at a Round `r`. It reads the Head and the Round
recorded with it, refuses unless `r` exceeds the recorded Round, and re-seals the
Head it read, unchanged, at `r` by a compare-and-set on the version it read. If
the previous owner commits between the read and the claim, the compare-and-set
fails and the claim re-reads and tries again, so the successor always carries
forward the last Head that landed and no acknowledged commit is lost. Round 0 is
never attached, nor is 2^64-1, which no Round could follow. A writer puts a random
token in the fence header, so a record names both its Round and the writer that
wrote it. When the reply to a claim is lost, the claim has landed. The Attach MUST
recognise its own landed claim (the stored record is exactly the one it wrote),
return the Disk, and MUST NOT fail as stale against its own claim. A caller that
gives up and tries again mints a higher Round.

From the moment a claim lands, every commit by a lower Round is refused. Its
conditional write names a version that no longer exists, so the store answers
412; the writer re-reads the Head, sees a higher Round and is fenced. A fenced
Disk answers every write with a stale-round error for the rest of its life,
because its changes never land; reads still work. The store, and not any process,
decides which Round owns the Disk.

**Commit.** To commit a generation the publisher, in this order, uploads the open
pack that holds its new chunks, uploads the shards the generation changed, and
replaces the Head with one conditional write: `If-Match` on the version it holds, or
`If-None-Match: *` for the first Head. Until that write lands the Head names the
previous tree and nothing it names was touched, so a crash at any point leaves
the Disk exactly as the last commit left it. Objects a failed commit uploaded are
unreferenced garbage and never corruption (§14).

In the steady state a commit is one conditional write and no read: the writer
keeps the version token of its last successful commit or Attach. A conflict
(412), or an ambiguous reply (a timeout, a reset, a 5xx), MUST be reconciled by
reading the Head. If the stored record is exactly the one this writer sent (the
same Round, the same token, the same payload), the commit landed and MUST NOT be
repeated. If it carries a higher Round, the writer is fenced. Otherwise the commit
is retried, a bounded number of times.

A commit that returns an error has an outcome unknown to its caller, which keeps
its changes for the next attempt. A fenced writer whose last commit was carried
forward by its successor counts as committed: the store's Head is exactly its tree.

A commit uploads all of a generation's objects before its Head, and uploads
independent objects concurrently. A shard's children are uploaded before the
shard. The Head waits for every object.

### §6 The journal and the three watermarks

The journal is an append-only log on storage local to the node that owns the
Disk. It exists so that a write is accepted at local speed and uploaded later.

Every mutation takes the next sequence number and is appended to the journal
before it is acknowledged. Three watermarks are kept, each a sequence number that
only grows:

| Watermark | Meaning |
|---|---|
| `visible` | the highest sequence any read of this Disk can observe |
| `durable` | the highest sequence such that it and every lower one are recoverable from the journal after a restart of the process with the node's storage intact |
| `published` | the highest sequence covered by a committed Head |

At all times `published` ≤ `durable` ≤ `visible`. Concurrent fsync callers share
one sync of the journal (group commit). A caller's fsync waits for the watermark
to reach the highest sequence of any mutation that completed before the call
began, and for no more.

**Generations.** The publisher cuts the journal at a sequence into an immutable
generation under a lock that is held only for the cut, then releases the lock and
uploads and commits without it. A mutation that arrives after the cut belongs to
the next generation. Generations commit in order, one Head commit at a time. A
call that waits for publication waits for the generation that contains every
write it must cover, never an earlier one: a write issued after a cut is never
reported published by that generation's commit.

**Replay.** Replaying a journal is idempotent: replaying it twice, or after a
commit whose reply was lost, yields the same Disk. A journal written under Round
`p` MUST be replayed only if the Round recorded when the Disk is next attached
is still `p`; if any other writer has claimed the Disk since, the journal's
entries MUST NOT be applied, and the Attach MUST report that they were not.

**Custody.** The journal holds acknowledged writes before they are sealed. It
MUST be readable only by the process that owns the Disk, and its space MUST be
released once everything in it is published and the Disk is detached.

### §7 Durability policy

A Disk is attached under one policy, and the policy is part of the Attach. The
default is `remote`. `local` MUST be requested explicitly and the Disk MUST
report the policy in force in its status (§9).

- **`remote`** — fsync returns after the Head commit that covers it. An
  acknowledged fsync survives the loss of the node.
- **`local`** — fsync returns when the write is durable in the journal. The Disk
  publishes acknowledged data to the store within 5 seconds of its
  acknowledgement. A lost node can lose that tail.

The bound is per acknowledged write. It starts when the write (or fsync) is
acknowledged; a later write never resets or extends it. Each generation carries
the acknowledgement time of its oldest unpublished write and the publisher MUST
commit the generation before that time plus 5 seconds, while the store is
healthy. It does so with a deadline timer and not a poll, and earlier whenever
dirty bytes, pending operations, an explicit Flush, or a Detach say so. The bound
applies under both policies to writes that no fsync covers.

`local` is for disposable work: development sandboxes and coding runs whose
delivery is a push to a remote repository. A deployment MUST NOT apply it to
state that needs zero acknowledged loss across the permanent loss of a node.

### §8 What each call guarantees

| Call | `local` | `remote` |
|---|---|---|
| `write` returns | `visible` reached it; nothing is durable | the same |
| `close` of a handle | settles that handle only; no durability promise; no store request when the handle is clean | the same |
| `fsync`, `fdatasync` | returns when `durable` reaches the highest sequence completed before the call | returns when `published` reaches it, after one Head commit |
| `syncfs` | as `fsync` for every handle of the Disk | as `fsync` for every handle of the Disk |
| `Flush` | returns when `published` reaches `visible` as of the call | the same |
| `Detach` | `Flush`, then no further write; the journal is released | the same |
| process crash, node storage intact | no acknowledged fsync is lost | no acknowledged fsync is lost |
| node storage lost, then takeover | every write after the last committed Head is lost, fsynced or not: the tail of §7 | no acknowledged fsync is lost; a write that no fsync covered and that is not yet `published` is lost |

A clean `Flush` makes no store request. A `close` MUST NOT by itself commit
anything, and in particular a read-only handle's close MUST NOT publish another
handle's writes.

### §9 Backpressure and the degraded state

The journal has a fixed capacity, an explicit parameter set from the node's
storage budget. When the backlog in bytes, or the age of the oldest unpublished
write, passes a soft limit, writes MUST slow. At a hard limit they MUST fail with
an out-of-space or try-again error as the calling interface allows. The Disk MUST
NOT drop an acknowledged write and MUST NOT silently exceed the bound of §7.

The Disk exposes a status the caller can read: the policy, the Round, the three
watermarks, the backlog in bytes, the age of the oldest unpublished write,
whether the Disk is fenced, and `degraded`. `degraded` is true while the age of
the oldest unpublished write exceeds the bound or the publisher's last attempt
failed. During a store outage the 5-second bound cannot hold, and the Disk says
so through `degraded`, keeps accepting writes only within the journal's capacity,
and never drops data. Under `remote` an fsync that cannot be published returns an
error and never success. When the store returns, the backlog drains in sequence
order and `degraded` clears.

### §10 Crash outcomes

The state recovered after any failure is the state after some prefix of the
sequence order: no acknowledged mutation is skipped or reordered, and no file is
torn by a commit.

| Failure | Outcome |
|---|---|
| process killed, journal intact | the journal is replayed; no acknowledged fsync is lost; replay is safe if the Head landed and its reply was lost |
| killed before or after a journal append, during a group commit, after a Head commit, or twice during replay | the recovered state is a prefix of the sequence order that includes every acknowledged fsync |
| node or journal storage lost, then takeover under `local` | the takeover recovers the last committed Head; every write acknowledged after it is lost |
| node or journal storage lost, then takeover under `remote` | no acknowledged fsync is lost; a write that no fsync covered and that was not yet published is lost |
| store unreachable, node intact | nothing is lost; the Disk is `degraded`; the backlog drains on recovery |
| takeover during a publication | the old owner's commit is refused by the Head compare-and-set at its stale Round; the new owner recovers the last acknowledged durable state; no unacknowledged generation is reported acknowledged |

A takeover MUST NOT report an unpublished tail as durable. Attach MUST report,
with the Disk, the published generation, the acknowledgement time of the newest
write that generation covers, and whether acknowledged fsyncs may have been lost.
It MUST report that they may have been lost unless the previous writer ended
with a Detach or ran under `remote`, or this Attach replayed that writer's
journal.

### §11 The mount

A Disk is mounted into a host through the kernel's user-space filesystem
interface. The mount maps `FSYNC` to fsync under the policy and `FLUSH`, which
the kernel sends on every close, to the handle-local settlement of §8. It
negotiates a maximum write of 1 MiB. Detach, suspend and end MUST force a flush
of the mount (`syncfs`) before the final publication.

With the kernel's write-back cache enabled, the kernel acknowledges `write(2)`
while the data is still in its page cache and before the Disk has seen it. The
guarantees of §7 and §8 therefore start when the Disk acknowledges, at the journal
entry, and not when the application's `write(2)` returns. Only fsync and syncfs,
which force delivery, make an application's write count. Acceptance: write,
receive the kernel's acknowledgement, kill the daemon before the write reaches it,
remount; the mount's documentation states exactly what survives.

A signal that reaches a caller waiting on the mount makes the kernel interrupt the
request. That ends only the wait of fsync, which is answered EINTR while its
commit goes on by itself. Read, write, close and the calls that change the tree
MUST NOT be answered EINTR: a read so answered reaches its caller as an I/O error,
close is never restarted, and a restarted exclusive create would meet its own file.

An operation the Disk does not implement MUST fail with an explicit not-supported
error. It MUST NOT report success without effect.

### §12 What the store must do

1. **Conditional writes.** `PUT` with `If-None-Match: *` creates only when the key
   is absent. `PUT` with `If-Match: <version>` replaces only when the stored
   version matches. A failed precondition answers 412 and writes nothing. Of any
   number of concurrent writers that name the same precondition, exactly one
   succeeds, and the check and the write are one step (HIP-1165, A1). A store that
   ignores these headers silently makes the fence a fiction. A store, or a client
   of it, that cannot write an object atomically under a condition MUST refuse the
   conditional write and MUST NOT perform it unconditionally. A client SHOULD
   probe a store before trusting it: create a probe key twice with
   `If-None-Match: *`; the second MUST answer 412.
2. **Read your writes.** A read after a successful write by any client returns
   that write or a later one, together with the version token `If-Match` compares.
3. **Ranged reads.** A read of a byte range returns exactly that range.
4. **Multipart.** Any object above 64 MiB is uploaded in parts, and an upload
   that fails is aborted so no incomplete parts remain.
5. **Single request.** A single `PUT` of 24 MiB succeeds; a pack is at most 16 MiB
   plus one chunk.
6. **Bounded reads.** A reader names the largest size it will accept for an
   object, and the client reports a longer object as too large without returning
   it. A Head is read with a bound of 64 KiB and a shard with a bound of 1 MiB.
7. **List and delete.** Delete is idempotent; list returns every key with a
   prefix.

### §13 Concurrency

1. One publisher commits at a time. Reads, lookups and local writes proceed
   concurrently with uploads of immutable objects.
2. No Disk-wide lock is held across a call to the store. A request held at the
   store, a `GET`, a `PUT` of a pack, a shard or the Head, for 2 seconds MUST NOT
   stall `stat`, `open`, a buffered write or a `close` on unrelated files.
3. Chunking, hashing, sealing, pack uploads and shard uploads share one bounded
   worker and memory budget and not three pools. Packs of 4 MiB to 16 MiB are
   uploaded with at least 8 requests in flight, and independent shards in
   parallel waves.
4. Every store call carries a deadline. A call that timed out may still complete
   at the store: its outcome is reconciled (§5) and a stale writer stays fenced.
   Cancelling the context of a write or an fsync MUST NOT abort the publication of
   a generation that already holds acknowledged writes.
5. Simultaneous misses for one immutable object share one fetch. A local cache of
   chunks holds clean, validated data only and never the only copy of a write.

### §14 Reclamation

An object that no committed Head and no retained snapshot reaches is garbage.
Reclamation runs on an explicit trigger. It MUST NOT delete an object a committed
Head reaches, and it MUST be safe against a live writer and a takeover: an object
uploaded for a generation that has not committed yet is not garbage.

### §15 Conformance

An implementation conforms when the following hold against a real store that
satisfies §12, not only an in-memory one.

*Safety.* A crash test kills the writer with SIGKILL before the first pack write,
before the first shard write, before the Head write and after it, and fails each
write of a commit in turn; the recovered Disk equals the last commit exactly. The
reply of a Head that landed is lost, and the retry commits once. Two Attaches at
different Rounds: the older cannot commit. A takeover loses no acknowledged
commit. Sixteen clients race on one Head version for 150 rounds and sixteen
create the same key for 100 keys: exactly one wins every time. The reply to an
Attach claim that landed is lost: the Attach still returns the Disk. A journal
left by a writer that a later writer has fenced is not replayed.

*Sealing.* A wrong key fails closed. A tampered, swapped or truncated object is
refused. A shard, a chunk or a Head of another Disk or another place does not open
under a Cipher both Disks share. A Cipher that conceals nothing is refused at
configuration. After a run, no key bytes are on any disk and the environment does not
change a key. A Cipher with a new and an old key reads everything and seals under
the new.

*Durability.* A generation-ordering test runs concurrent writers, flushes and
fsyncs under randomised interleavings against a model, and never acknowledges the
wrong generation. A clock the test controls and a continuous writer show that no
write is unpublished for more than 5 seconds while the store is healthy. A store
outage with a continuous writer, a slow store, and a full journal each end in
`degraded`, throttling and a clear error, and drain in order.

*Concurrency.* Hold one store request for 2 seconds while 32 to 128 concurrent
callers do cached reads, lookups and writes on unrelated files: their p99 stays within twice
the unstalled baseline.

*Cost.* 100,000 files in 150 GiB stay within the object budget of §2. A clean
close makes 0 store requests. A buffered close makes 0 synchronous store
requests. A steady-state commit makes 1 conditional write and 0 reads. A commit of
ten changed files writes no more than 1.5 times as many shards in a tree of 120,000
files as in a tree of 40,000.

*Speed, on one host, one store and one cache state, against the host's own local
filesystem.* Buffered sequential write of data that fits the journal reaches at
least 90% of the local rate. Small-file create, close and `stat` stay within 2x of
local. Under `local`, fsync stays within 1.5x of the local fsync. A report states
two write numbers and never one: the burst rate while the journal absorbs, and the
sustained rate after it is full, which is bounded by the drain to the store.

A process that mounts a Disk MUST NOT open files on its own mount: the kernel asks
the filesystem for readiness while the process's poller is the thing that would
answer. A test serves the Disk from a child process.

## Rationale

*One conditional write, not a lock service.* The store already decides atomically
which of two writers wins a key. A separate coordinator would be a second
authority that can disagree with the store about who owns the Disk; here the Head
and the Round are one object and advance in one write, so there is no window
between admitting a Round and writing its data.

*Chunks and packs, not blocks.* An object store charges and delays per request. A
4 KiB block per object makes a 150 GiB tree 39 million requests. Chunks that cut
on content keep an edit local, and packs make the request count follow bytes
divided by 16 MiB.

*A journal, and a bound, not a synchronous commit.* Making every fsync wait for
the store costs several sequential round trips, which is the difference between a
disk and a network share. The journal makes fsync local; the 5-second bound, the
watermarks and the degraded state make the price explicit. The price is that a
lost node loses the tail, so the policy is a choice the caller makes and
`remote` is the default.

*Per-Disk keys, no cross-Disk dedupe.* Sharing chunks between Disks would need a
key both can use, or a hash of the plaintext visible to the store. Either lets
the store, or another tenant, learn that two Disks hold the same bytes.

## Security Considerations

A holder of the store credential but not the key sees object sizes, counts and
the timing of writes, and nothing else: file names, sizes and structure are all in
sealed shards. An attacker with write access to the bucket can delete or corrupt
objects, which the Disk detects and refuses to serve. It can also replace the Head
with an earlier sealed Head, because sealing authenticates content and not
freshness. A caller that must notice a rollback keeps the commit number of the last
Head it saw and compares: a Head with a lower number is older than one the caller
has seen.

Loss of the key is loss of the Disk, and exposure of the key exposes every object
it ever sealed, including those already deleted. The key lives in a secret manager
and is handed to the library per Attach (§3). Rotation seals new objects under a
new key; old objects stay readable by the old key until they are rewritten, so
retiring a compromised key needs a rewrite of the Disk.

The fence is only as good as the store's conditional write (§12). A store that
ignores `If-Match` gives two writers the same Disk and no error. Two writers
holding one Round defeat it too: the Round is the caller's to mint uniquely.

The journal holds acknowledged writes in plaintext until the publisher seals them.
Whoever can read the node's journal storage can read that data. It belongs on
storage the operator protects at rest, readable by the owning process alone, and
it is released at Detach (§6).

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
