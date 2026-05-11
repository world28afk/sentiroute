import { describe, it, expect } from 'vitest';
import {
  translateOpenAIToAnthropicResponse,
  translateOpenAIToAnthropicStream,
} from '../response/openai-to-anthropic.js';
import type { OpenAIResponse } from '../types.js';

// Helper: create a text-only OpenAI response
function textResponse(): OpenAIResponse {
  return {
    id: 'chatcmpl_1',
    object: 'chat.completion',
    created: 1715000000,
    model: 'gpt-5',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'Hello world' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// Helper: create OpenAI response with tool calls
function toolCallResponse(): OpenAIResponse {
  return {
    id: 'chatcmpl_2',
    object: 'chat.completion',
    created: 1715000000,
    model: 'gpt-5',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: 'Let me check.',
        tool_calls: [{
          id: 'call_1',
          type: 'function' as const,
          function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
        }],
      },
      finish_reason: 'tool_calls',
    }],
    usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
  };
}

// Helper: create OpenAI SSE chunks as string
function openaiTextSSE(text: string): string {
  return [
    `data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1715000000,"model":"gpt-5","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
    '',
    `data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1715000000,"model":"gpt-5","choices":[{"index":0,"delta":{"content":"${text}"},"finish_reason":null}]}`,
    '',
    `data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1715000000,"model":"gpt-5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n');
}

// Helper: create OpenAI SSE with tool calls
function openaiToolSSE(): string {
  return [
    `data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":1715000000,"model":"gpt-5","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
    '',
    `data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":1715000000,"model":"gpt-5","choices":[{"index":0,"delta":{"content":"Let me check."},"finish_reason":null}]}`,
    '',
    `data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":1715000000,"model":"gpt-5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}`,
    '',
    `data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":1715000000,"model":"gpt-5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"location\\":\\"NYC\\"}"}}]},"finish_reason":null}]}`,
    '',
    `data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":1715000000,"model":"gpt-5","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n');
}

function sseStream(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

// ── Non-streaming tests ──

describe('translateOpenAIToAnthropicResponse', () => {
  it('converts simple text response', () => {
    const result = translateOpenAIToAnthropicResponse(textResponse(), 'claude-opus-4-7');
    expect(result.type).toBe('message');
    expect(result.role).toBe('assistant');
    expect(result.model).toBe('claude-opus-4-7');
    expect(result.content).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('maps stop → end_turn', () => {
    const result = translateOpenAIToAnthropicResponse(textResponse(), 'claude-opus-4-7');
    expect(result.stop_reason).toBe('end_turn');
  });

  it('maps length → max_tokens', () => {
    const res = { ...textResponse(), choices: [{ ...textResponse().choices[0], finish_reason: 'length' as const }] };
    const result = translateOpenAIToAnthropicResponse(res, 'claude-opus-4-7');
    expect(result.stop_reason).toBe('max_tokens');
  });

  it('maps tool_calls → tool_use', () => {
    const result = translateOpenAIToAnthropicResponse(toolCallResponse(), 'claude-opus-4-7');
    expect(result.stop_reason).toBe('tool_use');
  });

  it('converts tool_calls to tool_use blocks', () => {
    const result = translateOpenAIToAnthropicResponse(toolCallResponse(), 'claude-opus-4-7');
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Let me check.' });
    expect(result.content[1]).toMatchObject({
      type: 'tool_use',
      id: 'call_1',
      name: 'get_weather',
      input: { location: 'NYC' },
    });
  });

  it('handles unparseable tool_call arguments', () => {
    const res: OpenAIResponse = {
      ...textResponse(),
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: 'not-json' } }],
        },
        finish_reason: 'stop',
      }],
    };
    const result = translateOpenAIToAnthropicResponse(res, 'claude-opus-4-7');
    expect((result.content[0] as any).input).toEqual({ _raw: 'not-json' });
  });

  it('maps usage fields', () => {
    const result = translateOpenAIToAnthropicResponse(textResponse(), 'claude-opus-4-7');
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('handles null finish_reason', () => {
    const res = { ...textResponse(), choices: [{ ...textResponse().choices[0], finish_reason: null }] };
    const result = translateOpenAIToAnthropicResponse(res, 'claude-opus-4-7');
    expect(result.stop_reason).toBeNull();
  });
});

// ── Streaming tests ──

describe('translateOpenAIToAnthropicStream', () => {
  it('converts text content to content_block events', async () => {
    const input = sseStream(openaiTextSSE('Hello'));
    const output = translateOpenAIToAnthropicStream(input, 'claude-opus-4-7');
    const text = await collectStream(output);

    expect(text).toContain('event: message_start');
    expect(text).toContain('event: content_block_start');
    expect(text).toContain('event: content_block_delta');
    expect(text).toContain('"text_delta"');
    expect(text).toContain('"text":"Hello"');
    expect(text).toContain('event: message_stop');
  });

  it('emits message_start first with message metadata', async () => {
    const input = sseStream(openaiTextSSE('Test'));
    const output = translateOpenAIToAnthropicStream(input, 'claude-opus-4-7');
    const text = await collectStream(output);

    const firstEventEnd = text.indexOf('\n\n');
    const firstEvent = text.substring(0, firstEventEnd);
    expect(firstEvent).toContain('event: message_start');
    expect(firstEvent).toContain('"role":"assistant"');
  });

  it('converts tool_calls to tool_use content blocks', async () => {
    const input = sseStream(openaiToolSSE());
    const output = translateOpenAIToAnthropicStream(input, 'claude-opus-4-7');
    const text = await collectStream(output);

    expect(text).toContain('"type":"tool_use"');
    expect(text).toContain('"name":"get_weather"');
    expect(text).toContain('"input_json_delta"');
    expect(text).toContain('NYC');
  });

  it('closes content_blocks before message_stop', async () => {
    const input = sseStream(openaiTextSSE('Done'));
    const output = translateOpenAIToAnthropicStream(input, 'claude-opus-4-7');
    const text = await collectStream(output);

    expect(text).toContain('event: content_block_stop');
    expect(text).toContain('event: message_delta');
    expect(text).toContain('event: message_stop');
    // content_block_stop should come before message_delta
    const stopPos = text.indexOf('event: content_block_stop');
    const deltaPos = text.indexOf('event: message_delta');
    expect(stopPos).toBeLessThan(deltaPos);
  });

  it('includes stop_reason in message_delta', async () => {
    const input = sseStream(openaiTextSSE('End'));
    const output = translateOpenAIToAnthropicStream(input, 'claude-opus-4-7');
    const text = await collectStream(output);

    expect(text).toContain('"stop_reason":"end_turn"');
  });

  it('handles stream without [DONE] gracefully', async () => {
    // No [DONE] at the end
    const sse = [
      `data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"gpt-5","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
      '',
      `data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"gpt-5","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":"stop"}]}`,
      '',
    ].join('\n');

    const input = sseStream(sse);
    const output = translateOpenAIToAnthropicStream(input, 'claude-opus-4-7');
    const text = await collectStream(output);

    expect(text).toContain('event: message_stop');
  });

  it('handles empty stream', async () => {
    const input = sseStream('');
    const output = translateOpenAIToAnthropicStream(input, 'claude-opus-4-7');
    const text = await collectStream(output);
    expect(text).toBe('');
  });
});
