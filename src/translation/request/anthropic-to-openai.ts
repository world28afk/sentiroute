import type { AnthropicRequest, OpenAIRequest, OpenAIMessage, OpenAITool } from '../types.js';

export function anthropicToOpenAI(req: AnthropicRequest, upstreamModel: string): OpenAIRequest {
  const messages: OpenAIMessage[] = [];

  // System prompt → first message
  if (req.system) {
    const systemContent = typeof req.system === 'string'
      ? req.system
      : req.system.map((b) => b.text).join('\n');
    messages.push({ role: 'system', content: systemContent });
  }

  // Convert messages
  for (const msg of req.messages) {
    if (msg.role === 'user') {
      messages.push(convertUserMessage(msg));
    } else if (msg.role === 'assistant') {
      messages.push(convertAssistantMessage(msg));
    }
  }

  const result: OpenAIRequest = {
    model: upstreamModel,
    messages,
  };

  if (req.max_tokens) {
    result.max_tokens = req.max_tokens;
  }
  if (req.temperature !== undefined) {
    result.temperature = req.temperature;
  }
  if (req.top_p !== undefined) {
    result.top_p = req.top_p;
  }
  if (req.stop_sequences) {
    result.stop = req.stop_sequences;
  }
  if (req.stream !== undefined) {
    result.stream = req.stream;
  }
  if (req.tools?.length) {
    result.tools = req.tools.map(convertTool);
  }
  if (req.tool_choice) {
    result.tool_choice = convertToolChoice(req.tool_choice);
  }
  if (req.thinking) {
    result.reasoning_effort = 'medium';
  }

  return result;
}

function convertUserMessage(msg: AnthropicRequest['messages'][0]): OpenAIMessage {
  if (typeof msg.content === 'string') {
    return { role: 'user', content: msg.content };
  }

  const textParts: string[] = [];
  const imageParts: { type: 'image_url'; image_url: { url: string } }[] = [];
  let toolResult: { tool_call_id: string; content: string } | null = null;

  for (const block of msg.content) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'image') {
      imageParts.push({
        type: 'image_url',
        image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
      });
    } else if (block.type === 'tool_result') {
      toolResult = { tool_call_id: block.tool_use_id, content: block.content };
    }
  }

  if (toolResult) {
    return { role: 'tool', content: toolResult.content, tool_call_id: toolResult.tool_call_id };
  }

  if (imageParts.length) {
    const parts = [
      ...textParts.map((t) => ({ type: 'text' as const, text: t })),
      ...imageParts,
    ];
    return { role: 'user', content: parts };
  }

  return { role: 'user', content: textParts.join('\n') };
}

function convertAssistantMessage(msg: AnthropicRequest['messages'][0]): OpenAIMessage {
  if (typeof msg.content === 'string') {
    return { role: 'assistant', content: msg.content };
  }

  const texts: string[] = [];
  const toolCalls: OpenAIMessage['tool_calls'] = [];

  for (const block of msg.content) {
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
    // Skip thinking blocks — no OpenAI equivalent
  }

  return {
    role: 'assistant',
    content: texts.join('\n') || null,
    tool_calls: toolCalls.length ? toolCalls : undefined,
  };
}

function convertTool(tool: NonNullable<AnthropicRequest['tools']>[0]): OpenAITool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

function convertToolChoice(tc: AnthropicRequest['tool_choice']): OpenAIRequest['tool_choice'] {
  if (tc === 'auto') return 'auto';
  if (tc === 'any') return 'required';
  if (typeof tc === 'object' && 'name' in tc) {
    return { type: 'function', function: { name: tc.name } };
  }
  return 'auto';
}
