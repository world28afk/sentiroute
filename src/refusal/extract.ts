/**
 * Format-agnostic text and tool-use extraction for refusal detection.
 *
 * Supports Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses
 * shapes for both complete-body and SSE-stream cases.
 */

/** Extract the visible assistant text from a completed response body. */
export function extractResponseText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const obj = body as Record<string, unknown>;

  // Anthropic: { content: [{ type: 'text', text: '...' }, { type: 'tool_use', ... }] }
  if (Array.isArray(obj.content)) {
    return (obj.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('\n');
  }

  // OpenAI Chat Completions: { choices: [{ message: { content: '...' } }] }
  if (Array.isArray(obj.choices)) {
    const choices = obj.choices as Array<{ message?: { content?: unknown } }>;
    const parts: string[] = [];
    for (const c of choices) {
      const content = c?.message?.content;
      if (typeof content === 'string') parts.push(content);
      else if (Array.isArray(content)) {
        for (const item of content as Array<{ type?: string; text?: string }>) {
          if (item?.type === 'text' && typeof item.text === 'string') parts.push(item.text);
        }
      }
    }
    return parts.join('\n');
  }

  // OpenAI Responses: { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
  if (Array.isArray(obj.output)) {
    const parts: string[] = [];
    for (const item of obj.output as Array<{ type?: string; content?: unknown }>) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content as Array<{ type?: string; text?: string }>) {
          if ((c?.type === 'output_text' || c?.type === 'text') && typeof c.text === 'string') {
            parts.push(c.text);
          }
        }
      }
    }
    return parts.join('\n');
  }

  return '';
}

/** True if the response contains a tool/function call — refusal-detection should skip. */
export function hasToolUse(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const obj = body as Record<string, unknown>;

  // Anthropic content blocks
  if (Array.isArray(obj.content)) {
    return (obj.content as Array<{ type?: string }>).some(
      (b) => b?.type === 'tool_use' || b?.type === 'server_tool_use',
    );
  }

  // OpenAI Chat: choice.message.tool_calls (also legacy function_call)
  if (Array.isArray(obj.choices)) {
    const choices = obj.choices as Array<{
      message?: { tool_calls?: unknown[]; function_call?: unknown };
      finish_reason?: string;
    }>;
    for (const c of choices) {
      if (Array.isArray(c?.message?.tool_calls) && c.message!.tool_calls!.length > 0) return true;
      if (c?.message?.function_call) return true;
      if (c?.finish_reason === 'tool_calls') return true;
    }
  }

  // OpenAI Responses: output items of type tool_call / function_call
  if (Array.isArray(obj.output)) {
    return (obj.output as Array<{ type?: string }>).some(
      (i) => i?.type === 'tool_call' || i?.type === 'function_call' || i?.type === 'web_search_call',
    );
  }

  return false;
}

/**
 * Parse a buffered SSE payload into discrete event objects.
 * Tolerates partial chunks and non-JSON heartbeats.
 */
export interface ParsedSseEvent {
  data: unknown;
  done: boolean;
}

export function parseSseBuffer(buffer: string): ParsedSseEvent[] {
  const events: ParsedSseEvent[] = [];
  const lines = buffer.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload) continue;
    if (payload === '[DONE]') {
      events.push({ data: null, done: true });
      continue;
    }
    try {
      events.push({ data: JSON.parse(payload), done: false });
    } catch {
      // ignore malformed event
    }
  }
  return events;
}

/** Extract the accumulated assistant text from a buffered SSE response. */
export function extractStreamingText(sseBuffer: string): string {
  const events = parseSseBuffer(sseBuffer);
  const parts: string[] = [];
  for (const ev of events) {
    if (ev.done || !ev.data) continue;
    const data = ev.data as Record<string, unknown>;

    // Anthropic Messages SSE
    const eventType = (data.type as string | undefined) ?? '';
    if (eventType === 'content_block_delta') {
      const delta = data.delta as Record<string, unknown> | undefined;
      const t = delta?.type as string | undefined;
      if (t === 'text_delta' && typeof delta?.text === 'string') {
        parts.push(delta.text as string);
      }
    } else if (eventType === 'content_block_start') {
      const block = data.content_block as Record<string, unknown> | undefined;
      if (block?.type === 'text' && typeof block?.text === 'string') {
        parts.push(block.text as string);
      }
    }

    // OpenAI Chat SSE
    if (Array.isArray(data.choices)) {
      for (const c of data.choices as Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>) {
        const dc = c?.delta?.content ?? c?.message?.content;
        if (typeof dc === 'string') parts.push(dc);
        else if (Array.isArray(dc)) {
          for (const item of dc as Array<{ type?: string; text?: string }>) {
            if ((item?.type === 'text' || item?.type === 'output_text') && typeof item.text === 'string') {
              parts.push(item.text);
            }
          }
        }
      }
    }

    // OpenAI Responses SSE
    if (eventType === 'response.output_text.delta' && typeof data.delta === 'string') {
      parts.push(data.delta as string);
    }
    if (eventType === 'response.output_text.done' && typeof data.text === 'string') {
      parts.push(data.text as string);
    }
  }
  return parts.join('');
}

/** True if any SSE event carries a tool/function call — refusal-detection should skip. */
export function streamHasToolUse(sseBuffer: string): boolean {
  const events = parseSseBuffer(sseBuffer);
  for (const ev of events) {
    if (ev.done || !ev.data) continue;
    const data = ev.data as Record<string, unknown>;

    const eventType = (data.type as string | undefined) ?? '';
    if (eventType === 'content_block_start') {
      const block = data.content_block as { type?: string } | undefined;
      if (block?.type === 'tool_use') return true;
    }
    if (eventType === 'response.output_item.added') {
      const item = data.item as { type?: string } | undefined;
      if (item?.type === 'tool_call' || item?.type === 'function_call') return true;
    }
    if (Array.isArray(data.choices)) {
      for (const c of data.choices as Array<{
        delta?: { tool_calls?: unknown[]; function_call?: unknown };
        finish_reason?: string;
      }>) {
        if (Array.isArray(c?.delta?.tool_calls) && c.delta!.tool_calls!.length > 0) return true;
        if (c?.delta?.function_call) return true;
        if (c?.finish_reason === 'tool_calls') return true;
      }
    }
  }
  return false;
}
