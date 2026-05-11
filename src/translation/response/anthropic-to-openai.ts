import { parseSSE } from '../sse-parser.js';
import type { AnthropicResponse, AnthropicSSEEvent, OpenAIResponse, OpenAIChunk } from '../types.js';

// ── Non-streaming response translation ──

export function translateAnthropicToOpenAIResponse(
  res: AnthropicResponse,
  upstreamModel: string,
): OpenAIResponse {
  const choice: OpenAIResponse['choices'][0] = {
    index: 0,
    message: { role: 'assistant', content: null },
    finish_reason: mapStopReason(res.stop_reason),
  };

  const texts: string[] = [];
  const toolCalls: OpenAIResponse['choices'][0]['message']['tool_calls'] = [];

  for (const block of res.content) {
    if (block.type === 'text') {
      texts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls!.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
    // Skip thinking blocks
  }

  choice.message.content = texts.join('\n') || null;
  if (toolCalls.length) {
    choice.message.tool_calls = toolCalls;
  }

  return {
    id: res.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: upstreamModel,
    choices: [choice],
    usage: res.usage
      ? {
          prompt_tokens: res.usage.input_tokens,
          completion_tokens: res.usage.output_tokens,
          total_tokens: res.usage.input_tokens + res.usage.output_tokens,
        }
      : undefined,
  };
}

// ── Streaming response translation ──

export function translateAnthropicToOpenAIStream(
  stream: ReadableStream<Uint8Array>,
  upstreamModel: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const eventIter = parseSSE(stream);

  let messageId = '';
  let model = upstreamModel;
  let created = Math.floor(Date.now() / 1000);
  let contentBlockToToolCall = new Map<number, number>();
  let toolCallCount = 0;
  let finishReason: string | null = null;
  let started = false;

  // Tool-call name/index tracking: content_block_start gives us id/name,
  // we need to emit them in the first tool_calls delta chunk
  let pendingToolNames = new Map<number, { id: string; name: string }>();

  const buildChunk = (delta: OpenAIChunk['choices'][0]['delta'], finish: string | null): string => {
    const chunk: OpenAIChunk = {
      id: messageId || 'chatcmpl-unknown',
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const sseEvent of eventIter) {
          if (sseEvent.event === 'ping') continue;

          const data: AnthropicSSEEvent = JSON.parse(sseEvent.data);

          switch (data.type) {
            case 'message_start': {
              if (data.message) {
                messageId = data.message.id;
                model = data.message.model || upstreamModel;
              }
              controller.enqueue(
                encoder.encode(buildChunk({ role: 'assistant', content: '' }, null)),
              );
              started = true;
              break;
            }

            case 'content_block_start': {
              const block = data.content_block!;
              const idx = data.index ?? 0;

              if (block.type === 'tool_use') {
                const tcIdx = toolCallCount++;
                contentBlockToToolCall.set(idx, tcIdx);
                pendingToolNames.set(idx, { id: block.id, name: block.name });

                controller.enqueue(
                  encoder.encode(
                    buildChunk(
                      {
                        tool_calls: [
                          {
                            index: tcIdx,
                            id: block.id,
                            type: 'function',
                            function: { name: block.name, arguments: '' },
                          },
                        ],
                      },
                      null,
                    ),
                  ),
                );
              }
              // text content_block_start → no emit, text_delta handles content
              break;
            }

            case 'content_block_delta': {
              const delta = data.delta!;
              const idx = data.index ?? 0;

              if (delta.type === 'text_delta') {
                controller.enqueue(
                  encoder.encode(buildChunk({ content: delta.text }, null)),
                );
              } else if (delta.type === 'input_json_delta') {
                const tcIdx = contentBlockToToolCall.get(idx) ?? 0;
                controller.enqueue(
                  encoder.encode(
                    buildChunk(
                      {
                        tool_calls: [
                          { index: tcIdx, function: { arguments: delta.partial_json } },
                        ],
                      },
                      null,
                    ),
                  ),
                );
              }
              break;
            }

            case 'content_block_stop':
              // No emit in OpenAI format
              break;

            case 'message_delta': {
              if (data.delta?.stop_reason) {
                finishReason = mapStopReason(data.delta.stop_reason);
              }
              break;
            }

            case 'message_stop': {
              controller.enqueue(
                encoder.encode(buildChunk({}, finishReason ?? 'stop')),
              );
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              break;
            }
          }
        }

        // Ensure [DONE] if stream ended without message_stop
        if (started) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

function mapStopReason(reason: string | null): OpenAIResponse['choices'][0]['finish_reason'] {
  if (!reason) return null;
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    default:
      return 'stop';
  }
}
