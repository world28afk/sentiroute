import { describe, it, expect } from 'vitest';
import {
  extractResponseText,
  hasToolUse,
  extractStreamingText,
  streamHasToolUse,
  parseSseBuffer,
} from '../extract.js';

describe('extractResponseText', () => {
  it('extracts from Anthropic content blocks', () => {
    const body = {
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world.' },
      ],
    };
    expect(extractResponseText(body)).toBe('Hello \nworld.');
  });

  it('ignores tool_use blocks in Anthropic content', () => {
    const body = {
      content: [
        { type: 'text', text: 'Plain text.' },
        { type: 'tool_use', id: 't1', name: 'foo', input: {} },
      ],
    };
    expect(extractResponseText(body)).toBe('Plain text.');
  });

  it('extracts from OpenAI Chat Completions', () => {
    const body = {
      choices: [{ message: { role: 'assistant', content: 'Hello world' } }],
    };
    expect(extractResponseText(body)).toBe('Hello world');
  });

  it('extracts from OpenAI Chat content blocks', () => {
    const body = {
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'Part one. ' },
              { type: 'text', text: 'Part two.' },
            ],
          },
        },
      ],
    };
    expect(extractResponseText(body)).toBe('Part one. \nPart two.');
  });

  it('extracts from OpenAI Responses API', () => {
    const body = {
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello world' }],
        },
      ],
    };
    expect(extractResponseText(body)).toBe('Hello world');
  });

  it('returns empty string for unknown body shape', () => {
    expect(extractResponseText({ random: 'thing' })).toBe('');
    expect(extractResponseText(null)).toBe('');
    expect(extractResponseText('string body')).toBe('');
  });
});

describe('hasToolUse', () => {
  it('detects tool_use in Anthropic content', () => {
    const body = { content: [{ type: 'tool_use', id: 't1' }] };
    expect(hasToolUse(body)).toBe(true);
  });

  it('returns false for plain Anthropic text', () => {
    const body = { content: [{ type: 'text', text: 'hi' }] };
    expect(hasToolUse(body)).toBe(false);
  });

  it('detects tool_calls in OpenAI', () => {
    const body = {
      choices: [
        { message: { tool_calls: [{ id: 't1', function: { name: 'foo' } }] } },
      ],
    };
    expect(hasToolUse(body)).toBe(true);
  });

  it('detects finish_reason=tool_calls', () => {
    const body = { choices: [{ message: { content: '' }, finish_reason: 'tool_calls' }] };
    expect(hasToolUse(body)).toBe(true);
  });

  it('detects function_call (legacy OpenAI)', () => {
    const body = { choices: [{ message: { function_call: { name: 'foo' } } }] };
    expect(hasToolUse(body)).toBe(true);
  });

  it('returns false for empty/plain bodies', () => {
    expect(hasToolUse({ choices: [{ message: { content: 'hi' } }] })).toBe(false);
    expect(hasToolUse(null)).toBe(false);
  });
});

describe('parseSseBuffer', () => {
  it('parses well-formed SSE', () => {
    const buf =
      'data: {"type":"hello"}\n\ndata: {"type":"world"}\n\ndata: [DONE]\n\n';
    const events = parseSseBuffer(buf);
    expect(events).toHaveLength(3);
    expect(events[0].done).toBe(false);
    expect(events[2].done).toBe(true);
  });

  it('skips malformed JSON', () => {
    const buf = 'data: not json\n\ndata: {"ok":true}\n\n';
    const events = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
  });

  it('tolerates blank/heartbeat lines', () => {
    const buf = ': keepalive\n\ndata: {"x":1}\n\n';
    const events = parseSseBuffer(buf);
    expect(events).toHaveLength(1);
  });
});

describe('extractStreamingText — Anthropic SSE', () => {
  it('joins content_block_delta text', () => {
    const buf =
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world."}}\n\n';
    expect(extractStreamingText(buf)).toBe('Hello world.');
  });
});

describe('extractStreamingText — OpenAI SSE', () => {
  it('joins delta.content strings', () => {
    const buf =
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"world."}}]}\n\n' +
      'data: [DONE]\n\n';
    expect(extractStreamingText(buf)).toBe('Hello world.');
  });
});

describe('streamHasToolUse', () => {
  it('detects Anthropic streaming tool_use block', () => {
    const buf =
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1"}}\n\n';
    expect(streamHasToolUse(buf)).toBe(true);
  });

  it('detects OpenAI streaming tool_calls', () => {
    const buf =
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"t1"}]}}]}\n\n';
    expect(streamHasToolUse(buf)).toBe(true);
  });

  it('returns false for plain text streams', () => {
    const buf =
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n';
    expect(streamHasToolUse(buf)).toBe(false);
  });
});
