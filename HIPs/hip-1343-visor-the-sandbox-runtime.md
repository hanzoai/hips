---
hip: 1343
title: Visor — The Sandbox Runtime
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
implementation-go: partial
created: 2026-11-15
requires: HIP-0135, HIP-1146, HIP-1342
---

# HIP-1343: Visor — The Sandbox Runtime

## Abstract

Visor is the isolation boundary a sandbox runs behind (HIP-1146). It is a fork of
the gVisor application kernel and its OCI runtime: a container's processes run
against a user-space kernel written in Go, the sentry, and reach files only
through a separate process, the gofer, so hostile code never makes a system call
to the host kernel itself. It is implemented in `hanzoai/visor` (Apache-2.0).

This HIP specifies what Hanzo requires of the runtime beyond what the fork
inherits: how a Disk (HIP-1342) reaches a sandbox, that fsync keeps its meaning
across the sandbox boundary, and that a sandbox can be checkpointed to object
storage and restored on another node.

HIP-0053, HIP-0123 and HIP-1172 use the name Visor for a monitoring system and a
compute plane. The compute plane is `hanzoai/compute`; the repository
`hanzoai/visor` is the runtime this HIP describes.

What is shipped and what is Draft:

| Part | State |
|---|---|
| §1 the runtime and its supported configuration | shipped |
| §2 serving a host-mounted directory with exclusive access and a directory cache | shipped in the runtime, and the measured supported path; `vfs mount` mounts a Disk on a host (HIP-1342), and the node agent that does it for a sandbox is not built |
| §3 fsync across the boundary | holds on the path of §2, where the sentry syncs the host file descriptor; violated by a FUSE mount inside the sandbox, which is a defect |
| §4 checkpoint and restore to a local directory | shipped |
| §4 checkpoint and restore to object storage | Draft |

## Motivation

A sandbox is useful for coding only if its files outlive it, and a file that
outlives a sandbox lives in a Disk. The runtime stands between the Disk and the
process that writes to it, and it can make that path slow, or make it lie. In the
default access mode a `stat` of a Disk file measured 15.4 ms, and 7 µs with the
settings of §2. A FUSE mount inside the sandbox acknowledged `fsync` in about 0 µs
where the host mount took about 11.8 ms, and an acknowledged fsync was lost after
the daemon was killed in 2 of 3 strict runs (`hanzoai/vfs` issue 30, measured
2026-11-14 on release 20260831.0-35). The first is a cost the runtime can remove;
the second is a promise the runtime breaks. Both need a specification so they can
fail a test.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

### §1 The runtime

Visor is an OCI runtime. A container runs under it when its pod selects the
runtime class `visor` (HIP-1146). It derives from gVisor (Apache-2.0) and keeps
that project's LICENSE and notices (HIP-0135).

The supported configuration is the one the runtime is released and exercised
with: the `systrap` platform, `directfs` enabled, and a root filesystem whose
writable layer is a file on the host and not memory held by the sandbox. Another
platform, or `directfs` disabled, is not supported; both measured slower on every
file metadata operation.

### §2 Serving a host-mounted directory

A Disk is mounted on the host by its own daemon, `vfs mount` (HIP-1342, §11). The runtime
serves that host directory into the sandbox as an ordinary bind mount through the
gofer. The sandbox receives a directory. It receives no store credential, no Disk
key and no privilege to mount anything, and the process that uses it needs none.

1. The mount MUST be served with exclusive file access
   (`--file-access-mounts=exclusive`), and the runtime MUST run with a directory
   cache of at least 100,000 entries (`--dcache`). Exclusive access lets the
   sentry cache a directory entry and its attributes for the life of the mount and
   not revalidate them against the host.
2. Exclusive access is correct only when nothing else writes the directory. A
   Disk has one writer at a time (HIP-1342, §5) and the sandbox is it. The runtime
   MUST NOT serve a directory with exclusive access when another process may
   modify it.
3. A Disk is attached read-write to at most one sandbox at a time, under the Round
   its caller holds. The runtime does not mint Rounds.
4. With exclusive access the sentry may hold written pages that the host has not
   seen. A runtime MUST deliver them to the host mount, as writes to the host file,
   before it reports the sandbox stopped or checkpointed. The Disk's daemon then
   publishes them when it is detached (HIP-1342, §11).

Acceptance: after the first `stat` of a path, a `stat` of the same unchanged path
reaches the Disk's daemon 0 times, counted at the daemon. In the default access
mode a stat of a Disk file measured 15.4 ms and with both settings 7 µs
(`hanzoai/vfs` issue 30, 2026-11-14). A scan of the sandbox's environment and
filesystem finds no store credential and no key. Write without fsync, stop the
sandbox, detach the Disk and remount it: the data is present.

### §3 fsync keeps its meaning

A sandbox MUST NOT acknowledge `fsync(2)`, `fdatasync(2)`, `msync(2)` with
`MS_SYNC` or `syncfs(2)` on a file or filesystem of an attached Disk until the
Disk's daemon has acknowledged the corresponding sync. What a process in the
sandbox sees as durable never exceeds what the daemon has promised (HIP-1342, §8).

On the path of §2 this holds: the sentry's sync is a sync of the host file
descriptor, and it returns when the daemon replies. It does not hold for a FUSE
filesystem mounted inside the sandbox. The sentry's FUSE client sends `FSYNC`
asynchronously and returns before the daemon answers. A Disk MUST NOT be attached
by a FUSE mount inside the sandbox for as long as that is so.

Acceptance: inside the sandbox, write and fsync 100 times, and kill the Disk's
daemon with SIGKILL the instant the last fsync returns. Remount. Every
acknowledged write is present. Three consecutive runs pass.

### §4 Checkpoint and restore

A running sandbox can be checkpointed, memory and filesystem, to an image
(`visor checkpoint`) and restored from it (`visor restore`). A restore can bring
memory back lazily in the background. A filesystem-only snapshot of the writable
layers can be taken from inside the sandbox. These write to a local directory and
are shipped.

The runtime moves image files to and from remote storage through a separate
checkpoint gofer. The one backend in the tree does not speak the S3 API. The
following are Draft.

1. **An S3 backend** for the checkpoint gofer writes an image to, and reads it
   from, a bucket and prefix the caller names, using parallel multipart uploads and
   parallel ranged reads. The backend that does not speak S3 is removed.
2. **The image is sealed** before it leaves the node, by a Cipher the caller
   supplies (HIP-1342, §3). A memory image holds whatever the process held,
   including keys. A restore MUST refuse an image that fails authentication.
3. **An image restores only under the visor build that wrote it, on the same CPU
   architecture.** A restore under any other MUST fail with an error that names the
   build and the architecture of both. Network connections do not survive a
   restore.
4. **Restore needs privilege.** The restore command refuses to run rootless. A
   restore on a cluster node is verified to work as root before it is relied on.
5. **With a Disk, suspend and resume are ordered.** The Disk's daemon is a host
   process outside the checkpoint, and no process may write to the Disk after it
   is detached. To suspend, the caller stops the sandbox so that nothing writes,
   with its acknowledged writes delivered to the host mount (a checkpoint does
   both, §2 item 4), then detaches the Disk (HIP-1342, §6 and §8: a flush of the
   mount, a publication of everything, no further writes). To resume, the caller attaches
   the Disk at a higher Round, then restores. The restored sandbox's filesystem is
   re-attached, never carried in the image.

Acceptance: checkpoint a running build to a bucket, restore it on another node of
the same architecture, and observe the build continue to a correct result; the
Disk's contents equal their contents at suspend. Restore the same image under a
different build and see the refusal of item 3. Alter one byte of the image in the
bucket and see the refusal of item 2.

### §5 What is not specified here

An OCI mount type that connects a host socket to the sandbox's FUSE client, with
no gofer between them and no privilege in the guest, is an option and not a
requirement. It is worth building only if the path of §2 is shown to be the
bottleneck once the Disk's journal (HIP-1342, §6) is in. A native sentry
filesystem over the Disk's objects is unmeasured and is not specified. The
execution daemon that runs inside a sandbox, and the wire on which the runtime's
own processes call one another, are separate contracts.

## Rationale

*The gofer path, not a FUSE mount in the sandbox.* The path through the gofer
adds tens of microseconds to an operation whose commit to the store costs
milliseconds, and it keeps the store credential and the key on the host and out of
the process that runs hostile code. A mount inside the sandbox puts a FUSE daemon,
its credential and `CAP_SYS_ADMIN` there, and today it also breaks §3.

*Exclusive access.* Revalidating every entry against the host is the safe default
for a directory several processes share. A Disk is not shared: the fence guarantees
one writer, so the default only costs time. The condition in §2 item 2 keeps the
setting from being used where it would serve stale files.

*Sealed images.* Hanzo's object store is trusted to hold ciphertext only
(HIP-1342). A memory image is the least structured plaintext a sandbox has, and
restore runs with privilege on a node; authenticating the image protects the data
going out and the node coming back.

## Security Considerations

The runtime is the boundary. A defect in the sentry is an escape from the sandbox,
which is why the fork follows its upstream's isolation model and why §1 refuses
configurations that move work out of it.

Exclusive access caches what it was told is private. If another writer modified the
directory, the sandbox would read stale entries and could act on them. HIP-1342's
fence is what makes the assumption true, and §2 item 2 is the guard against its use
elsewhere.

A sandbox that holds the store credential or the Disk key can read every object of
its Disk's bucket, or every other Disk under the same credential. The sandbox gets a
directory and nothing else. A checkpoint image can leak whatever the process held;
the image is sealed under a key the caller holds, and an image that was not sealed
by that key is refused, which also keeps a forged image from reaching a privileged
restore.

## References

- HIP-0135 — What Is Public
- HIP-1146 — Sandbox — A Lease on Isolated Compute
- HIP-1342 — Disk — A Filesystem on an Object Store
- RFC 2119 — Key words for use in RFCs

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
