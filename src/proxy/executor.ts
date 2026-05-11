export type UpstreamResult =
  | { kind: 'error'; statusCode: number; body: string }
  | { kind: 'streaming'; stream: ReadableStream<Uint8Array> }
  | { kind: 'complete'; body: string };

export interface UpstreamOptions {
  url: string;
  body: string;
  apiKey: string;
  format: 'anthropic' | 'openai';
  timeoutMs: number;
  signal?: AbortSignal;
  /** Client headers to forward to upstream (overrides defaults). */
  headers?: Record<string, string>;
}

export async function executeUpstream(opts: UpstreamOptions): Promise<UpstreamResult> {
  // Start with all client headers forwarded as-is
  const headers: Record<string, string> = {};
  if (opts.headers) {
    Object.assign(headers, opts.headers);
  }

  // Override auth and content-type with our upstream credentials
  headers['content-type'] = 'application/json';
  if (opts.format === 'anthropic') {
    headers['x-api-key'] = opts.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${opts.apiKey}`;
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error('timeout')), opts.timeoutMs);

  try {
    const signal = opts.signal
      ? combineSignals(timeoutController.signal, opts.signal)
      : timeoutController.signal;

    const response = await fetch(opts.url, {
      method: 'POST',
      headers,
      body: opts.body,
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { kind: 'error', statusCode: response.status, body: errorBody };
    }

    const parsed = JSON.parse(opts.body);
    if (parsed.stream !== true) {
      const data = await response.text();
      return { kind: 'complete', body: data };
    }

    return { kind: 'streaming', stream: response.body! };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message === 'timeout' ? 504 : 502;
    return {
      kind: 'error',
      statusCode,
      body: JSON.stringify({
        error: {
          type: statusCode === 504 ? 'timeout_error' : 'upstream_error',
          message:
            statusCode === 504
              ? 'Upstream request timed out'
              : `Upstream error: ${message}`,
        },
      }),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
