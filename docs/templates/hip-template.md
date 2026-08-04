---
hip: 0000
title: The Thing This Specifies
author: Hanzo AI
type: Standards Track
category: Infrastructure
status: Draft
created: 2026-01-01
requires: HIP-0119
---

# HIP-0000: The Thing This Specifies

## Abstract

What this specifies and what changes if it is adopted, in a paragraph someone
can read without reading the rest. Name the repository this HIP describes.

A Standards Track HIP describes **one thing we build and maintain**, and that
thing has one public repository. If two HIPs describe one repository, one of
them is redundant; if a HIP describes no repository, it is fiction.

## Motivation

Why this exists. What is broken, what it costs, and what has already been tried.
Optional, and worth writing anyway: a specification without one is a pile of
requirements nobody can weigh against each other.

## Specification

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted
as in RFC 2119.

The normative content. Number the sections if there are more than a handful, and
number them consistently — a subsection of §3 is §3.1, never §2.1.

State requirements directly and make each one falsifiable. "Fast" is not a
requirement; "answers in under 50 ms at the 99th percentile" is. Do not define a
requirement by comparison to another company's product: it cannot be tested, it
dates the document, and it frames our work as derivative. Naming a third-party
product as a fact — a wire format we implement, an upstream we fork, a licence
we inherit — is legitimate and stays.

Anything a reader needs in order to implement this MUST be public. If the
specification depends on a private repository, either the HIP is leaking work
that is not a standard, or the dependency should be public. Those are different
problems; say which one it is. See HIP-0135 for where that line sits.

Quote measured numbers with the command that produced them and the date they
were taken, so the next reader can re-measure rather than trust.

## Rationale

Why this design and not the obvious alternative. Name the alternative and say
what it costs.

## Security Considerations

What an attacker gets if this is implemented wrongly. Every HIP that touches
identity, secrets, tenancy or the network needs this section and needs it to be
specific.

## References

- HIP-0119 — Hanzo Service Conventions
- HIP-0135 — What Is Public

## Copyright

Released under CC0 1.0 Universal Public Domain Dedication.
