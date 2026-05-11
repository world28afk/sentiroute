import { describe, it, expect } from 'vitest';
import { parseSSE } from '../sse-parser.js';

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
}

async function collect<T>(iter: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iter) {
    items.push(item);
  }
  return items;
}

describe('parseSSE', () => {
  it('parses simple data-only events', async () => {
    const stream = streamFromString('data: {"hello":"world"}\n\n');
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"hello":"world"}');
    expect(events[0].event).toBeUndefined();
  });

  it('parses event type and data', async () => {
    const stream = streamFromString('event: message_start\ndata: {"type":"start"}\n\n');
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('message_start');
    expect(events[0].data).toBe('{"type":"start"}');
  });

  it('parses multiple events', async () => {
    const stream = streamFromString(
      'event: ping\ndata: {}\n\nevent: message_start\ndata: {"type":"start"}\n\n',
    );
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('ping');
    expect(events[1].event).toBe('message_start');
  });

  it('handles multi-line data', async () => {
    const stream = streamFromString('data: line1\ndata: line2\n\n');
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('line1\nline2');
  });

  it('handles chunked input across multiple reads', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: msg\ndata: {"t'));
        controller.enqueue(encoder.encode('ype":"start"}\n\n'));
        controller.close();
      },
    });
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('msg');
    expect(events[0].data).toBe('{"type":"start"}');
  });

  it('ignores empty events', async () => {
    const stream = streamFromString('\n\ndata: valid\n\n\n\n');
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('valid');
  });

  it('handles data: without space prefix', async () => {
    const stream = streamFromString('data:{"key":"val"}\n\n');
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"key":"val"}');
  });

  it('handles [DONE] signal', async () => {
    const stream = streamFromString('data: [DONE]\n\n');
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('[DONE]');
  });

  it('handles incomplete final line (no trailing newline)', async () => {
    const stream = streamFromString('data: {"partial":true}');
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"partial":true}');
  });

  it('handles empty stream', async () => {
    const stream = streamFromString('');
    const events = await collect(parseSSE(stream));
    expect(events).toHaveLength(0);
  });
});
