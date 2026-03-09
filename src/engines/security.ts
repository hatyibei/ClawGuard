import type { SecurityConfig } from "../config/schema.js";

export interface SecurityFinding {
  type: "BLOCKED_DESTINATION" | "CREDENTIAL_EXPOSURE" | "DATA_EXFILTRATION" | "PROMPT_INJECTION";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  detail: string;
}

export interface SecurityVerdict {
  decision: "ALLOW" | "BLOCK";
  findings: SecurityFinding[];
}

interface MessageContent {
  type: string;
  text?: string;
  content?: string;
}

interface Message {
  role: string;
  content: string | MessageContent[];
}

const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /sk-ant-api[a-zA-Z0-9_-]{20,}/, name: "Anthropic API Key" },
  { pattern: /sk-proj-[a-zA-Z0-9_-]{20,}/, name: "OpenAI API Key" },
  { pattern: /sk-[a-zA-Z0-9]{40,}/, name: "OpenAI Legacy Key" },
  { pattern: /AKIA[A-Z0-9]{16}/, name: "AWS Access Key" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub PAT" },
  { pattern: /gho_[a-zA-Z0-9]{36}/, name: "GitHub OAuth Token" },
  { pattern: /glpat-[a-zA-Z0-9_-]{20,}/, name: "GitLab PAT" },
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/, name: "Private Key" },
  { pattern: /xox[bpsa]-[a-zA-Z0-9-]{10,}/, name: "Slack Token" },
];

const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;
const IP_REGEX = /(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)/g;

export class SecurityEngine {
  private config: SecurityConfig;
  private blockedDomains: string[];

  constructor(config: SecurityConfig) {
    this.config = config;
    this.blockedDomains = config.outbound_blocklist.domains;
  }

  inspect(messages: unknown[]): SecurityVerdict {
    const findings: SecurityFinding[] = [];
    const typedMessages = messages as Message[];

    for (const msg of typedMessages) {
      const content = this.extractText(msg);

      // 1. URL/IP extraction and blocklist check
      const urls = content.match(URL_REGEX) || [];
      for (const url of urls) {
        try {
          const hostname = new URL(url).hostname;
          if (this.isBlocklisted(hostname)) {
            findings.push({
              type: "BLOCKED_DESTINATION",
              severity: "HIGH",
              detail: `Outbound to blocklisted domain: ${hostname}`,
            });
          }
        } catch {
          // Invalid URL, skip
        }
      }

      // Check raw IPs
      const ips = content.match(IP_REGEX) || [];
      for (const ip of ips) {
        if (this.isBlocklistedIP(ip)) {
          findings.push({
            type: "BLOCKED_DESTINATION",
            severity: "HIGH",
            detail: `Outbound to blocklisted IP: ${ip}`,
          });
        }
      }

      // 2. Credential exposure detection
      if (this.config.exfiltration_detection.enabled) {
        for (const { pattern, name } of CREDENTIAL_PATTERNS) {
          if (pattern.test(content)) {
            findings.push({
              type: "CREDENTIAL_EXPOSURE",
              severity: "CRITICAL",
              detail: `Potential ${name} detected in message content`,
            });
          }
        }
      }

      // 3. Data exfiltration patterns
      if (this.config.exfiltration_detection.enabled) {
        const exfilPatterns = this.detectExfiltrationPatterns(content);
        findings.push(...exfilPatterns);
      }
    }

    const hasCritical = findings.some((f) => f.severity === "CRITICAL");
    const hasHigh = findings.some((f) => f.severity === "HIGH");

    let decision: "ALLOW" | "BLOCK" = "ALLOW";
    if (hasCritical && this.config.exfiltration_detection.action === "block") {
      decision = "BLOCK";
    } else if (hasHigh) {
      decision = "BLOCK";
    }

    return { decision, findings };
  }

  private extractText(msg: Message): string {
    if (typeof msg.content === "string") {
      return msg.content;
    }
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((b) => {
          if (b.type === "text" && b.text) return b.text;
          if (b.content) return b.content;
          return "";
        })
        .join(" ");
    }
    return "";
  }

  private isBlocklisted(hostname: string): boolean {
    for (const pattern of this.blockedDomains) {
      if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(2);
        if (hostname === suffix || hostname.endsWith("." + suffix)) {
          return true;
        }
      } else if (hostname === pattern) {
        return true;
      }
    }
    return false;
  }

  private isBlocklistedIP(ip: string): boolean {
    for (const range of this.config.outbound_blocklist.ip_ranges) {
      if (ip === range || this.ipInCIDR(ip, range)) {
        return true;
      }
    }
    return false;
  }

  private ipInCIDR(ip: string, cidr: string): boolean {
    if (!cidr.includes("/")) return ip === cidr;
    const [rangeIp, bits] = cidr.split("/");
    const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
    const ipNum = this.ipToNum(ip);
    const rangeNum = this.ipToNum(rangeIp);
    return (ipNum & mask) === (rangeNum & mask);
  }

  private ipToNum(ip: string): number {
    return ip
      .split(".")
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
  }

  private detectExfiltrationPatterns(content: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    // Bulk email pattern
    const emailCount = (content.match(/[\w.-]+@[\w.-]+\.\w+/g) || []).length;
    if (emailCount > 5) {
      findings.push({
        type: "DATA_EXFILTRATION",
        severity: "HIGH",
        detail: `Bulk PII detected: ${emailCount} email addresses in content`,
      });
    }

    // Base64 encoded large blobs (potential data exfil)
    const base64Chunks = content.match(/[A-Za-z0-9+/]{100,}={0,2}/g) || [];
    for (const chunk of base64Chunks) {
      if (chunk.length > 500) {
        findings.push({
          type: "DATA_EXFILTRATION",
          severity: "MEDIUM",
          detail: `Large base64 blob detected (${chunk.length} chars) — potential data exfiltration`,
        });
      }
    }

    return findings;
  }

  /**
   * Scan arbitrary text (e.g. response body or accumulated SSE chunks)
   * for credential patterns. Used for post-response scanning.
   */
  scanText(text: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    if (!this.config.exfiltration_detection.enabled) return findings;

    for (const { pattern, name } of CREDENTIAL_PATTERNS) {
      if (pattern.test(text)) {
        findings.push({
          type: "CREDENTIAL_EXPOSURE",
          severity: "CRITICAL",
          detail: `Potential ${name} detected in response content`,
        });
      }
    }

    // Also check for bulk PII in responses
    const exfilFindings = this.detectExfiltrationPatterns(text);
    findings.push(...exfilFindings);

    return findings;
  }

  addBlocklistEntry(type: "domain" | "ip", value: string): void {
    if (type === "domain") {
      this.blockedDomains.push(value);
    } else {
      this.config.outbound_blocklist.ip_ranges.push(value);
    }
  }
}
