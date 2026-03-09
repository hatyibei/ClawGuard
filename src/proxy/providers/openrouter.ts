import type { ProviderConfig } from "../../config/schema.js";
import type { ProviderResult } from "./types.js";

export async function forwardToOpenRouter(
  config: ProviderConfig["openrouter"],
  path: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  isStream: boolean
): Promise<ProviderResult> {
  const url = `${config.base_url}${path}`;

  const authHeader = config.api_key
    ? `Bearer ${config.api_key}`
    : headers["authorization"] || "";

  const forwardHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authHeader,
    "HTTP-Referer": headers["http-referer"] || "https://lobstergate.dev",
    "X-Title": "LobsterGate Proxy",
  };

  const response = await fetch(url, {
    method,
    headers: forwardHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseHeaders = Object.fromEntries(response.headers.entries());

  if (isStream && response.ok && response.body) {
    return {
      status: response.status,
      headers: responseHeaders,
      stream: response.body,
      isStream: true,
    };
  }

  const responseBody = (await response.json()) as Record<string, unknown>;
  const usage = responseBody.usage as
    | { prompt_tokens?: number; completion_tokens?: number }
    | undefined;

  return {
    status: response.status,
    headers: responseHeaders,
    body: responseBody,
    inputTokens: usage?.prompt_tokens || 0,
    outputTokens: usage?.completion_tokens || 0,
    isStream: false,
  };
}
