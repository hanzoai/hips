---
hip: 0061
title: Notification & Messaging Service Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2026-02-23
requires: HIP-0026, HIP-0017, HIP-0055
---

# HIP-61: Notification & Messaging Service Standard

## Abstract

Hanzo Notify is the unified notification and messaging service for the Hanzo ecosystem. It provides multi-channel delivery -- email, SMS, push notifications, in-app messages, and webhooks -- through a single API. Every service in the Hanzo platform sends notifications through Notify rather than integrating directly with delivery providers.

Notify includes a template engine with Handlebars rendering and optional LLM-powered personalization, multi-channel fallback chains (try push, then email, then SMS), delivery tracking integrated with Hanzo Insights (HIP-0017), and user preference management integrated with Hanzo IAM (HIP-0026). AI agents (HIP-0025) can send notifications on behalf of users, enabling autonomous workflows to communicate results without human intervention.

The service distinguishes between transactional notifications (auth codes, receipts, system alerts) and marketing notifications (campaigns, digests, product updates), applying different delivery policies, rate limits, and compliance rules to each category.

**Repository**: [github.com/hanzoai/notify](https://github.com/hanzoai/notify)
**Port**: 8061
**Docker**: `ghcr.io/hanzoai/notify:latest`
**Cluster**: `hanzo-k8s` (`24.199.76.156`)

## Motivation

### The Problem

Notifications are everywhere in the Hanzo platform. Consider what happens in a single day:

1. **IAM** sends password reset emails, MFA codes, and login alerts.
2. **Commerce** sends payment receipts, subscription renewals, and failed charge notices.
3. **Cloud** sends deployment success/failure alerts, usage threshold warnings, and billing summaries.
4. **LLM Gateway** sends rate limit warnings and API key expiration notices.
5. **Agent SDK** sends task completion reports, error summaries, and scheduled digest emails.

Without a centralized notification service, each of these teams integrates with email and SMS providers independently. This creates five problems:

**1. Provider sprawl and cost leakage.** Team A uses SendGrid, Team B uses AWS SES, Team C uses Mailgun. Each has its own API keys, billing accounts, and deliverability reputation. When SendGrid has an outage, only Team A knows. When the company wants to switch providers for cost reasons, every team must migrate independently.

**2. Inconsistent user experience.** Each team designs its own email templates, uses different "from" addresses, and follows different formatting conventions. The user receives emails that look like they come from five different companies. There is no unified unsubscribe mechanism.

**3. No fallback chains.** When a push notification fails (user disabled notifications), the message is lost. No team implements the logic to fall back to email, then to SMS. Building reliable multi-channel delivery is complex -- each team either does it poorly or does not do it at all.

**4. No preference management.** Users cannot control which channels they receive notifications on or which categories they want to silence. There is no central place to say "send me billing alerts by email but agent reports by push notification only."

**5. No delivery observability.** Did the email arrive? Was it opened? Did the SMS bounce? Did the webhook return a 200? Without centralized tracking, debugging "I never got the notification" requires spelunking through five different provider dashboards.

### Why Unified Notification Service

A single notification service eliminates all five problems. Services call one API: `POST /v1/notify`. The Notify service handles provider selection, channel routing, fallback logic, template rendering, rate limiting, bounce handling, preference checking, and delivery tracking. Services never touch a delivery provider directly.

This is the same architectural principle behind the LLM Gateway (HIP-0004): instead of every service integrating with OpenAI, Anthropic, and Together AI independently, they call the Gateway. Instead of every service integrating with SendGrid, Twilio, and FCM independently, they call Notify.

## Design Philosophy

### Why Not Just Use SendGrid / Twilio Directly

The instinctive answer to "we need to send emails" is to sign up for SendGrid and call their API. This works until it does not. Here is the full cost analysis:

**Direct cost at scale.** SendGrid charges $0.00065 per email on the Pro plan (100K emails/month = $65). At 1M emails/month, that is $650. At 10M, $6,500. Twilio SMS is $0.0079 per message in the US. Push notifications via FCM/APNs are free but require infrastructure to manage device tokens. A unified service lets us use the cheapest provider for each channel and switch providers without changing any calling code.

**Deliverability reputation management.** Email deliverability depends on sender reputation -- IP warmup, SPF/DKIM/DMARC configuration, bounce rate monitoring, complaint rate tracking, and list hygiene. When five teams send from five different configurations, one team's misconfiguration (e.g., not handling bounces) degrades everyone's deliverability. A single service maintains one sender reputation with proper hygiene.

**Data sovereignty.** SendGrid and Twilio store message content on their infrastructure. For enterprise customers with data residency requirements, this is problematic. Notify renders templates locally and sends only the final content to the delivery provider. Template data and user contact information stay on our infrastructure.

**AI personalization.** The most compelling reason for a self-hosted service: we can pass notification content through the LLM Gateway (HIP-0004) for AI-powered personalization before delivery. SendGrid's "dynamic templates" offer variable substitution. We offer full LLM rewriting -- adjusting tone, language, length, and content based on user profile and engagement history. This is impossible with a third-party service because it requires access to our user data and LLM infrastructure.

### Why Handlebars + LLM Fallback for Templates

Notification templates need two things: reliable variable substitution for transactional messages, and intelligent content generation for marketing messages.

**Handlebars** is a logic-less templating language. `{{user.name}}` renders the user's name. `{{#if user.isPro}}` conditionally includes content. It is deterministic -- the same input always produces the same output. This is essential for transactional messages where regulatory compliance requires exact, reproducible content. An auth code email must say exactly what it says, every time.

**LLM personalization** is the opposite: non-deterministic, creative, and context-aware. When sending a weekly usage digest, an LLM can summarize the user's activity in natural language, highlight anomalies, and suggest actions -- all personalized to the user's usage patterns. This is not possible with Handlebars alone.

The architecture is: Handlebars renders first (deterministic variable substitution), then an optional LLM pass personalizes the result (non-deterministic enhancement). Transactional templates skip the LLM pass. Marketing templates opt into it.

```
Template (Handlebars)  ──render──>  Base Content  ──LLM (optional)──>  Personalized Content
    {{user.name}}                   "Hi Zach"                          "Hi Zach, great week --
    {{usage.tokens}}                "You used 1.2M                      you used 1.2M tokens,
                                     tokens this week"                  up 40% from last week.
                                                                        Your agents completed
                                                                        47 tasks autonomously."
```

**Why not LLM-only?** Cost and latency. An LLM call costs ~$0.001-0.01 and takes 500ms-2s. For a password reset email sent 100K times/day, Handlebars renders in microseconds at zero marginal cost. LLM personalization is reserved for high-value, low-volume messages where the personalization justifies the cost.

### Why Multi-Channel Fallback Chains

Users interact with the Hanzo platform through different contexts at different times. During work hours, they are in the browser (in-app notifications reach them). On their phone, push notifications reach them. When they are offline, only email or SMS will work.

A fallback chain defines the sequence of channels to attempt for a notification:

```
push  ──fail──>  in-app  ──fail──>  email  ──fail──>  SMS
```

"Fail" means different things for different channels:
- **Push**: Device token invalid, or notification not acknowledged within 5 minutes.
- **In-app**: User not connected to WebSocket, or message not read within 15 minutes.
- **Email**: Hard bounce (address does not exist) or soft bounce after 3 retries.
- **SMS**: Carrier rejection or undeliverable status.
- **Webhook**: Non-2xx response after retry policy exhaustion.

The fallback chain is configurable per notification category and overridable per user via preferences. A user who says "email only, never SMS" gets email only, regardless of what the fallback chain says.

### Transactional vs. Marketing: Why the Distinction Matters

Transactional notifications are triggered by user actions (password reset, payment receipt, deployment alert). They are expected, time-sensitive, and legally permitted without explicit opt-in under CAN-SPAM, GDPR, and most privacy regulations.

Marketing notifications are initiated by the platform (feature announcements, usage digests, re-engagement campaigns). They require explicit opt-in, must include an unsubscribe mechanism, and are subject to stricter rate limits.

Notify enforces this distinction at the API level. Every notification has a `category` field that is either `transactional` or `marketing`. The system applies different policies:

| Policy | Transactional | Marketing |
|--------|---------------|-----------|
| Opt-in required | No | Yes |
| Unsubscribe link | Optional | Required |
| Rate limit | 100/user/hour | 5/user/day |
| Quiet hours | Ignored | Enforced (no delivery 22:00-08:00 local) |
| LLM personalization | Disabled by default | Enabled by default |
| Delivery priority | High (immediate) | Normal (batched) |
| Fallback chains | Full chain | Email only (no SMS for marketing) |

Misclassifying a marketing notification as transactional is a compliance violation. Notify validates the `category` field against the template's declared category and rejects mismatches.

## Specification

### Architecture

```
                        Internet
                           |
                 +---------+---------+
                 |      Traefik      |
                 | (TLS termination) |
                 +---------+---------+
                           |
                 +---------+---------+
                 |   Hanzo Notify    |
                 |   (Go service)    |
                 |     :8061         |
                 +---+-----+----+---+
                     |     |    |
          +----------+  +--+--+ +----------+
          |             |     |            |
    +-----+----+ +-----+---+ +----+-----+ +--------+
    | Provider  | | Template| | Preference| | Queue  |
    | Router    | | Engine  | | Store     | | (MQ)   |
    |           | | (HBS +  | | (IAM)    | | HIP-55 |
    | SendGrid  | |  LLM)   | |          | |        |
    | Twilio    | |         | |          | |        |
    | FCM/APNs  | |         | |          | |        |
    | WebSocket | |         | |          | |        |
    +-----------+ +---------+ +----------+ +--------+
                                               |
                                         +-----+-----+
                                         | Delivery   |
                                         | Workers    |
                                         | (per       |
                                         |  channel)  |
                                         +-----------+
```

### API Endpoints

#### Send Notification

```
POST /v1/notify
```

This is the primary endpoint. All services call this to send notifications.

```json
{
  "to": {
    "user_id": "hanzo/zach",
    "email": "z@hanzo.ai",
    "phone": "+14155551234",
    "device_tokens": ["fcm_abc123"]
  },
  "template": "deployment-success",
  "category": "transactional",
  "channels": ["push", "email"],
  "fallback": true,
  "priority": "high",
  "data": {
    "project_name": "my-api",
    "environment": "production",
    "deploy_url": "https://my-api.hanzo.app",
    "commit_sha": "a1b2c3d"
  },
  "options": {
    "llm_personalize": false,
    "deduplicate_key": "deploy-my-api-a1b2c3d",
    "deduplicate_window": "1h"
  }
}
```

Response:

```json
{
  "id": "ntf_01HQ3X7K8M2N4P5R6S7T8U9V0W",
  "status": "queued",
  "channels_attempted": ["push"],
  "created_at": "2026-02-23T10:30:00.000Z"
}
```

The `to` field accepts either a `user_id` (resolved via IAM to get contact info) or explicit contact fields. When `user_id` is provided, Notify fetches the user's email, phone, and device tokens from IAM and applies their channel preferences before delivery.

#### Send Batch

```
POST /v1/notify/batch
```

For sending the same notification to multiple recipients (e.g., all users in an organization):

```json
{
  "recipients": [
    { "user_id": "hanzo/zach", "data": { "usage_tokens": 1200000 } },
    { "user_id": "hanzo/alice", "data": { "usage_tokens": 850000 } }
  ],
  "template": "weekly-usage-digest",
  "category": "marketing",
  "channels": ["email"],
  "options": {
    "llm_personalize": true,
    "schedule_at": "2026-02-24T09:00:00Z"
  }
}
```

Maximum batch size: 1000 recipients per request. Larger sends must be paginated.

#### Agent Notification

```
POST /v1/notify/agent
```

AI agents (HIP-0025) send notifications on behalf of users. The `agent_id` is validated against IAM to ensure the agent has permission to notify the specified user.

```json
{
  "agent_id": "agent_research_bot",
  "on_behalf_of": "hanzo/zach",
  "template": "agent-task-complete",
  "category": "transactional",
  "channels": ["in-app", "push"],
  "data": {
    "task_name": "Market research: AI compute pricing",
    "summary": "Analyzed 47 sources. Key finding: GPU spot prices dropped 23% in Q1 2026.",
    "report_url": "https://cloud.hanzo.ai/reports/rpt_abc123"
  }
}
```

Agent notifications are subject to additional rate limits (10/user/hour) to prevent runaway agents from spamming users.

#### Webhook Registration

```
POST /v1/webhooks
```

Register a webhook endpoint to receive notifications programmatically:

```json
{
  "url": "https://api.example.com/webhooks/hanzo",
  "events": ["deployment.*", "billing.payment_failed"],
  "secret": "whsec_abc123def456",
  "org_id": "org_hanzo"
}
```

Webhooks are signed with HMAC-SHA256 using the shared secret. The signature is included in the `X-Hanzo-Signature-256` header. Receivers MUST validate the signature before processing.

#### Preference Management

```
GET  /v1/preferences/{user_id}
PUT  /v1/preferences/{user_id}
```

User notification preferences are stored as part of the IAM user profile (HIP-0026) and cached locally by Notify. The preference model:

```json
{
  "user_id": "hanzo/zach",
  "global": {
    "quiet_hours": { "start": "22:00", "end": "08:00", "timezone": "America/Los_Angeles" },
    "language": "en"
  },
  "channels": {
    "email": { "enabled": true },
    "sms": { "enabled": false },
    "push": { "enabled": true },
    "in_app": { "enabled": true },
    "webhook": { "enabled": true, "url": "https://my-server.com/hooks" }
  },
  "categories": {
    "billing": { "channels": ["email"], "enabled": true },
    "deployments": { "channels": ["push", "email"], "enabled": true },
    "marketing": { "enabled": false },
    "agent_reports": { "channels": ["in-app"], "enabled": true },
    "security": { "channels": ["email", "sms"], "enabled": true }
  }
}
```

When a notification arrives, Notify merges the service-requested channels with the user's preferences. The intersection determines the actual delivery channels. Security-critical notifications (auth codes, breach alerts) override user preferences -- they are always delivered.

#### Delivery Status

```
GET /v1/notifications/{id}
GET /v1/notifications?user_id={user_id}&since={timestamp}
```

Returns delivery status for a notification across all attempted channels:

```json
{
  "id": "ntf_01HQ3X7K8M2N4P5R6S7T8U9V0W",
  "template": "deployment-success",
  "category": "transactional",
  "created_at": "2026-02-23T10:30:00.000Z",
  "deliveries": [
    {
      "channel": "push",
      "status": "delivered",
      "provider": "fcm",
      "sent_at": "2026-02-23T10:30:00.150Z",
      "delivered_at": "2026-02-23T10:30:00.320Z"
    },
    {
      "channel": "email",
      "status": "skipped",
      "reason": "push_succeeded"
    }
  ]
}
```

### Template Engine

Templates are stored in the Notify database and versioned. Each template has a name, category, supported channels, and per-channel content.

#### Template Definition

```yaml
name: deployment-success
category: transactional
channels:
  email:
    subject: "Deployed: {{project_name}} to {{environment}}"
    body: |
      <h2>Deployment Successful</h2>
      <p>Hi {{user.displayName}},</p>
      <p>Your project <strong>{{project_name}}</strong> was deployed to
      <strong>{{environment}}</strong> at {{deployed_at}}.</p>
      {{#if deploy_url}}
      <p><a href="{{deploy_url}}">View deployment</a></p>
      {{/if}}
      <p>Commit: <code>{{commit_sha}}</code></p>
    from: "Hanzo Cloud <cloud@notify.hanzo.ai>"
  push:
    title: "Deployed: {{project_name}}"
    body: "{{project_name}} deployed to {{environment}} successfully."
    icon: "https://cdn.hanzo.ai/img/icons/deploy-success.png"
    action_url: "{{deploy_url}}"
  in_app:
    title: "Deployment Complete"
    body: "{{project_name}} is live on {{environment}}."
    type: "success"
    action_url: "{{deploy_url}}"
  sms:
    body: "Hanzo: {{project_name}} deployed to {{environment}}. {{deploy_url}}"
  webhook:
    payload: |
      {
        "event": "deployment.success",
        "project": "{{project_name}}",
        "environment": "{{environment}}",
        "url": "{{deploy_url}}",
        "commit": "{{commit_sha}}"
      }
```

#### LLM Personalization Pass

When `llm_personalize: true`, the rendered Handlebars output is sent to the LLM Gateway (HIP-0004) with a system prompt that instructs the model to personalize the content:

```
System: You are personalizing a notification for {{user.displayName}}.
Their role is {{user.role}}. They have been using the platform for {{user.tenure}}.
Their recent activity: {{user.recentActivity}}.

Rewrite the following notification to be more relevant and engaging.
Keep the core information intact. Match the user's communication style.
Do not change links, dates, or factual data. Keep it concise.

Content to personalize:
---
{{rendered_content}}
---
```

The LLM response replaces the body content. Subject lines and short-form fields (push title, SMS body) are not personalized -- they must remain predictable for user recognition.

**Cost guardrail**: LLM personalization uses the cheapest available model (Zen-8B or equivalent) and is capped at 200 tokens output. At ~$0.0001 per personalized message, a campaign of 10K users costs $1 in LLM inference.

### Delivery Channels

#### Email

**Provider**: SendGrid (primary), AWS SES (fallback).

```
Notify  ──SMTP/API──>  SendGrid  ──>  Recipient MTA  ──>  Inbox
                          |
                     Webhooks back to Notify:
                     - delivered, opened, clicked,
                       bounced, complained, dropped
```

**Deliverability configuration**:
- **SPF**: `v=spf1 include:sendgrid.net include:amazonses.com ~all`
- **DKIM**: 2048-bit RSA key per sending domain, rotated annually.
- **DMARC**: `v=DMARC1; p=quarantine; rua=mailto:dmarc@hanzo.ai; pct=100`
- **Dedicated IP**: Production uses a dedicated sending IP (not shared pool) to isolate reputation.
- **Warmup**: New IPs are warmed over 30 days, starting at 100 emails/day and doubling weekly.

**Bounce handling**:
- **Hard bounce** (address does not exist): Mark email invalid in IAM user profile. Do not attempt delivery to this address again. Notify IAM to prompt the user to update their email on next login.
- **Soft bounce** (mailbox full, temporary failure): Retry 3 times with exponential backoff (1h, 6h, 24h). If all retries fail, fall through to next channel in fallback chain.
- **Complaint** (user marked as spam): Immediately unsubscribe from all marketing emails. Log a compliance event in Insights (HIP-0017).

#### SMS

**Provider**: Twilio (primary), Vonage (fallback).

SMS is reserved for high-priority transactional messages: auth codes, security alerts, and critical billing notices. Marketing SMS requires explicit per-channel opt-in and is rate-limited to 2 messages per user per week.

**Message format**: Plain text, 160 characters max for single-segment delivery. Longer messages are split into multi-segment SMS (up to 320 characters). All SMS messages include a stop instruction: "Reply STOP to unsubscribe."

**Number management**: US traffic uses a toll-free number verified for A2P (application-to-person) messaging. International traffic uses Twilio's Messaging Service with intelligent number pool selection.

#### Push Notifications

**Providers**: Firebase Cloud Messaging (FCM) for Android and web, Apple Push Notification Service (APNs) for iOS.

Device tokens are registered via the client SDK and stored in the IAM user profile. Token lifecycle:

```
App install  ──register token──>  Notify  ──store──>  IAM user.deviceTokens[]
App update   ──new token──>       Notify  ──replace──> IAM
App uninstall ──token invalid──>  (detected on next send, token removed)
```

**Payload limits**: FCM allows 4KB, APNs allows 4KB. Notifications exceeding the limit are truncated with a "View more" deep link.

#### In-App Notifications

Delivered via WebSocket connection to the user's active browser sessions. The Notify service maintains a WebSocket server that clients connect to on authentication:

```
Browser  ──WSS──>  Notify :8061/ws  ──authenticate via IAM token──>  Connected
                        |
                   On notification:
                   Notify pushes JSON to all active sessions for user
```

In-app notifications are stored in a per-user inbox (PostgreSQL) and served via REST for session history:

```
GET /v1/inbox?user_id=hanzo/zach&unread=true
```

#### Webhooks

Outbound webhooks deliver structured JSON payloads to registered endpoints. Delivery follows an exponential backoff retry policy:

| Attempt | Delay | Total elapsed |
|---------|-------|---------------|
| 1 | Immediate | 0s |
| 2 | 30s | 30s |
| 3 | 5m | 5m 30s |
| 4 | 30m | 35m 30s |
| 5 | 2h | 2h 35m 30s |

After 5 failed attempts, the webhook is marked as failed and a dead letter is created. Three consecutive delivery failures to the same endpoint trigger a warning email to the webhook owner. Ten consecutive failures disable the webhook.

**Signature verification**:

```python
import hmac, hashlib

def verify_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

### Fallback Chain Execution

When a notification specifies `"fallback": true`, Notify executes channels in sequence until one succeeds:

```
1. Attempt primary channel (first in channels list)
2. Wait for delivery confirmation or timeout
3. If failed or timed out:
   a. Check user preferences for next allowed channel
   b. Attempt next channel
   c. Repeat until success or all channels exhausted
4. If all channels exhausted:
   a. Mark notification as "failed"
   b. Log failure event to Insights (HIP-0017)
   c. If critical (security category): alert ops via PagerDuty
```

Channel timeout values:

| Channel | Timeout before fallback |
|---------|------------------------|
| Push | 5 minutes |
| In-app | 15 minutes (WebSocket connected) or immediate (not connected) |
| Email | 24 hours (soft bounce retry window) |
| SMS | 5 minutes |
| Webhook | Per retry policy |

### Integration with IAM (HIP-0026)

Notify is a trusted service in the IAM ecosystem. It authenticates to IAM using a service account (`svc-notify`) with a machine-to-machine OAuth token.

**User resolution**: When `to.user_id` is provided, Notify calls IAM's internal API to resolve the user's contact information:

```
GET https://hanzo.id/api/get-user?id=hanzo/zach
Authorization: Bearer <service-token>

Response:
{
  "name": "zach",
  "email": "z@hanzo.ai",
  "phone": "+14155551234",
  "displayName": "Zach",
  "properties": {
    "deviceTokens": ["fcm_abc123", "apns_def456"],
    "notifyPreferences": { ... }
  }
}
```

**Preference sync**: User preferences are cached in Notify's Redis instance (TTL 5 minutes). When a user updates preferences via the IAM UI or Notify's preference API, the cache is invalidated immediately via a Kafka event on the `iam.user.updated` topic (HIP-0030).

### Integration with Analytics (HIP-0017)

Every notification lifecycle event is emitted as an analytics event to Hanzo Insights:

| Event | Properties |
|-------|------------|
| `notification.queued` | `notification_id`, `template`, `category`, `channels` |
| `notification.sent` | `notification_id`, `channel`, `provider`, `latency_ms` |
| `notification.delivered` | `notification_id`, `channel`, `provider` |
| `notification.opened` | `notification_id`, `channel` (email open tracking pixel) |
| `notification.clicked` | `notification_id`, `channel`, `link_url` |
| `notification.bounced` | `notification_id`, `channel`, `bounce_type`, `reason` |
| `notification.failed` | `notification_id`, `channel`, `error` |
| `notification.unsubscribed` | `user_id`, `category`, `channel` |

These events enable delivery dashboards in Insights: delivery rates by channel, bounce rates by domain, open rates by template, click-through rates by campaign. The analytics integration is fire-and-forget -- delivery pipeline latency is not affected by analytics ingestion.

### Rate Limiting

Rate limits protect both users (from notification fatigue) and providers (from API throttling).

| Scope | Transactional | Marketing | Agent |
|-------|---------------|-----------|-------|
| Per user per hour | 100 | 5 | 10 |
| Per user per day | 500 | 20 | 50 |
| Per org per hour | 10,000 | 1,000 | 500 |
| Global per second | 1,000 | 100 | 50 |

Rate limits are enforced via Redis sliding window counters. When a limit is exceeded, the API returns HTTP 429 with a `Retry-After` header.

Security-critical notifications (category `security`) bypass all rate limits. These include: MFA codes, password reset links, account breach alerts, and login from new device warnings.

## Implementation

### Production Deployment

Notify runs on `hanzo-k8s` as a Go service with dedicated delivery workers per channel.

| Component | Image | Replicas | CPU | Memory | Purpose |
|-----------|-------|----------|-----|--------|---------|
| `notify-api` | `ghcr.io/hanzoai/notify:latest` | 2 | 250m | 256Mi | REST API, WebSocket, preference management |
| `notify-email-worker` | `ghcr.io/hanzoai/notify:latest` | 2 | 250m | 128Mi | Email delivery via SendGrid/SES |
| `notify-sms-worker` | `ghcr.io/hanzoai/notify:latest` | 1 | 100m | 64Mi | SMS delivery via Twilio |
| `notify-push-worker` | `ghcr.io/hanzoai/notify:latest` | 1 | 100m | 64Mi | Push via FCM/APNs |
| `notify-webhook-worker` | `ghcr.io/hanzoai/notify:latest` | 1 | 100m | 64Mi | Outbound webhook delivery |

All workers consume from the Hanzo MQ (HIP-0055) NATS queue `mq.notify.>`, filtered by channel-specific subjects:

- `mq.notify.email` -- email worker
- `mq.notify.sms` -- SMS worker
- `mq.notify.push` -- push worker
- `mq.notify.webhook` -- webhook worker
- `mq.notify.in_app` -- handled by the API service via WebSocket

### Database Schema

Notify uses PostgreSQL (`hanzo_notify` on `postgres.hanzo.svc`) for templates, inbox, and webhook registrations. Delivery logs go to Insights (ClickHouse) via analytics events, not PostgreSQL.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `templates` | Notification templates | `name` (unique), `category` (transactional/marketing), `channels` (JSONB), `version`, `active` |
| `inbox` | Per-user in-app message store | `user_id`, `notification_id`, `title`, `body`, `read`, `action_url` |
| `webhooks` | Registered webhook endpoints | `org_id`, `url`, `events[]`, `secret` (HMAC key), `enabled`, `failures` |
| `suppression_list` | Hard bounces, complaints, unsubscribes | `email` or `phone` (unique partial indexes), `reason` |

The `inbox` table has a partial index on `(user_id, read) WHERE NOT read` for efficient unread queries. The `suppression_list` is checked before every delivery attempt to prevent sending to known-bad addresses.

### Configuration

All configuration uses `${VARIABLE}` placeholders resolved from KMS (HIP-0027) at startup. Key configuration groups:

| Group | Variables | Description |
|-------|-----------|-------------|
| IAM | `NOTIFY_IAM_CLIENT_ID`, `NOTIFY_IAM_CLIENT_SECRET` | Service account for user resolution |
| MQ | `NOTIFY_NATS_PASSWORD` | NATS credentials for delivery queues |
| Email | `SENDGRID_API_KEY`, `SES_ACCESS_KEY`, `SES_SECRET_KEY` | Email provider credentials |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | SMS provider credentials |
| Push | `FCM_CREDENTIALS_JSON`, `APNS_KEY_ID`, `APNS_TEAM_ID` | Push provider credentials |
| LLM | `llm_gateway_url=http://llm-gateway.hanzo.svc:4000`, `llm_model=zen-8b` | Personalization config |
| Storage | `NOTIFY_DATABASE_URL`, `redis://redis.hanzo.svc:6379/3` | PostgreSQL and Redis |

No credentials appear in config files or Docker images.

### Monitoring

Key Prometheus metrics exported on `:8061/metrics`:

| Metric | Labels | Description |
|--------|--------|-------------|
| `notify_sent_total` | channel, template, category | Total notifications sent |
| `notify_delivered_total` | channel, provider | Confirmed deliveries |
| `notify_bounced_total` | channel, bounce_type | Bounces (hard/soft) |
| `notify_failed_total` | channel, error_type | Delivery failures |
| `notify_delivery_duration_seconds` | channel | Delivery latency histogram |
| `notify_rate_limited_total` | scope, category | Rate limit rejections |
| `notify_webhook_consecutive_failures` | url | Webhook endpoint health |

Critical alerts: email bounce rate > 5% (deliverability risk), notification queue backlog > 5000 (worker scaling issue), p95 delivery latency > 30s, and webhook endpoints with 5+ consecutive failures.

## Security Considerations

### Authentication and Authorization

All Notify API calls require a valid IAM bearer token. Service-to-service calls use machine-to-machine OAuth tokens with scope `notify:send`. User-facing endpoints (preferences, inbox) validate the token's `sub` claim matches the requested `user_id`.

Agent notifications require the agent's service token to have scope `notify:agent` and the agent must be registered as an authorized sender for the target user in IAM.

### PII Protection

Notification content may contain PII (names, emails, account details). Notify enforces:

1. **No logging of rendered content**: Delivery logs record template name, channel, and status -- never the rendered message body.
2. **TLS everywhere**: All provider API calls use TLS 1.2+. WebSocket connections require WSS.
3. **Suppression list**: Hard-bounced emails and unsubscribed phone numbers are added to a suppression list. Notify checks this list before every delivery attempt, preventing messages to known-bad addresses.
4. **Template injection prevention**: Handlebars rendering escapes HTML by default. Raw HTML is only permitted in email templates via explicit `{{{triple_braces}}}` syntax, and template content is sanitized before storage.

### Webhook Security

Outbound webhooks carry potentially sensitive notification data. Security measures:

1. **HMAC-SHA256 signatures**: Every webhook payload is signed. Receivers MUST validate before processing.
2. **HTTPS only**: Webhook URLs must use HTTPS. HTTP endpoints are rejected at registration.
3. **IP allowlisting**: Enterprise customers can restrict webhook delivery to specific IP ranges.
4. **Payload redaction**: Webhook payloads for sensitive templates (auth codes, billing details) are redacted to include only event type and reference IDs, not full content.

### Compliance

- **CAN-SPAM**: Marketing emails include a physical address and one-click unsubscribe via `List-Unsubscribe` header.
- **GDPR**: User data is deletable via IAM's right-to-erasure flow. Deleting a user from IAM triggers deletion of their inbox, preferences, and suppression entries in Notify.
- **TCPA**: SMS marketing requires prior express written consent, tracked per-user in IAM. Notify verifies consent status before sending marketing SMS.

## References

1. [HIP-0004: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md) -- LLM personalization provider
2. [HIP-0017: Analytics Event Standard](./hip-0017-analytics-event-standard.md) -- Delivery tracking and engagement metrics
3. [HIP-0025: Bot Agent Wallet & RPC Billing Protocol](./hip-0025-bot-agent-wallet-rpc-billing-protocol.md) -- Agent identity and permissions
4. [HIP-0026: Identity & Access Management Standard](./hip-0026-identity-access-management-standard.md) -- User resolution, preferences, contact info
5. [HIP-0027: Secrets Management Standard](./hip-0027-secrets-management-standard.md) -- Provider credential storage
6. [HIP-0030: Event Streaming Standard](./hip-0030-event-streaming-standard.md) -- IAM user update events
7. [HIP-0055: Message Queue Standard](./hip-0055-message-queue-standard.md) -- Delivery task distribution
8. [SendGrid API Documentation](https://docs.sendgrid.com/api-reference)
9. [Twilio SMS API Documentation](https://www.twilio.com/docs/sms)
10. [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
11. [Apple Push Notification Service](https://developer.apple.com/documentation/usernotifications)
12. [RFC 8058: One-Click Unsubscribe](https://datatracker.ietf.org/doc/html/rfc8058)
13. [Hanzo Notify Repository](https://github.com/hanzoai/notify)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
