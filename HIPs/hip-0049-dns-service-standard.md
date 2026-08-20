---
hip: 0049
title: DNS Service Standard
author: Hanzo AI Team
type: Standards Track
category: Infrastructure
status: Active
created: 2026-02-23
requires: HIP-0014, HIP-0026, HIP-0027
capability: dns
---


# HIP-0049: DNS Service Standard

## Abstract

This proposal defines the DNS service standard for the Hanzo ecosystem. Hanzo DNS is a managed DNS infrastructure that handles authoritative resolution for all Hanzo-operated domains, customer vanity domains, and internal service discovery within Kubernetes clusters. It provides split-horizon resolution (different answers for internal vs external queries), DNSSEC signing for tamper-proof responses, geo-aware routing for the Hanzo Edge CDN, and automatic record provisioning when services are deployed via Platform (HIP-14).

The system is built on **CoreDNS**, a Go-based, plugin-chained DNS server originally created for cloud-native environments. CoreDNS replaces the default `kube-dns` in both Hanzo Kubernetes clusters and doubles as the authoritative nameserver for public-facing domains. Custom Hanzo plugins extend CoreDNS with API-driven record management, ACME certificate orchestration, and health-aware geo-routing.

**Repository**: [github.com/hanzoai/dns](https://github.com/hanzoai/dns)
**Ports**: 53 (DNS), 8053 (Management API)
**Docker**: `ghcr.io/hanzoai/dns:latest`
**Authoritative NS**: `ns1.hanzo.ai`, `ns2.hanzo.ai`

## Motivation

### The Problem

Hanzo operates 40+ domains across four organizations (hanzo.ai, lux.network, zoo.ngo, pars.id) and two Kubernetes clusters. Without a unified DNS layer, domain management fragments across multiple providers and manual processes:

1. **Registrar-level DNS management**: Each domain's records are edited in a registrar web UI. A PaaS deployment that takes 30 seconds is followed by a DNS change that takes 30 minutes of human coordination.

2. **No service discovery**: Pods reach each other via `<service>.<namespace>.svc.cluster.local` inside the cluster. Outside, developers hardcode endpoints. When an IP changes, every hardcoded reference breaks.

3. **No geo-routing**: All DNS queries resolve to the same IP regardless of location. A user in Frankfurt adds 80ms of latency hitting a New York endpoint.

4. **No DNSSEC**: A compromised resolver can redirect `hanzo.id` to a phishing page. For an identity provider handling OAuth tokens, this is a compliance requirement, not a theoretical risk.

5. **Manual certificate provisioning**: Wildcard TLS certificates require DNS-01 ACME challenges, which require programmatic DNS record creation. Without a DNS API, certificate renewal breaks at 3 AM.

6. **Split-horizon gap**: Internal services (SQL, KV, KMS) should resolve to cluster-internal IPs from within the cluster and should not resolve at all from the public internet.

### What Hanzo DNS Solves

A single DNS service eliminates all six problems. Platform creates DNS records automatically on deploy. Internal services resolve via `*.<namespace>.svc` without touching public DNS. DNSSEC signs every zone. Geo-routing directs users to the nearest edge. Wildcard certificates renew unattended. Engineers never log in to a registrar dashboard again.

## Specification

 CAA | Certificate authority auth | `hanzo.ai -> 0 issue letsencrypt.org` |
| NS | Nameserver delegation | `hanzo.ai -> ns1.hanzo.ai` |

DNSSEC-related types (RRSIG, DNSKEY, DS, NSEC/NSEC3) are generated automatically by the signing plugin and are not managed via the API.

### Management API

The management API provides CRUD operations for DNS records. It runs on port 8053 and authenticates via IAM JWT tokens (HIP-26).

**Base URL**: `http://localhost:8053/v1` (internal), `https://api.hanzo.ai/v1/dns` (external, via API Gateway)

#### Endpoints

```
GET    /v1/zones                          List all zones
GET    /v1/zones/{zone}                   Get zone details
POST   /v1/zones                          Create a zone

GET    /v1/zones/{zone}/records           List records in zone
POST   /v1/zones/{zone}/records           Create a record
GET    /v1/zones/{zone}/records/{id}      Get a record
PUT    /v1/zones/{zone}/records/{id}      Update a record
DELETE /v1/zones/{zone}/records/{id}      Delete a record

POST   /v1/zones/{zone}/records/batch     Batch create/update/delete
POST   /v1/zones/{zone}/verify            Verify zone delegation
POST   /v1/zones/{zone}/sign              Trigger DNSSEC re-signing
GET    /v1/zones/{zone}/export            Export zone in RFC 1035 format
```

#### Record Schema

```json
{
  "id": "rec_abc123", "zone": "hanzo.ai", "name": "api",
  "type": "A", "value": "24.199.76.156", "ttl": 300,
  "geo": {
    "enabled": true,
    "regions": { "na": "24.199.76.156", "eu": "138.68.100.42", "ap": "128.199.200.15" }
  },
  "metadata": { "managed_by": "platform", "deployment_id": "dep_xyz789" }
}
```

Records with `metadata.managed_by: "platform"` are owned by Platform (HIP-14) and should not be edited manually. The API warns if a user attempts to modify a platform-managed record.

### Automatic DNS Provisioning (Platform Integration)

When Platform (HIP-14) deploys a service with custom domains, it calls the DNS management API to create or update records:

```
1. Developer adds `cloud.hanzo.ai` to service domains in hanzo.yaml
2. Developer runs `hanzo deploy`
3. Platform builds and deploys the container
4. Platform calls DNS API:
   POST /v1/zones/hanzo.ai/records
   { "name": "cloud", "type": "A", "value": "<load-balancer-ip>",
     "metadata": { "managed_by": "platform", "deployment_id": "..." } }
5. Platform requests TLS certificate via ACME DNS-01 challenge:
   POST /v1/zones/hanzo.ai/records
   { "name": "_acme-challenge.cloud", "type": "TXT",
     "value": "<challenge-token>", "ttl": 60 }
6. ACME validates, certificate issued
7. Platform deletes the challenge TXT record
8. Service is live at https://cloud.hanzo.ai
```

The entire flow -- deploy, DNS record, TLS certificate -- completes in under 60 seconds with no human intervention.

### Geo-Aware Routing

For domains served by Hanzo Edge (CDN), the `hanzo_geo` plugin returns different IP addresses based on the querier's geographic location. The plugin uses a MaxMind GeoIP2 database (updated weekly) to map resolver IPs to regions.

```json
// edge.json -- geo-routing configuration
{
  "api.hanzo.ai": {
    "default": "24.199.76.156",
    "regions": {
      "NA": "24.199.76.156",
      "EU": "138.68.100.42",
      "AP": "128.199.200.15"
    },
    "healthcheck": {
      "interval": "10s",
      "path": "/health",
      "timeout": "3s"
    }
  }
}
```

If the nearest region's endpoint fails its health check, the plugin falls back to the next nearest region. If all regional endpoints are down, it returns the default. Health status is shared across CoreDNS instances via a lightweight gossip protocol on a dedicated UDP port (8054).

### DNSSEC

All authoritative zones are signed with DNSSEC using ECDSAP256SHA256 (algorithm 13). This provides cryptographic proof that DNS responses have not been tampered with in transit.

**Key management**:

| Key Type | Algorithm | Rotation | Storage |
|----------|-----------|----------|---------|
| KSK (Key Signing Key) | ECDSAP256SHA256 | Annual | KMS (HIP-27) |
| ZSK (Zone Signing Key) | ECDSAP256SHA256 | Monthly | Local filesystem |

The KSK is stored in KMS because its DS record must be registered with the parent zone (the TLD registry). Rotating the KSK requires coordinating with the registrar, so it rotates infrequently. The ZSK rotates monthly via automated key rollover -- CoreDNS generates a new ZSK, signs the zone with both old and new keys during the transition period, and retires the old key after 2x the zone's maximum TTL.

**Signing flow**:

```
Zone data (records) --> CoreDNS dnssec plugin --> Signed zone (RRSIG records)
                              |
                        ZSK (local) + KSK (from KMS)
```

### Wildcard Certificates via ACME

Hanzo DNS integrates with the ACME protocol (Let's Encrypt) to automate wildcard certificate issuance. The flow uses DNS-01 challenges, which require creating a TXT record at `_acme-challenge.<domain>`:

```
1. Platform or Edge requests wildcard cert for *.hanzo.ai
2. ACME client calls DNS API:
   POST /v1/zones/hanzo.ai/records
   { "name": "_acme-challenge", "type": "TXT", "value": "<token>", "ttl": 60 }
3. CoreDNS serves the TXT record immediately (no propagation delay)
4. Let's Encrypt validates the challenge
5. Certificate issued, challenge record deleted
6. Certificate stored in KMS (HIP-27) and distributed to Traefik/Edge
```

Because the DNS server and the ACME client are co-located in the same cluster, challenge propagation is instant. There is no waiting for DNS TTLs to expire at upstream resolvers. This reduces wildcard certificate issuance from minutes to seconds.

### Zone Configuration

Each organization manages its own zones. Zone ownership is enforced by the management API via IAM org membership.

| Zone | Organization | Purpose |
|------|-------------|---------|
| `hanzo.ai` | hanzo | Core platform services |
| `hanzo.app` | hanzo | Application frontend |
| `hanzo.id` | hanzo | Identity and access management |
| `hanzo.network` | hanzo | Edge and CDN |
| `lux.network` | lux | Blockchain services |
| `lux.id` | lux | Lux identity |
| `zoo.ngo` | zoo | Research network |
| `zoo.id` | zoo | Zoo identity |
| `pars.id` | pars | Pars identity |

Customer vanity domains (e.g., `api.customer.com`) are supported via CNAME delegation. The customer creates a CNAME record at their registrar pointing to `<app>.edge.hanzo.network`, and Hanzo DNS handles the rest.

## Implementation

### CoreDNS Plugin Chain

The Hanzo DNS server is a custom CoreDNS build with four Hanzo-specific plugins compiled in:

```go
// plugin.cfg (CoreDNS build configuration)
// Standard plugins
log:log
errors:errors
cache:cache
kubernetes:kubernetes
acl:acl
health:health
ready:ready
prometheus:metrics

// Hanzo plugins
hanzo_records:github.com/hanzoai/dns/plugin/records
hanzo_geo:github.com/hanzoai/dns/plugin/geo
hanzo_acme:github.com/hanzoai/dns/plugin/acme
hanzo_sync:github.com/hanzoai/dns/plugin/sync
```

| Plugin | Lines of Go | Purpose |
|--------|-------------|---------|
| `hanzo_records` | ~350 | Fetch records from management API, serve from memory |
| `hanzo_geo` | ~250 | GeoIP-based response selection with health checks |
| `hanzo_acme` | ~200 | ACME DNS-01 challenge record injection |
| `hanzo_sync` | ~150 | Zone transfer (AXFR/IXFR) between primary and secondary |

### Management API Implementation

The management API is a standalone Go binary that stores records in an embedded BoltDB database. BoltDB was chosen over SQL to maintain the zero-external-dependency constraint -- DNS cannot depend on the database it helps other services discover. The API and CoreDNS run as separate containers in the same pod, communicating over localhost on port 8053.

On each record mutation, the API: (1) validates the JWT against IAM JWKS, (2) checks org membership matches zone ownership, (3) validates the record format, (4) writes to BoltDB, (5) notifies the CoreDNS plugin to refresh its in-memory zone, and (6) triggers an IXFR to the secondary if configured.

### Deployment

Each pod runs two containers: CoreDNS (port 53, 9153) and the management API (port 8053). Two replicas in `kube-system` namespace with anti-affinity ensure DNS survives a single node failure. Resource allocation: CoreDNS at 100m-500m CPU, 64Mi-256Mi memory; API at 50m-250m CPU, 32Mi-128Mi memory. DNSSEC keys are mounted from a Kubernetes Secret; zone data is on a PersistentVolumeClaim; the Corefile is a ConfigMap.

### Metrics

Prometheus metrics are exported on port 9153 with namespace `hanzo_dns`:

| Metric | Type | Description |
|--------|------|-------------|
| `hanzo_dns_queries_total` | Counter | Total queries by zone, type, response code |
| `hanzo_dns_query_duration_seconds` | Histogram | Query latency distribution |
| `hanzo_dns_cache_hits_total` | Counter | Cache hit/miss by zone |
| `hanzo_dns_geo_responses_total` | Counter | Geo-routed responses by region |
| `hanzo_dns_dnssec_signatures_total` | Counter | DNSSEC signatures generated |
| `hanzo_dns_api_requests_total` | Counter | Management API requests by method, status |
| `hanzo_dns_zone_records_count` | Gauge | Record count per zone |
| `hanzo_dns_edge_health` | Gauge | Edge endpoint health by region (0/1) |

### CLI Integration

```bash
# Zone management
hanzo dns zones                              # List zones
hanzo dns zones create lux.network           # Create a zone

# Record management
hanzo dns records hanzo.ai                   # List records for hanzo.ai
hanzo dns records hanzo.ai add               # Interactive record creation
hanzo dns records hanzo.ai add \
  --name api --type A --value 24.199.76.156  # Non-interactive
hanzo dns records hanzo.ai delete rec_abc123 # Delete a record

# Diagnostics
hanzo dns dig api.hanzo.ai                   # Query the authoritative server
hanzo dns verify hanzo.ai                    # Verify delegation and DNSSEC chain
hanzo dns export hanzo.ai                    # Export zone file (RFC 1035)
```

## Security Considerations

### DNSSEC Chain of Trust

DNSSEC provides end-to-end integrity from the root zone to the individual record. The chain is: root (.) -> TLD (.ai) -> hanzo.ai -> api.hanzo.ai. Each link is verified cryptographically. A compromised resolver cannot forge responses because it does not possess the signing keys.

The DS (Delegation Signer) record for each zone must be registered with the parent TLD. This is a one-time manual step per zone (automated via registrar API where supported).

### Key Security

- **KSK** is stored in KMS (HIP-27) with restricted access. Only the DNS service's Universal Auth identity can read it.
- **ZSK** is generated locally and never leaves the CoreDNS pod. It rotates monthly with automated pre-publication rollover.
- **API authentication** uses IAM JWT tokens. Every API call is logged with the acting user, organization, and timestamp.
- **Zone transfer** between primary and secondary uses TSIG (Transaction Signature) with HMAC-SHA256 to prevent unauthorized zone copies.

### Rate Limiting

The DNS server enforces per-source rate limits to mitigate DNS amplification attacks:

- **UDP queries**: 100 queries/second per source IP. Excess queries receive REFUSED.
- **TCP queries**: 20 connections/second per source IP.
- **ANY queries**: Dropped. ANY is the primary vector for DNS amplification and has no legitimate use in modern DNS.
- **Management API**: 100 requests/minute per authenticated user.

### Access Control

| Actor | DNS Query (53) | Management API (8053) |
|-------|---------------|----------------------|
| Internet | Public zones only | Via API Gateway + JWT |
| Cluster pods | Public + internal zones | Direct + JWT |
| Platform | Public + internal zones | Service account (auto-provisioning) |
| CoreDNS secondary | Zone transfer (TSIG) | N/A |

### Preventing Zone Hijacking

- Zone creation requires IAM admin role for the target organization.
- Domain ownership is verified via DNS TXT record (`_hanzo-verify.<domain>`) before the zone becomes active.
- Managed records (created by Platform) cannot be deleted via the API without the `force: true` flag, which triggers an audit log alert.

## References

1. [CoreDNS Documentation](https://coredns.io/manual/toc/)
2. [CoreDNS Plugin Development](https://coredns.io/2017/03/01/how-to-add-plugins-to-coredns/)
3. [RFC 1035 - Domain Names: Implementation and Specification](https://tools.ietf.org/html/rfc1035)
4. [RFC 4033 - DNS Security Introduction and Requirements (DNSSEC)](https://tools.ietf.org/html/rfc4033)
5. [RFC 4034 - Resource Records for DNSSEC](https://tools.ietf.org/html/rfc4034)
6. [RFC 8555 - ACME Protocol](https://tools.ietf.org/html/rfc8555)
7. [RFC 2845 - TSIG for DNS](https://tools.ietf.org/html/rfc2845)
8. [MaxMind GeoIP2](https://www.maxmind.com/en/geoip2-databases)
9. [HIP-14: Application Deployment Standard](./hip-0014-application-deployment-standard.md)
10. [HIP-26: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md)
11. [HIP-27: Secrets Management Standard](./hip-0027-secrets-management-standard.md)
12. HIP-44: API Gateway Standard
13. [Hanzo DNS Repository](https://github.com/hanzoai/dns)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
