---
hip: 0056
title: PubSub Real-Time Messaging Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-02-23
---

# HIP-56: PubSub Real-Time Messaging Standard

## Abstract

This proposal defines the real-time publish/subscribe messaging standard for the Hanzo ecosystem. Hanzo PubSub provides topic-based message routing, presence awareness, and channel access control over WebSocket and Server-Sent Events (SSE) transports. It is the canonical layer for streaming LLM token output to browsers, broadcasting agent events, powering collaborative AI sessions, and delivering real-time notifications across Hanzo services.

**Repository**: [github.com/hanzoai/pubsub](https://github.com/hanzoai/pubsub)
**Ports**: 8056 (HTTP/REST API), 8057 (WebSocket)
**Status**: Draft

## Motivation

Several Hanzo services already need real-time client-facing messaging:

1. **Chat** (HIP-11) streams LLM tokens to browsers. Today each Chat instance manages its own SSE connections. When Chat scales horizontally behind a load balancer, a token produced on node A cannot reach a browser connected to node B without a shared pub/sub bus.

2. **Bot** (HIP-25) agents generate events -- tool calls, status changes, billing ticks -- that multiple dashboards and monitoring services need simultaneously. Without fan-out, each consumer polls an API or opens a dedicated connection to the agent process.

3. **Collaborative sessions** require presence awareness. When two users share a Chat session or co-pilot an agent, each needs to see who is connected and what the other is doing. No existing Hanzo service provides presence.

4. **Late joiners** need history. A user who opens a browser tab mid-conversation needs the last N messages, not a blank screen.

Without a unified PubSub service, each team solves these problems independently: Chat builds its own Redis pub/sub adapter, Bot builds its own WebSocket fan-out, and the console builds its own presence tracker. The result is duplicated infrastructure, inconsistent guarantees, and no shared access control.

HIP-56 consolidates real-time client delivery into one service.

## Design Philosophy

This section explains what PubSub is, what it is not, and why the alternatives do not fit.

### Why Not Just WebSockets?

A WebSocket is a transport, not a messaging system. Opening a WebSocket gives you a bidirectional byte pipe between one client and one server process. You still need to answer:

- **Routing**: Which messages go to which clients? If 500 clients subscribe to `chat.session.abc`, the server must maintain a subscription table and iterate over it on every publish.
- **Server-side publish**: When the LLM Gateway finishes generating a token, it needs to push that token to all subscribers. The Gateway process is not the WebSocket process. Something must bridge the gap.
- **Presence**: Who is connected right now? WebSockets give you `onopen` and `onclose` per connection, but aggregating that across a cluster requires shared state.
- **History**: WebSockets are ephemeral. If a client disconnects and reconnects, everything sent during the gap is lost.

PubSub answers all four questions with a single service. WebSocket (and SSE) remain the transports -- PubSub is the routing, fan-out, presence, and history layer on top.

### Why Not Firebase / Pusher / Ably?

Third-party real-time services solve the problem technically but fail on three counts:

1. **Data sovereignty.** AI conversations contain sensitive data -- prompts, tool outputs, internal agent reasoning. Routing this through a third-party SaaS violates the data residency requirements of enterprise customers and our own security posture.

2. **Cost at scale.** Pusher and Ably charge per message and per concurrent connection. A single Chat user generating a 2000-token response produces 2000 messages. At 10,000 concurrent users, costs become untenable.

3. **Integration depth.** Hanzo PubSub integrates directly with IAM (hanzo.id) for authentication, with Stream (HIP-30) for durable event logging, and with the LLM Gateway (HIP-4) for token delivery. Third-party services require custom adapter layers for each integration.

**Decision**: Self-hosted. The operational cost of running a PubSub service is lower than the financial and architectural cost of a third-party dependency at our scale.

### How PubSub Differs from Stream (HIP-30)

Hanzo Stream is a **durable event log** built on Kafka. Its core property is replay: consumers can rewind to any offset and reprocess events. Stream is designed for server-to-server communication where durability and ordering matter more than latency.

Hanzo PubSub is a **real-time fan-out layer** for client-facing delivery. Its core property is low-latency broadcast: a message published to a topic reaches all current subscribers within milliseconds. PubSub is designed for server-to-client (and client-to-client) communication where immediacy matters more than durability.

| Property | Stream (HIP-30) | PubSub (HIP-56) |
|----------|-----------------|------------------|
| Primary consumers | Backend services | Browsers, mobile apps, agents |
| Transport | Kafka TCP protocol | WebSocket, SSE, HTTP |
| Retention | Days to months | Minutes to hours (configurable) |
| Replay | Full offset-based replay | Bounded history replay |
| Presence | No | Yes |
| Access control | Service credentials | Per-user, per-org, per-agent |
| Fan-out model | Consumer groups (each group gets one copy) | Broadcast (every subscriber gets every message) |

They complement each other. A typical flow: the LLM Gateway writes a `llm_usage` event to Stream for billing, AND publishes the generated token to PubSub for browser delivery.

### How PubSub Differs from MQ (HIP-55)

Hanzo MQ (HIP-55) is a **task queue**. Its core property is exactly-once delivery: a message is delivered to exactly one worker, acknowledged, and removed. MQ is designed for distributing work across a pool of workers.

PubSub is a **broadcast system**. Its core property is fan-out: a message is delivered to ALL subscribers of a topic. No acknowledgment, no removal after delivery.

| Property | MQ (HIP-55) | PubSub (HIP-56) |
|----------|-------------|------------------|
| Delivery | Exactly one consumer | All subscribers |
| Acknowledgment | Required | Not applicable |
| Use case | Background jobs, task distribution | Real-time notifications, streaming |
| Message lifetime | Until acknowledged | Until TTL expires |
| Ordering | FIFO per queue | Ordered per topic |

When a user sends a message in Chat, MQ dispatches the inference job to a worker. When the worker produces tokens, PubSub broadcasts them to the user's browser. Different tools, different jobs.

## Specification

### Topics

A topic is a named channel for message delivery. Topics use dot-separated hierarchical names:

```
chat.session.<session_id>          # Tokens and messages for a chat session
agent.<agent_id>.events            # Events from a specific agent
org.<org_id>.notifications         # Organization-wide notifications
user.<user_id>.alerts              # User-specific alerts
system.announcements               # Platform-wide announcements
```

#### Wildcard Subscriptions

Subscribers MAY use wildcards to match multiple topics:

- `*` matches exactly one segment: `chat.session.*` matches `chat.session.abc` but not `chat.session.abc.tokens`
- `**` matches one or more segments: `agent.**` matches `agent.bot1.events` and `agent.bot1.tools.calls`

Wildcards are resolved at subscription time. The server expands wildcards against existing topics and dynamically matches new topics as they are created.

### Message Format

Every message on the wire uses the following envelope:

```json
{
  "id": "msg_01HZ3X...",
  "topic": "chat.session.sess_abc123",
  "type": "token",
  "data": {
    "content": "Hello",
    "index": 42
  },
  "sender": {
    "type": "service",
    "id": "llm-gateway-01"
  },
  "timestamp": 1740307200000,
  "ttl": 3600
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique message ID (ULID recommended for sortability) |
| `topic` | string | Yes | Destination topic |
| `type` | string | Yes | Application-defined message type |
| `data` | object | Yes | Message payload (arbitrary JSON) |
| `sender` | object | No | Publisher identity |
| `timestamp` | integer | Yes | Unix epoch milliseconds |
| `ttl` | integer | No | Time-to-live in seconds for history retention |

### Message Types

The following message types are standardized across the ecosystem. Applications MAY define additional types.

| Type | Source | Description |
|------|--------|-------------|
| `token` | LLM Gateway | Single token in a streaming response |
| `message.complete` | Chat | Full message after streaming completes |
| `message.edit` | Chat | Edited message content |
| `tool.call` | Agent | Agent invoking an MCP tool |
| `tool.result` | Agent | Result returned from a tool |
| `agent.status` | Bot | Agent status change (thinking, idle, error) |
| `presence.join` | PubSub | Client joined a topic |
| `presence.leave` | PubSub | Client left a topic |
| `presence.update` | Client | Presence metadata update (e.g., typing indicator) |
| `notification` | Any service | Generic notification |

### Transports

PubSub supports two client-facing transports. Both deliver the same message envelope.

#### WebSocket (Port 8057)

Primary transport for bidirectional communication. Clients connect, authenticate, then subscribe and publish.

```
wss://pubsub.hanzo.ai:8057/ws
```

**Connection lifecycle**:

```
Client                              Server
  │                                    │
  │──── WebSocket handshake ──────────▶│
  │◀─── 101 Switching Protocols ──────│
  │                                    │
  │──── { "type": "auth",             │
  │       "token": "Bearer ey..." } ──▶│
  │◀─── { "type": "auth.ok",          │
  │       "client_id": "cl_abc" } ────│
  │                                    │
  │──── { "type": "subscribe",         │
  │       "topics": ["chat.session.*"] │
  │     } ───────────────────────────▶│
  │◀─── { "type": "subscribed",        │
  │       "topics": ["chat.session.*"],│
  │       "history": [...] } ─────────│
  │                                    │
  │◀─── { "type": "message",           │
  │       ... envelope ... } ─────────│
  │                                    │
  │──── { "type": "publish",           │
  │       "topic": "...",              │
  │       "data": {...} } ───────────▶│
  │                                    │
  │──── { "type": "unsubscribe",       │
  │       "topics": ["chat.session.*"] │
  │     } ───────────────────────────▶│
  │                                    │
  │──── { "type": "ping" } ──────────▶│
  │◀─── { "type": "pong" } ──────────│
```

**Client-to-server message types**:

| Type | Fields | Description |
|------|--------|-------------|
| `auth` | `token` | Bearer token or API key |
| `subscribe` | `topics`, `since?` | Subscribe to topics, optionally replay from timestamp |
| `unsubscribe` | `topics` | Unsubscribe from topics |
| `publish` | `topic`, `type`, `data` | Publish a message |
| `presence.update` | `data` | Update presence metadata |
| `ping` | -- | Keepalive |

**Server-to-client message types**:

| Type | Fields | Description |
|------|--------|-------------|
| `auth.ok` | `client_id` | Authentication succeeded |
| `auth.error` | `code`, `message` | Authentication failed |
| `subscribed` | `topics`, `history?` | Subscription confirmed, optional history |
| `message` | (full envelope) | Published message |
| `presence.snapshot` | `topic`, `members` | Current presence state |
| `pong` | -- | Keepalive response |
| `error` | `code`, `message` | Error |

#### Server-Sent Events (Port 8056)

Read-only transport for environments where WebSocket is unavailable or unnecessary (corporate proxies, simple dashboards).

```
GET /v1/subscribe?topics=chat.session.abc&since=1740307200000
Authorization: Bearer ey...
Accept: text/event-stream
```

Response:

```
event: subscribed
data: {"topics":["chat.session.abc"],"history":[...]}

event: message
data: {"id":"msg_01HZ...","topic":"chat.session.abc","type":"token","data":{"content":"Hello"}}

event: presence
data: {"topic":"chat.session.abc","members":[{"id":"user_1","name":"Alice","status":"typing"}]}

: keepalive
```

SSE clients publish via the REST API (below).

### REST API (Port 8056)

For publishing from backend services and SSE clients.

```yaml
# Publish a message
POST /v1/topics/:topic/messages
Authorization: Bearer <service-token>
Body:
  type: string
  data: object
  ttl?: integer
Response:
  id: string
  timestamp: integer

# Get topic history
GET /v1/topics/:topic/history
Authorization: Bearer <token>
Query:
  since?: integer    # Unix ms timestamp
  limit?: integer    # Max messages (default 50, max 500)
  before?: string    # Message ID for cursor pagination
Response:
  messages: Message[]
  has_more: boolean

# Get presence for a topic
GET /v1/topics/:topic/presence
Authorization: Bearer <token>
Response:
  members: PresenceMember[]

# List active topics (admin)
GET /v1/topics
Authorization: Bearer <admin-token>
Query:
  prefix?: string
  limit?: integer
Response:
  topics: TopicInfo[]
```

### Presence

Presence tracks which clients are currently subscribed to a topic and their metadata.

```typescript
interface PresenceMember {
  client_id: string;
  user_id: string;
  name: string;
  avatar_url?: string;
  status?: string;           // "online", "typing", "idle"
  metadata?: Record<string, any>;
  joined_at: number;         // Unix ms
  last_seen: number;         // Unix ms
}
```

**Presence lifecycle**:

1. Client subscribes to a topic -- server broadcasts `presence.join` to all other subscribers
2. Client sends `presence.update` -- server broadcasts the update
3. Client disconnects (or times out) -- server broadcasts `presence.leave`
4. New subscriber receives a `presence.snapshot` with all current members

Presence data is ephemeral. It is not persisted to disk. If the PubSub server restarts, presence rebuilds as clients reconnect.

**Timeout**: If a client sends no messages (including `ping`) for 30 seconds, the server considers it disconnected and broadcasts `presence.leave`.

### Channel Access Control

Every topic maps to an access control policy evaluated against the subscriber's identity from IAM (hanzo.id).

```yaml
# Access control rules (evaluated top to bottom, first match wins)
rules:
  # Organization topics: members of the org
  - pattern: "org.<org_id>.**"
    require:
      org_membership: "<org_id>"

  # Chat sessions: session owner or shared users
  - pattern: "chat.session.<session_id>"
    require:
      any:
        - session_owner: "<session_id>"
        - session_shared: "<session_id>"

  # Agent events: org members where agent is deployed
  - pattern: "agent.<agent_id>.**"
    require:
      agent_access: "<agent_id>"

  # User-specific: only the user themselves
  - pattern: "user.<user_id>.**"
    require:
      user_id: "<user_id>"

  # System announcements: all authenticated users
  - pattern: "system.**"
    require:
      authenticated: true
```

**Publish permissions** are separate from subscribe permissions. By default, only backend services (identified by service tokens) can publish. Clients can publish only to topics where the access control rule explicitly grants `publish: true`.

### Message History and Replay

PubSub retains recent messages in memory (backed by Redis) for late-joiner replay.

**Configuration**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `history.max_messages` | 100 | Max messages retained per topic |
| `history.max_age` | 3600 | Max age in seconds |
| `history.storage` | `redis` | Backend: `redis` or `memory` |

**Replay on subscribe**: When a client subscribes with a `since` timestamp, the server returns all retained messages after that timestamp (up to the configured limit) in the `subscribed` response.

**Relationship to Stream (HIP-30)**: PubSub history is short-lived and bounded. For durable, long-term event storage, services SHOULD also write events to Stream. PubSub handles "show the user the last 2 minutes"; Stream handles "reprocess all events from last Tuesday."

## Implementation

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Clients                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐    │
│  │ Browser │  │ Mobile  │  │Dashboard│  │ Agent Dashboard │    │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘    │
│       │ WS         │ WS        │ SSE             │ WS          │
└───────┼────────────┼───────────┼─────────────────┼──────────────┘
        │            │           │                 │
        ▼            ▼           ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Load Balancer (sticky sessions)                │
└───────────────────────────┬──────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ PubSub   │  │ PubSub   │  │ PubSub   │
        │ Node 1   │  │ Node 2   │  │ Node 3   │
        └─────┬────┘  └─────┬────┘  └─────┬────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                      ┌──────┴──────┐
                      │    Redis    │
                      │  (pub/sub   │
                      │  + history) │
                      └─────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Publishers                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │LLM Gateway │  │   Chat     │  │    Bot     │  │   IAM      │ │
│  │  (HIP-4)   │  │  (HIP-11)  │  │  (HIP-25)  │  │ (hanzo.id) │ │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**Redis as the inter-node bus**: Each PubSub node manages its own set of WebSocket/SSE connections. When a publisher sends a message to Node 1, Node 1 writes to Redis pub/sub. Nodes 2 and 3 receive the message from Redis and forward it to their local subscribers. Redis also stores message history for replay.

This architecture scales horizontally. Adding a PubSub node adds connection capacity without changing the routing topology.

### Fan-Out for Millions of Connections

At scale, a single Redis instance becomes a bottleneck. The fan-out architecture layers:

1. **Connection layer**: PubSub nodes accept and manage WebSocket/SSE connections. Each node handles 50,000-100,000 concurrent connections.
2. **Routing layer**: Redis Cluster (or KeyDB) distributes topics across shards. Each shard handles pub/sub for a subset of topics.
3. **Edge layer** (optional): For global deployment, edge PubSub nodes in each region subscribe to the central routing layer and serve local clients. Reduces latency for geographically distributed users.

Target: 1 million concurrent connections with 3 PubSub nodes + 3-node Redis Cluster.

### Integration with Chat (HIP-11)

Today, Chat uses per-process SSE for token streaming. With PubSub:

1. User sends a message via Chat API
2. Chat dispatches inference to LLM Gateway (HIP-4)
3. LLM Gateway publishes tokens to `chat.session.<id>` via PubSub REST API
4. PubSub delivers tokens to all browsers subscribed to that session
5. Chat writes the completed message to its database

This decouples token production (Gateway) from token delivery (PubSub), enabling horizontal scaling of both independently.

### Integration with Bot (HIP-25)

Bot agents emit events (tool calls, status changes, billing ticks) that multiple consumers need:

1. Agent executes a tool call
2. Bot publishes `tool.call` to `agent.<id>.events` via PubSub
3. The agent dashboard, the monitoring service, and the billing aggregator all receive the event simultaneously
4. For durable processing, Bot also writes the event to Stream (HIP-30)

### Deployment

```yaml
# compose.yml
services:
  pubsub:
    image: hanzoai/pubsub:latest
    ports:
      - "8056:8056"   # REST API + SSE
      - "8057:8057"   # WebSocket
    environment:
      - REDIS_URL=redis://redis:6379
      - IAM_URL=https://hanzo.id
      - IAM_JWKS_URL=https://hanzo.id/.well-known/jwks.json
      - HISTORY_MAX_MESSAGES=100
      - HISTORY_MAX_AGE=3600
      - LOG_LEVEL=info
    depends_on:
      - redis
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 512M
          cpus: "1.0"

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

### Client SDK

```typescript
import { PubSub } from '@hanzoai/pubsub'

const ps = new PubSub({
  url: 'wss://pubsub.hanzo.ai:8057/ws',
  token: 'Bearer ey...',
})

// Subscribe with history replay
const sub = await ps.subscribe('chat.session.abc', {
  since: Date.now() - 60_000,  // last 60 seconds
  onMessage: (msg) => {
    if (msg.type === 'token') {
      appendToken(msg.data.content)
    }
  },
  onPresence: (members) => {
    updatePresenceUI(members)
  },
})

// Publish (if permitted)
await ps.publish('chat.session.abc', {
  type: 'presence.update',
  data: { status: 'typing' },
})

// Cleanup
sub.unsubscribe()
ps.disconnect()
```

```python
from hanzoai.pubsub import PubSubClient

ps = PubSubClient(
    url="wss://pubsub.hanzo.ai:8057/ws",
    token="Bearer ey...",
)

# Service-side publish
await ps.publish("agent.bot1.events", {
    "type": "agent.status",
    "data": {"status": "thinking", "task": "code_review"},
})

# Subscribe for monitoring
async for msg in ps.subscribe("agent.**.events"):
    log_agent_event(msg)
```

## Security Considerations

1. **Authentication required.** All connections MUST authenticate with a valid IAM token or API key before subscribing or publishing. Unauthenticated connections are closed after 5 seconds.

2. **Topic-level authorization.** Every subscribe and publish operation is checked against the channel access control rules. A valid token alone does not grant access to all topics.

3. **TLS everywhere.** WebSocket connections MUST use `wss://`. SSE connections MUST use `https://`. Plaintext connections are rejected in production.

4. **Rate limiting.** Publish rate is limited per client: 100 messages/second for service tokens, 10 messages/second for user tokens. Subscribers are not rate-limited (the server controls delivery rate).

5. **Message size limit.** Maximum message payload is 256 KB. Messages exceeding this limit are rejected with an error. For large payloads, publish a reference (URL or ID) and let the subscriber fetch the full content.

6. **No message persistence guarantees.** PubSub history is best-effort. If Redis loses data, history is lost. Services requiring durable delivery MUST also write to Stream (HIP-30).

7. **Connection limits.** Maximum 100 concurrent connections per user, 10,000 per organization. Exceeding the limit returns a `connection_limit` error.

8. **Injection prevention.** Topic names are validated against `^[a-zA-Z0-9._*-]+$`. Message payloads are validated as JSON. Invalid input is rejected.

9. **Audit logging.** Subscribe, unsubscribe, and publish events for sensitive topics (configurable) are logged to Stream (HIP-30) `audit_log` topic for compliance.

10. **Token rotation.** Long-lived WebSocket connections MUST re-authenticate when their token expires. The server sends an `auth.expiring` message 60 seconds before expiry. The client responds with a new `auth` message. Failure to re-authenticate results in disconnection.

## Performance Targets

| Metric | Target |
|--------|--------|
| Publish-to-delivery latency | < 50ms (p99) |
| Connection establishment | < 100ms |
| Concurrent connections per node | 100,000 |
| Messages per second (cluster) | 500,000 |
| History replay latency | < 200ms for 100 messages |
| Availability | 99.9% |

## References

1. [HIP-4: LLM Gateway Standard](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
2. [HIP-11: Chat Interface Standard](./hip-0011-chat-interface-standard.md)
3. [HIP-25: Bot Agent Wallet & RPC Billing Protocol](./hip-0025-bot-agent-wallet-rpc-billing-protocol.md)
4. [HIP-30: Event Streaming Standard](./hip-0030-event-streaming-standard.md)
5. [HIP-55: Message Queue Standard](./hip-0055-message-queue-standard.md)
6. [RFC 6455: The WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455)
7. [W3C Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
8. [Redis Pub/Sub Documentation](https://redis.io/docs/interact/pubsub/)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
