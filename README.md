# LobsterGate

**The safety proxy for OpenClaw. ToS compliance + security + cost control.**

> "TokPinch watches your wallet. LobsterGate watches everything."

## Why LobsterGate?

OpenClaw users face three critical risks:

1. **Account bans** — OAuth token misuse and ToS-violating request patterns lead to provider bans
2. **Security threats** — 12% of ClawHub skills contain malware (keyloggers, credential theft, data exfiltration)
3. **Cost explosions** — Runaway agents and loops can burn $800+/month before you notice

LobsterGate is a transparent proxy that sits between OpenClaw and your LLM providers, enforcing compliance, security, and cost controls on every request.

### LobsterGate vs TokPinch

| Feature | TokPinch | LobsterGate |
|---|:---:|:---:|
| Cost tracking | Yes | Yes |
| Budget enforcement | Yes | Yes |
| Loop detection | Yes | Yes (faster) |
| Smart routing | Basic | Advanced |
| **OAuth token blocking** | No | **Yes** |
| **ToS compliance monitoring** | No | **Yes** |
| **Malicious skill detection** | No | **Yes** |
| **Data exfiltration blocking** | No | **Yes** |
| **Outbound URL blocklist** | No | **Yes** |
| **Credential leak prevention** | No | **Yes** |
| **Multi-provider unified budget** | No | **Yes** |
| **SSE streaming passthrough** | No | **Yes** |
| **Self-healing agent responses** | No | **Yes** |
| **Response body scanning** | No | **Yes** |
| **Async non-blocking logging** | No | **Yes** |

## 30-Second Setup

### Docker (recommended)

```bash
docker run -p 4200:4200 \
  -v lobstergate-data:/app/data \
  -e DASHBOARD_PASSWORD=yourpassword \
  lobstergate/lobstergate
```

### npm

```bash
npx lobstergate@latest
```

### From source

```bash
git clone https://github.com/hatyibei/LobsterGate.git
cd LobsterGate
npm install
npm run build
npm start
```

### Configure OpenClaw

Change one line in your OpenClaw config:

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "http://localhost:4200/v1"
    }
  }
}
```

That's it. You're protected.

## Architecture: 3-Layer Defense

Every request passes through three protection layers before reaching your LLM provider:

```
Request → [Compliance] → [Security] → [Cost] → LLM Provider
              │               │           │
              ▼               ▼           ▼
          Block OAuth     Block C2     Budget cap
          Rate limit      Cred leak    Loop detect
          Dedup           Exfil det    Smart route
```

### Layer 1: Compliance Engine (ToS Protection)

- **OAuth Token Detection** — Blocks non-API-key authentication to prevent ToS violations
- **Request Deduplication** — Prevents identical request floods
- **Rate Limit Self-Regulation** — Stays within 80% of provider limits
- **Daily Request Cap** — Self-imposed ceiling for safety

### Layer 2: Security Engine (Threat Defense)

- **Outbound URL Blocklist** — Blocks requests containing known malicious domains (ngrok, pastebin, webhook.site, etc.)
- **Credential Leak Prevention** — Detects API keys, AWS keys, GitHub PATs, private keys in prompts
- **Data Exfiltration Detection** — Catches bulk PII extraction patterns
- **Community Blocklist** — Auto-updatable domain blocklist

### Layer 3: Cost Engine (Budget Control)

- **Daily/Monthly Budget Enforcement** — Hard caps on spending
- **Loop Detection** — Blocks repeated identical requests (content hash comparison)
- **Cost Spiral Detection** — Catches runaway spending within time windows
- **Smart Model Routing** — Auto-downgrades small tasks (e.g., Opus to Haiku, saving up to 95%)
- **Multi-Provider Unified Budget** — Track Anthropic + OpenAI + OpenRouter spend together

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

### Response Body Scanning

Security scanning covers both requests and responses (including streamed chunks), catching attacks where malicious skills trick the LLM into echoing secrets.

## Dashboard

LobsterGate includes a real-time web dashboard at `http://localhost:4200/dashboard`:

- Live event stream with filtering (All / Blocked / ToS / Security / Cost)
- Compliance pass rate gauge
- Threat counter with severity breakdown
- Cost tracking with budget progress bar
- Protection layer breakdown chart
- Active rules overview

## Configuration

### Environment Variables

```bash
# Required
LOBSTERGATE_PORT=4200           # Proxy port (default: 4200)
DASHBOARD_PASSWORD=secret     # Dashboard auth password

# Provider API Keys (optional — can also pass through from client)
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
OPENROUTER_API_KEY=sk-or-v1-...

# Alerts (optional)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
SLACK_WEBHOOK_URL=...
```

### Config File

Create `lobstergate.json` in your working directory:

```json
{
  "port": 4200,
  "data_dir": "./data",
  "dashboard_password": "yourpassword",
  "compliance": {
    "block_oauth_tokens": true,
    "rate_limit_safety_margin": 0.8,
    "dedup_window_seconds": 30,
    "dedup_max_repeats": 3,
    "daily_request_cap": 5000
  },
  "security": {
    "outbound_blocklist": {
      "auto_update": false
    },
    "exfiltration_detection": {
      "enabled": true,
      "action": "block"
    }
  },
  "cost": {
    "budget": {
      "daily_limit_usd": 15,
      "monthly_limit_usd": 300,
      "warning_threshold": 0.8
    },
    "loop_detection": {
      "hash_window_seconds": 300,
      "max_repeats": 5
    },
    "smart_routing": {
      "enabled": true,
      "downgrade_threshold_tokens": 200
    }
  }
}
```

## API Endpoints

### Proxy (OpenClaw-facing)

- `POST /v1/messages` — Anthropic API compatible
- `POST /v1/chat/completions` — OpenAI API compatible

### Dashboard API

- `GET /api/stats` — Daily statistics
- `GET /api/logs?limit=100&status=blocked_security` — Request logs
- `GET /api/config` — Current config (sanitized)
- `GET /api/health` — Health check

### WebSocket

- `ws://localhost:4200/ws` — Real-time event stream

## Migrating from TokPinch

LobsterGate is a drop-in replacement. Point your OpenClaw `baseUrl` at `http://localhost:4200/v1` and configure your budget settings in `lobstergate.json`. Your TokPinch budget/cost concepts map directly to LobsterGate's cost engine config.

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Build
npm run build

# Dashboard development
cd dashboard && npm install && npm run dev
```

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript (strict mode)
- **Framework:** Express.js
- **Database:** SQLite (better-sqlite3, WAL mode)
- **Dashboard:** React + Tailwind CSS
- **Realtime:** WebSocket
- **Container:** Docker (non-root, read-only FS)

## License

MIT
