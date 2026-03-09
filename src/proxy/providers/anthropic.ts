import type { ProviderConfig } from "../../config/schema.js";
import type { ProviderResult } from "./types.js";

export async function forwardToAnthropic(
  config: ProviderConfig["anthropic"],
  path: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  isStream: boolean
): Promise<ProviderResult> {
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
    | { input_tokens?: number; output_tokens?: number }
    | undefined;

  return {
    status: response.status,
    headers: responseHeaders,
    body: responseBody,
    inputTokens: usage?.input_tokens || 0,
    outputTokens: usage?.output_tokens || 0,
    isStream: false,
  };
}
