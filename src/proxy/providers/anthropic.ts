import type { ProviderConfig } from "../../config/schema.js";

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  inputTokens: number;
  outputTokens: number;
}

export async function forwardToAnthropic(
  config: ProviderConfig["anthropic"],
  path: string,
  method: string,
  headers: Record<string, string>,
  body: unknown
): Promise<ForwardResult> {
  const url = `${config.base_url}${path}`;

  const forwardHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": config.api_key || headers["x-api-key"] || "",
    "anthropic-version": headers["anthropic-version"] || "2023-06-01",
  };

  const response = await fetch(url, {
    method,
    headers: forwardHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseBody = (await response.json()) as Record<string, unknown>;

  // Extract token usage from Anthropic response
  const usage = responseBody.usage as
    | { input_tokens?: number; output_tokens?: number }
    | undefined;

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: responseBody,
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
  };
}
