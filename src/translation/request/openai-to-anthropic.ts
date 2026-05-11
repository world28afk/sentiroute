import type { OpenAIRequest, AnthropicRequest, AnthropicMessage, AnthropicContentBlock, AnthropicTool } from '../types.js';

export function openaiToAnthropic(req: OpenAIRequest, upstreamModel: string): AnthropicRequest {
  const messages: AnthropicMessage[] = [];
  let system: string | undefined;

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      system = (system ?? '') + (msg.content as string || '');
    } else if (msg.role === 'user') {
      messages.push(convertUserMessage(msg));
    } else if (msg.role === 'assistant') {
      messages.push(convertAssistantMessage(msg));
    } else if (msg.role === 'tool') {
      messages.push(convertToolMessage(msg));
    }
  }

  const maxTokens = req.max_completion_tokens ?? req.max_tokens ?? 4096;

  const result: AnthropicRequest = {
    model: upstreamModel,
    messages,
    max_tokens: maxTokens,
  };

  if (system) {
    result.system = system;
  }

  if (req.temperature !== undefined) {
    result.temperature = req.temperature;
  }
  if (req.top_p !== undefined) {
    result.top_p = req.top_p;
  }
  if (req.stop) {
    result.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
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
  if (req.reasoning_effort) {
    const budget = req.reasoning_effort === 'high' ? 16000 : req.reasoning_effort === 'medium' ? 8000 : 2000;
    result.thinking = { type: 'enabled', budget_tokens: budget };
  }

  return result;
}

function convertUserMessage(msg: OpenAIRequest['messages'][0]): AnthropicMessage {
  if (!msg.content) {
    return { role: 'user', content: 'Continue' };
  }

  if (typeof msg.content === 'string') {
    return { role: 'user', content: msg.content };
  }

  const blocks: AnthropicContentBlock[] = [];
  for (const part of msg.content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      const url = part.image_url.url;
      if (url.startsWith('data:')) {
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: match[1], data: match[2] },
          });
        }
      }
    }
  }

  return { role: 'user', content: blocks };
}

function convertAssistantMessage(msg: OpenAIRequest['messages'][0]): AnthropicMessage {
  const blocks: AnthropicContentBlock[] = [];

  if (msg.content) {
    blocks.push({ type: 'text', text: msg.content as string });
  }

  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      const input = tryParseJson(tc.function.arguments);
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  if (!blocks.length) {
    blocks.push({ type: 'text', text: '' });
  }

  return { role: 'assistant', content: blocks };
}

function convertToolMessage(msg: OpenAIRequest['messages'][0]): AnthropicMessage {
  return {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: msg.tool_call_id || '',
      content: typeof msg.content === 'string' ? msg.content : '',
    }],
  };
}

function convertTool(tool: NonNullable<OpenAIRequest['tools']>[0]): AnthropicTool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  };
}

function convertToolChoice(tc: NonNullable<OpenAIRequest['tool_choice']>): AnthropicRequest['tool_choice'] {
  if (tc === 'auto') return 'auto';
  if (tc === 'required') return 'any';
  if (typeof tc === 'object' && 'function' in tc) {
    return { type: 'tool', name: tc.function.name };
  }
  return 'auto';
}

function tryParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}
