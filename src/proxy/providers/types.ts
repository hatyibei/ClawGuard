export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  inputTokens: number;
  outputTokens: number;
  isStream: false;
}

export interface StreamForwardResult {
  status: number;
  headers: Record<string, string>;
  stream: ReadableStream<Uint8Array>;
  isStream: true;
}

export type ProviderResult = ForwardResult | StreamForwardResult;
