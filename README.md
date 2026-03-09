<p align="center">
  <img src="https://em-content.zobj.net/source/apple/391/lobster_1f99e.png" width="80" />
</p>
<h1 align="center">LobsterGate</h1>
<p align="center">
  <strong>The safety proxy for OpenClaw.</strong><br/>
  ToS compliance · Security · Cost control — in one line of config.
</p>
<p align="center">
  <a href="#30-second-setup">Setup</a> ·
  <a href="#why-lobstergate">Why</a> ·
  <a href="#3-layer-defense">How it works</a> ·
  <a href="#dashboard">Dashboard</a> ·
  <a href="#configuration">Config</a>
</p>

---

> **January 2026.** Anthropic silently deployed server-side blocks. Thousands of OpenClaw users woke up to banned accounts. Google followed two days later.
>
> If you're still running OpenClaw on API keys without a proxy — you're next.

---

## Why LobsterGate?

OpenClaw users face **three risks that no single tool solves today**:

| Risk | What happens | Who solves it? |
|------|-------------|---------------|
| **Account ban** | OAuth token misuse, bot-like request patterns → provider bans your account | TokPinch doesn't touch this |
| **Security breach** | 12% of ClawHub skills are malware. 42K+ instances exposed. 8 CVEs in 8 weeks | TokPinch doesn't touch this |
| **Cost explosion** | Runaway loops burn $800+/month before you notice | TokPinch handles this |

**LobsterGate handles all three.** One proxy. One line of config.

### vs TokPinch

| | TokPinch | LobsterGate |
|---|:---:|:---:|
| Cost tracking | Yes | Yes |
| Budget enforcement | Yes | Yes |
| Loop detection | Yes | Yes |
| Smart model routing | Basic | Advanced |
| **OAuth token blocking** | No | **Yes** |
| **ToS compliance engine** | No | **Yes** |
| **Credential leak prevention** | No | **Yes** |
| **Outbound URL blocklist** | No | **Yes** |
| **Data exfiltration detection** | No | **Yes** |
| **Multi-provider unified budget** | No | **Yes** |
| **SSE streaming passthrough** | No | **Yes** |
| **Self-healing agent responses** | No | **Yes** |
| **Response body scanning** | No | **Yes** |

---

## 30-Second Setup

**1. Run LobsterGate:**

```bash
# Docker
docker run -p 4200:4200 -v lobstergate-data:/app/data lobstergate/lobstergate

# — or — npm
npx lobstergate@latest

# — or — from source
git clone https://github.com/hatyibei/LobsterGate.git
cd LobsterGate && npm install && npm run build && npm start
```

**2. Point OpenClaw at it** (one line in `~/.openclaw/openclaw.json`):

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "http://localhost:4200/v1"
    }
  }
}
```

Done. Every request now passes through 3 layers of protection.

---

## 3-Layer Defense

```
OpenClaw                                              LLM Provider
  │                                                        ▲
  ▼                                                        │
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  │
  │  Compliance   │──▶│   Security   │──▶│     Cost     │──┘
  │              │   │              │   │              │
  │ OAuth block  │   │ URL blocklist│   │ Budget cap   │
  │ Rate limit   │   │ Cred scanner │   │ Loop detect  │
  │ Dedup        │   │ Exfil detect │   │ Smart route  │
  └──────────────┘   └──────────────┘   └──────────────┘
        🔴                 🟠                 🟢
   "Am I allowed?"    "Is it safe?"     "Can I afford it?"
```

### Layer 1 — Compliance (BAN prevention)

Keeps you on the right side of every provider's ToS.

- **OAuth token detection** — Catches non-API-key auth and blocks it before it reaches the provider. You get a clear error telling you to switch to an API key.
- **Request deduplication** — Blocks identical requests repeating within a time window. Stops loops from looking like bot traffic.
- **Rate limit self-cap** — Stays at 80% of the provider's published limit by default. Avoids the "unusual traffic patterns" that trigger reviews.
- **Daily request ceiling** — Self-imposed safety net. Configurable.

### Layer 2 — Security (threat defense)

Catches what OpenClaw's own security doesn't.

- **Outbound URL blocklist** — Ships with 40+ known-bad domains (ngrok, pastebin, webhook.site, C2 infrastructure). Community-updatable.
- **Credential leak scanner** — Detects Anthropic keys, OpenAI keys, AWS keys, GitHub PATs, Slack tokens, private keys in your prompts **and responses**. Blocks before they leave your machine.
- **Data exfiltration detection** — Catches bulk PII (email harvesting) and suspicious base64 blobs.
- **CIDR-aware IP blocking** — Block entire IP ranges associated with known threats.
- **Response body scanning** — Streamed and non-streamed responses are scanned for credential leaks in real time.

### Layer 3 — Cost (budget control)

Everything TokPinch does, plus more.

- **Daily + monthly budget caps** — Hard limits that actually block requests. Warning at 80%.
- **Loop detection** — Content-hash comparison catches repeated messages. Cost-spiral detection catches runaway spending within time windows.
- **Smart model routing** — Automatically downgrades trivial tasks (heartbeats, short messages) from Opus → Haiku. Saves up to 95% per request without quality loss.
- **Multi-provider unified tracking** — Single budget across Anthropic + OpenAI + OpenRouter.

### Self-Healing Agent Responses

When LobsterGate blocks a request, it doesn't return a raw HTTP 403/429 that crashes agentic loops. Instead, it returns **HTTP 200** with an LLM-formatted response that guides the agent to self-correct:

```json
{
  "role": "assistant",
  "content": "[LobsterGate System Override] Your request was intercepted. Reason: Outbound to blocklisted domain: ngrok.io. Please adjust your approach using an alternative method."
}
```

The agent sees this as a normal assistant message and autonomously pivots — no crashes, no retries, no human intervention.

### SSE Streaming Passthrough

Full `stream: true` (Server-Sent Events) support. Streaming chunks are piped to the client with zero buffering, while a background tap extracts token usage and scans response content for credential leaks.

---

## Dashboard

LobsterGate ships with a real-time web dashboard at `http://localhost:4200/dashboard`.

- Live event stream with tab filtering (All / Blocked / ToS / Security / Cost)
- Compliance pass rate gauge
- Threat counter with severity breakdown
- Budget progress bar with daily/monthly tracking
- Per-layer block breakdown chart
- Active rules overview

---

## Configuration

### Environment Variables

```bash
LOBSTERGATE_PORT=4200           # Default: 4200
DASHBOARD_PASSWORD=secret       # Dashboard auth

# Provider keys (optional — passes through from client if not set)
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
OPENROUTER_API_KEY=sk-or-v1-...

# Alerts (optional)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
SLACK_WEBHOOK_URL=...
```

### Config File (`lobstergate.json`)

```json
{
  "compliance": {
    "block_oauth_tokens": true,
    "rate_limit_safety_margin": 0.8,
    "dedup_window_seconds": 30,
    "dedup_max_repeats": 3,
    "daily_request_cap": 5000
  },
  "security": {
    "outbound_blocklist": { "auto_update": false },
    "exfiltration_detection": { "enabled": true, "action": "block" }
  },
  "cost": {
    "budget": { "daily_limit_usd": 15, "monthly_limit_usd": 300, "warning_threshold": 0.8 },
    "loop_detection": { "hash_window_seconds": 300, "max_repeats": 5 },
    "smart_routing": { "enabled": true, "downgrade_threshold_tokens": 200 }
  }
}
```

Full schema reference: [src/config/schema.ts](./src/config/schema.ts)

---

## API

### Proxy endpoints (OpenClaw-facing)

| Method | Path | Compatible with |
|--------|------|----------------|
| `POST` | `/v1/messages` | Anthropic API |
| `POST` | `/v1/chat/completions` | OpenAI / OpenRouter API |

### Dashboard & monitoring

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stats` | Daily statistics |
| `GET` | `/api/logs?limit=100&status=blocked_security` | Filtered request logs |
| `GET` | `/api/config` | Current config (sanitized) |
| `GET` | `/health` | Health check |
| `WS` | `/ws` | Real-time event stream |

---

## Development

```bash
npm install        # Install deps
npm run dev        # Dev mode with hot reload
npm test           # Run tests (32 tests across 3 suites)
npm run build      # Production build
```

---

## Tech Stack

TypeScript · Express · SQLite (WAL mode) · React + Tailwind (dashboard) · WebSocket · Docker · Zod · Vitest

---

## Roadmap

- [x] 3-layer proxy engine (Compliance + Security + Cost)
- [x] Real-time WebSocket dashboard
- [x] Smart model routing (Opus → Haiku)
- [x] Community-updatable domain blocklist
- [x] Docker image with non-root user
- [x] SSE streaming passthrough
- [x] Response body security scanning
- [x] Self-healing agent responses (HTTP 200 + LLM-formatted feedback)
- [x] Async non-blocking log queue
- [ ] `lobstergate migrate --from-tokpinch` CLI
- [ ] npm package publish + Docker Hub
- [ ] Predictive cost anomaly detection
- [ ] LobsterGate Cloud (managed proxy SaaS)

---

## License

MIT

---

<p align="center">
  <sub>Built because OpenClaw deserves a seatbelt. 🦞</sub>
</p>
