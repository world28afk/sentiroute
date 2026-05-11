import { describe, it, expect } from 'vitest';
import { anthropicToOpenAI } from '../request/anthropic-to-openai.js';
import type { AnthropicRequest } from '../types.js';

describe('anthropicToOpenAI', () => {
  it('converts system prompt to system message', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
      system: 'You are helpful.',
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('converts simple user text message', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Hi there' }],
      max_tokens: 50,
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hi there' });
    expect(result.model).toBe('gpt-5');
  });

  it('converts assistant message with text content blocks', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [
        { role: 'user', content: 'Help' },
        { role: 'assistant', content: [{ type: 'text', text: 'Sure!' }] },
      ],
      max_tokens: 50,
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    expect(result.messages[1]).toMatchObject({ role: 'assistant', content: 'Sure!' });
  });

  it('converts tool_use content block to tool_calls', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [
        { role: 'user', content: 'Weather?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { location: 'NYC' } },
          ],
        },
      ],
      max_tokens: 100,
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    const assistantMsg = result.messages[1];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls![0].function.name).toBe('get_weather');
    expect(assistantMsg.tool_calls![0].function.arguments).toBe('{"location":"NYC"}');
  });

  it('converts tool_result to tool role message', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '72F' }] },
      ],
      max_tokens: 50,
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    expect(result.messages[0].role).toBe('tool');
    expect(result.messages[0].content).toBe('72F');
  });

  it('converts tools with input_schema to function definitions', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 50,
      tools: [{ name: 'search', input_schema: { type: 'object', properties: {} } }],
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].type).toBe('function');
    expect(result.tools![0].function.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('maps tool_choice "any" to "required"', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 50,
      tool_choice: 'any',
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    expect(result.tool_choice).toBe('required');
  });

  it('maps stop_sequences to stop', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 50,
      stop_sequences: ['END', 'STOP'],
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    expect(result.stop).toEqual(['END', 'STOP']);
  });

  it('passes through temperature, top_p, stream', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 50,
      temperature: 0.7,
      top_p: 0.9,
      stream: true,
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
    expect(result.stream).toBe(true);
  });

  it('converts thinking to reasoning_effort', () => {
    const req: AnthropicRequest = {
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 50,
      thinking: { type: 'enabled', budget_tokens: 8000 },
    };
    const result = anthropicToOpenAI(req, 'gpt-5');
    expect(result.reasoning_effort).toBe('medium');
  });
});
