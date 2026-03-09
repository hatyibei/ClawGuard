# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in ClawGuard, please report it responsibly:

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email security concerns to the maintainers
3. Include a detailed description and steps to reproduce

## API Key Handling

ClawGuard handles sensitive API keys with the following policies:

- API keys are **never** logged to disk or console output
- API keys are stored only in environment variables or the config file
- The dashboard API **never** exposes API keys — the `/api/config` endpoint returns sanitized configuration
- SQLite database stores only request metadata, never raw API keys or full request/response bodies

## Data Storage

- All data is stored locally in SQLite (WAL mode)
- No telemetry or external data collection
- The blocklist updater only downloads from configured sources

## Docker Security

The official Docker image runs with:
- Non-root user (`clawguard`)
- Read-only filesystem
- No new privileges (`no-new-privileges`)
- Minimal base image (`node:20-slim`)

## Threat Model

ClawGuard protects against:
- OAuth token misuse (ToS compliance)
- Malicious outbound connections from LLM skills
- Credential leakage in prompts/responses
- Cost overruns from runaway agents
- Request deduplication attacks

ClawGuard does **not** protect against:
- Compromise of the host machine
- Man-in-the-middle attacks on the proxy itself (use TLS in production)
- Attacks targeting the LLM provider directly
