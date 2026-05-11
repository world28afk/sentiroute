import { describe, it, expect } from 'vitest';
import { openaiToAnthropic } from '../request/openai-to-anthropic.js';
import type { OpenAIRequest } from '../types.js';

describe('openaiToAnthropic', () => {
  it('extracts system message to top-level system', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.system).toBe('You are helpful.');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('concatenates multiple system messages', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hi' },
      ],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.system).toBe('Be helpful.Be concise.');
    expect(result.messages).toHaveLength(1);
  });

  it('converts simple user text message', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi there' }],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hi there' });
  });

  it('handles user content parts (text + image_url)', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this:' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abcdef' } },
          ],
        },
      ],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    const content = result.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content[0]).toEqual({ type: 'text', text: 'Describe this:' });
      expect(content[1]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'abcdef' },
      });
    }
  });

  it('handles empty user content as "Continue"', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: '' }],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Continue' });
  });

  it('converts assistant message with text content', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [
        { role: 'user', content: 'Help' },
        { role: 'assistant', content: 'How can I help?' },
      ],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    const msg = result.messages[1];
    expect(msg.role).toBe('assistant');
    if (Array.isArray(msg.content)) {
      expect(msg.content[0]).toMatchObject({ type: 'text', text: 'How can I help?' });
    }
  });

  it('converts tool_calls to tool_use content blocks', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [
        { role: 'user', content: 'Weather?' },
        {
          role: 'assistant',
          content: 'Let me check.',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"location":"NYC"}' } },
          ],
        },
      ],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    const msg = result.messages[1];
    expect(msg.role).toBe('assistant');
    if (Array.isArray(msg.content)) {
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]).toMatchObject({ type: 'text', text: 'Let me check.' });
      expect(msg.content[1]).toMatchObject({
        type: 'tool_use',
        id: 'call_1',
        name: 'get_weather',
        input: { location: 'NYC' },
      });
    }
  });

  it('handles unparseable tool_call arguments as _raw', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [
        { role: 'user', content: 'Hi' },
        {
          role: 'assistant',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: 'not-json' } },
          ],
        },
      ],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    const msg = result.messages[1];
    if (Array.isArray(msg.content)) {
      expect((msg.content[0] as any).input).toEqual({ _raw: 'not-json' });
    }
  });

  it('gives empty text block when assistant has neither content nor tool_calls', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: null as unknown as string },
      ],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    const msg = result.messages[1];
    if (Array.isArray(msg.content)) {
      expect(msg.content).toEqual([{ type: 'text', text: '' }]);
    }
  });

  it('converts tool role to user message with tool_result block', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [
        { role: 'user', content: 'Weather?' },
        { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'g', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: '72F' },
      ],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    const toolMsg = result.messages[2];
    expect(toolMsg.role).toBe('user');
    if (Array.isArray(toolMsg.content)) {
      expect(toolMsg.content[0]).toEqual({
        type: 'tool_result',
        tool_use_id: 'call_1',
        content: '72F',
      });
    }
  });

  it('converts tools with function definitions', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [
        { type: 'function', function: { name: 'search', description: 'Search the web', parameters: { type: 'object', properties: {} } } },
      ],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.tools).toHaveLength(1);
    expect(result.tools![0]).toEqual({
      name: 'search',
      description: 'Search the web',
      input_schema: { type: 'object', properties: {} },
    });
  });

  it('maps tool_choice "required" to "any"', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: 'required',
    };
    const result = openaiToAnthropic(req, 'gpt-5');
    expect(result.tool_choice).toBe('any');
  });

  it('maps tool_choice function object to {type:"tool", name}', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      tool_choice: { type: 'function', function: { name: 'search' } },
    };
    const result = openaiToAnthropic(req, 'gpt-5');
    expect(result.tool_choice).toEqual({ type: 'tool', name: 'search' });
  });

  it('maps stop to stop_sequences', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      stop: ['END', 'STOP'],
    };
    const result = openaiToAnthropic(req, 'gpt-5');
    expect(result.stop_sequences).toEqual(['END', 'STOP']);
  });

  it('converts single stop string to array', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      stop: 'END',
    };
    const result = openaiToAnthropic(req, 'gpt-5');
    expect(result.stop_sequences).toEqual(['END']);
  });

  it('passes through temperature, top_p, stream', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      top_p: 0.9,
      stream: true,
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
    expect(result.stream).toBe(true);
  });

  it('converts reasoning_effort "medium" to thinking budget 8000', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      reasoning_effort: 'medium',
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
  });

  it('converts reasoning_effort "high" to thinking budget 16000', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      reasoning_effort: 'high',
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.thinking).toEqual({ type: 'enabled', budget_tokens: 16000 });
  });

  it('converts reasoning_effort "low" to thinking budget 2000', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      reasoning_effort: 'low',
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 });
  });

  it('uses max_completion_tokens over max_tokens', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      max_completion_tokens: 200,
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.max_tokens).toBe(200);
  });

  it('defaults max_tokens to 4096 when neither is set', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.max_tokens).toBe(4096);
  });

  it('sets upstream model on result', () => {
    const req: OpenAIRequest = {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const result = openaiToAnthropic(req, 'claude-opus-4-7');
    expect(result.model).toBe('claude-opus-4-7');
  });
});
