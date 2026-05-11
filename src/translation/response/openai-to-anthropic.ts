import { parseSSE } from '../sse-parser.js';
import type { OpenAIResponse, OpenAIChunk, AnthropicResponse } from '../types.js';

// ── Non-streaming response translation ──

export function translateOpenAIToAnthropicResponse(
  res: OpenAIResponse,
  upstreamModel: string,
): AnthropicResponse {
  const choice = res.choices[0];
  const content: AnthropicResponse['content'] = [];

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: tryParseJson(tc.function.arguments),
      });
    }
  }

  return {
    id: res.id,
    type: 'message',
    role: 'assistant',
    content,
    model: upstreamModel,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: res.usage
      ? {
          input_tokens: res.usage.prompt_tokens,
          output_tokens: res.usage.completion_tokens,
        }
      : { input_tokens: 0, output_tokens: 0 },
  };
}

// ── Streaming response translation ──

export function translateOpenAIToAnthropicStream(
  stream: ReadableStream<Uint8Array>,
  upstreamModel: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const eventIter = parseSSE(stream);

  let messageId = `msg_${Date.now()}`;
  let model = upstreamModel;
  let contentBlockIndex = 0;
  let textBlockOpen = false;
  let toolCallAccum: Map<number, { id: string; name: string; arguments: string; cbIdx: number }> = new Map();
  let finishReason: string | null = null;
  let started = false;
  let blocksClosed = false;
  let inputTokens = 0;
  let outputTokens = 0;

  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => {
    const lines = [`event: ${event}`, `data: ${JSON.stringify(data)}`, '', ''];
    controller.enqueue(encoder.encode(lines.join('\n')));
  };

  const closeTextBlock = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (!textBlockOpen) return;
    emit(controller, 'content_block_stop', {
      type: 'content_block_stop',
      index: contentBlockIndex - 1,
    });
    textBlockOpen = false;
  };

  const closeToolBlocks = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    for (const [, tc] of toolCallAccum) {
      emit(controller, 'content_block_stop', {
        type: 'content_block_stop',
        index: tc.cbIdx,
      });
    }
  };

  const closeAllBlocks = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (blocksClosed) return;
    blocksClosed = true;
    closeTextBlock(controller);
    closeToolBlocks(controller);
  };

  const emitFinish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    closeAllBlocks(controller);
    emit(controller, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: mapFinishReason(finishReason), stop_sequence: null },
      usage: { output_tokens: outputTokens },
    });
    emit(controller, 'message_stop', { type: 'message_stop' });
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const sseEvent of eventIter) {
          if (sseEvent.data === '[DONE]') {
            emitFinish(controller);
            controller.close();
            return;
          }

          const chunk: OpenAIChunk = JSON.parse(sseEvent.data);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (!started) {
            started = true;
            if (chunk.id) messageId = chunk.id;
            if (chunk.model) model = chunk.model;
            emit(controller, 'message_start', {
              type: 'message_start',
              message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: inputTokens, output_tokens: 0 },
              },
            });
          }

          // Handle text content
          if (delta.content) {
            if (!textBlockOpen) {
              textBlockOpen = true;
              const cbIdx = contentBlockIndex++;
              emit(controller, 'content_block_start', {
                type: 'content_block_start',
                index: cbIdx,
                content_block: { type: 'text', text: '' },
              });
            }
            emit(controller, 'content_block_delta', {
              type: 'content_block_delta',
              index: contentBlockIndex - 1,
              delta: { type: 'text_delta', text: delta.content },
            });
          }

          // Handle tool calls
          if (delta.tool_calls) {
            // Close text block before starting tool calls
            closeTextBlock(controller);

            for (const tcDelta of delta.tool_calls) {
              const tcIdx = tcDelta.index;

              if (!toolCallAccum.has(tcIdx)) {
                const id = tcDelta.id ?? `toolu_${tcIdx}`;
                const name = tcDelta.function?.name ?? '';
                const cbIdx = contentBlockIndex++;
                toolCallAccum.set(tcIdx, { id, name, arguments: '', cbIdx });

                emit(controller, 'content_block_start', {
                  type: 'content_block_start',
                  index: cbIdx,
                  content_block: { type: 'tool_use', id, name, input: {} },
                });
              }

              if (tcDelta.function?.arguments) {
                const tc = toolCallAccum.get(tcIdx)!;
                tc.arguments += tcDelta.function.arguments;
                emit(controller, 'content_block_delta', {
                  type: 'content_block_delta',
                  index: tc.cbIdx,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tcDelta.function.arguments,
                  },
                });
              }
            }
          }

          // Handle finish_reason
          if (chunk.choices?.[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
            closeAllBlocks(controller);
          }

          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens;
            outputTokens = chunk.usage.completion_tokens;
          }
        }

        // Stream ended without [DONE] — close gracefully
        if (started) {
          emitFinish(controller);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

function mapFinishReason(reason: string | null): AnthropicResponse['stop_reason'] {
  if (!reason) return null;
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'content_filter':
      return 'end_turn';
    default:
      return null;
  }
}

function tryParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}
