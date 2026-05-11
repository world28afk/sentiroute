import { describe, it, expect } from 'vitest';
import { analyzeSentiment, extractUserMessages, DEFAULT_WEIGHTS } from '../signals.js';

describe('extractUserMessages', () => {
  it('extracts string content from user messages', () => {
    const messages = [
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Help me' },
    ];
    const result = extractUserMessages(messages);
    expect(result).toEqual(['Hello', 'Help me']);
  });

  it('extracts text from content blocks', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
      },
    ];
    const result = extractUserMessages(messages);
    expect(result).toEqual(['First part\nSecond part']);
  });

  it('skips non-text content blocks', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { data: 'abc', media_type: 'image/png' } },
          { type: 'text', text: 'Describe this' },
        ],
      },
    ];
    const result = extractUserMessages(messages);
    expect(result).toEqual(['Describe this']);
  });

  it('returns empty for no user messages', () => {
    const messages = [
      { role: 'system', content: 'System' },
      { role: 'assistant', content: 'Assistant' },
    ];
    expect(extractUserMessages(messages)).toEqual([]);
  });

  it('handles empty array', () => {
    expect(extractUserMessages([])).toEqual([]);
  });
});

describe('analyzeSentiment', () => {
  it('returns zero for empty messages', () => {
    const result = analyzeSentiment([]);
    expect(result.score).toBe(0);
    expect(result.signals.profanity).toBe(0);
    expect(result.signals.degradation).toBe(0);
  });

  it('returns zero for neutral message', () => {
    const result = analyzeSentiment(['Hello, how are you?']);
    expect(result.score).toBe(0);
  });

  it('detects profanity', () => {
    const result = analyzeSentiment(['this is fucking garbage']);
    expect(result.signals.profanity).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it('detects degradation / 降智 keywords', () => {
    const result = analyzeSentiment(['you are so dumb and lobotomized']);
    expect(result.signals.degradation).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
  });

  it('detects Chinese degradation keywords', () => {
    const result = analyzeSentiment(['你怎么越来越笨了，是不是降智了']);
    expect(result.signals.degradation).toBeGreaterThan(0);
  });

  it('detects imperatives', () => {
    const result = analyzeSentiment(['stop, this is wrong, fix it']);
    expect(result.signals.imperatives).toBeGreaterThan(0);
  });

  it('detects caps shouting', () => {
    const result = analyzeSentiment(['WHY ARE YOU SO DUMB THIS IS BROKEN']);
    expect(result.signals.caps).toBeGreaterThan(0);
  });

  it('caps requires minimum length', () => {
    const result = analyzeSentiment(['HI THERE']);
    expect(result.signals.caps).toBe(0); // too short (< 8 letters)
  });

  it('detects brevity after long messages', () => {
    const result = analyzeSentiment([
      'Can you help me write a function that takes a string and reverses it, returning the reversed string?',
      'Can you please explain the algorithm step by step with code examples and comments so I can understand it clearly?',
      'wrong',
    ]);
    expect(result.signals.brevity).toBeGreaterThan(0);
  });

  it('no brevity when all messages are short', () => {
    const result = analyzeSentiment(['Hi', 'Help', 'cool']);
    expect(result.signals.brevity).toBe(0);
  });

  it('detects repetition', () => {
    const result = analyzeSentiment([
      'you are wrong wrong wrong',
      'you are wrong wrong wrong',
      'you are wrong wrong wrong',
    ]);
    expect(result.signals.repetition).toBeGreaterThan(0);
  });

  it('no repetition for dissimilar messages', () => {
    const result = analyzeSentiment(['Hello there', 'How are you', 'What time is it']);
    expect(result.signals.repetition).toBe(0);
  });

  it('combines multiple signals', () => {
    const result = analyzeSentiment([
      'This is fucking stupid garbage you dumb idiot',
      'This is fucking stupid garbage you dumb idiot',
      'This is fucking stupid garbage you dumb idiot',
    ]);
    expect(result.signals.profanity).toBeGreaterThan(0);
    expect(result.signals.degradation).toBeGreaterThan(0);
    expect(result.signals.repetition).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0.5);
  });

  it('respects custom weights', () => {
    const zeroWeights = { ...DEFAULT_WEIGHTS, profanity: 0, degradation: 0, imperatives: 0, caps: 0, brevity: 0, repetition: 0 };
    const result = analyzeSentiment(['fucking garbage'], zeroWeights);
    expect(result.score).toBe(0);
  });

  it('caps score at 1.0', () => {
    const result = analyzeSentiment([
      'fuck shit damn garbage trash wtf bs crap',
      'fuck shit damn garbage trash wtf bs crap',
      'fuck shit damn garbage trash wtf bs crap',
      'fuck shit damn garbage trash wtf bs crap',
      'fuck shit damn garbage trash wtf bs crap',
    ]);
    expect(result.score).toBeLessThanOrEqual(1.0);
  });
});
