import type { ProviderConfig } from "../../config/schema.js";

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  inputTokens: number;
  outputTokens: number;
}

export async function forwardToOpenRouter(
  config: ProviderConfig["openrouter"],
  path: string,
  method: string,
  headers: Record<string, string>,
  body: unknown
): Promise<ForwardResult> {
  const url = `${config.base_url}${path}`;

  const authHeader = config.api_key
    ? `Bearer ${config.api_key}`
    : headers["authorization"] || "";

  const forwardHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authHeader,
    "HTTP-Referer": headers["http-referer"] || "https://clawguard.dev",
    "X-Title": "ClawGuard Proxy",
  };

  const response = await fetch(url, {
    method,
    headers: forwardHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseBody = (await response.json()) as Record<string, unknown>;

  // OpenRouter uses OpenAI-compatible format
  const usage = responseBody.usage as
    | { prompt_tokens?: number; completion_tokens?: number }
    | undefined;

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: responseBody,
    inputTokens: usage?.prompt_tokens || 0,
    outputTokens: usage?.completion_tokens || 0,
  };
}
