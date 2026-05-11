import { describe, it, expect } from 'vitest';
import {
  translateAnthropicToOpenAIResponse,
  translateAnthropicToOpenAIStream,
} from '../response/anthropic-to-openai.js';
import type { AnthropicResponse } from '../types.js';

// Helper: create a text-only Anthropic response
function textResponse(): AnthropicResponse {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello world' }],
    model: 'claude-opus-4-7',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

// Helper: create an Anthropic response with tool use
function toolUseResponse(): AnthropicResponse {
  return {
    id: 'msg_2',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me check the weather.' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { location: 'NYC' } },
    ],
    model: 'claude-opus-4-7',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 30 },
  };
}

// Helper: create Anthropic SSE text
function anthropicTextSSE(text: string): string {
  return [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-opus-4-7","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${text}"}}`,
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');
}

// Helper: create Anthropic SSE with tool use
function anthropicToolSSE(): string {
  return [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","content":[],"model":"claude-opus-4-7","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":20,"output_tokens":0}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me check."}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":0}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\":\\"NYC\\"}"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":1}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":30}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');
}

// SSE string → ReadableStream
function sseStream(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
}

// Collect all chunks from ReadableStream as strings
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

describe('translateAnthropicToOpenAIResponse', () => {
  it('converts simple text response', () => {
    const result = translateAnthropicToOpenAIResponse(textResponse(), 'gpt-5');
    expect(result.object).toBe('chat.completion');
    expect(result.model).toBe('gpt-5');
    expect(result.choices[0].message.content).toBe('Hello world');
    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].finish_reason).toBe('stop');
  });

  it('maps end_turn → stop', () => {
    const result = translateAnthropicToOpenAIResponse(textResponse(), 'gpt-5');
    expect(result.choices[0].finish_reason).toBe('stop');
  });

  it('maps max_tokens → length', () => {
    const res = { ...textResponse(), stop_reason: 'max_tokens' as const };
    const result = translateAnthropicToOpenAIResponse(res, 'gpt-5');
    expect(result.choices[0].finish_reason).toBe('length');
  });

  it('maps tool_use → tool_calls', () => {
    const result = translateAnthropicToOpenAIResponse(toolUseResponse(), 'gpt-5');
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });

  it('converts tool_use blocks to tool_calls', () => {
    const result = translateAnthropicToOpenAIResponse(toolUseResponse(), 'gpt-5');
    expect(result.choices[0].message.content).toBe('Let me check the weather.');
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls![0].function.name).toBe('get_weather');
    expect(result.choices[0].message.tool_calls![0].function.arguments).toBe('{"location":"NYC"}');
  });

  it('maps usage fields', () => {
    const result = translateAnthropicToOpenAIResponse(textResponse(), 'gpt-5');
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it('handles null stop_reason', () => {
    const res = { ...textResponse(), stop_reason: null };
    const result = translateAnthropicToOpenAIResponse(res, 'gpt-5');
    expect(result.choices[0].finish_reason).toBeNull();
  });
});

// ── Streaming tests ──

describe('translateAnthropicToOpenAIStream', () => {
  it('converts text delta to OpenAI content chunks', async () => {
    const input = sseStream(anthropicTextSSE('Hello'));
    const output = translateAnthropicToOpenAIStream(input, 'gpt-5');
    const text = await collectStream(output);

    // Should contain the text delta
    expect(text).toContain('"content":"Hello"');
    // Should contain role: assistant in first chunk
    expect(text).toContain('"role":"assistant"');
    // Should end with [DONE]
    expect(text).toContain('[DONE]');
  });

  it('emits initial chunk with role', async () => {
    const input = sseStream(anthropicTextSSE('Test'));
    const output = translateAnthropicToOpenAIStream(input, 'gpt-5');
    const text = await collectStream(output);

    const lines = text.split('\n\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]');
    const first = JSON.parse(lines[0].slice(6));
    expect(first.choices[0].delta.role).toBe('assistant');
  });

  it('converts tool_use blocks to tool_calls chunks', async () => {
    const input = sseStream(anthropicToolSSE());
    const output = translateAnthropicToOpenAIStream(input, 'gpt-5');
    const text = await collectStream(output);

    // Should contain tool_calls with function name
    expect(text).toContain('"name":"get_weather"');
    // Should contain function arguments (escaped in JSON string)
    expect(text).toContain('"arguments":');
    expect(text).toContain('NYC');
  });

  it('includes finish_reason in final chunk', async () => {
    const input = sseStream(anthropicTextSSE('Done'));
    const output = translateAnthropicToOpenAIStream(input, 'gpt-5');
    const text = await collectStream(output);

    // Find the chunk before [DONE] (second-to-last data line)
    const lines = text.split('\n\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]');
    const lastData = JSON.parse(lines[lines.length - 1].slice(6));
    expect(lastData.choices[0].finish_reason).toBe('stop');
  });

  it('strips ping events', async () => {
    const pingSSE = [
      'event: ping',
      'data: {}',
      '',
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"x","type":"message","role":"assistant","content":[],"model":"claude-opus-4-7","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const input = sseStream(pingSSE);
    const output = translateAnthropicToOpenAIStream(input, 'gpt-5');
    const text = await collectStream(output);

    expect(text).not.toContain('ping');
    expect(text).toContain('[DONE]');
  });

  it('handles empty stream gracefully', async () => {
    const input = sseStream('');
    const output = translateAnthropicToOpenAIStream(input, 'gpt-5');
    const text = await collectStream(output);
    // No content, but no crash
    expect(text).toBe('');
  });
});
