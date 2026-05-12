import { describe, it, expect } from 'vitest';
import { analyzeSentiment, extractUserMessages, extractAssistantMessages, analyzeAIResponse, DEFAULT_WEIGHTS } from '../signals.js';

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

describe('extractAssistantMessages', () => {
  it('extracts assistant messages', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'Help' },
      { role: 'assistant', content: 'Sure thing' },
    ];
    expect(extractAssistantMessages(messages)).toEqual(['Hi there', 'Sure thing']);
  });

  it('handles content blocks', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
    ];
    expect(extractAssistantMessages(messages)).toEqual(['Part 1\nPart 2']);
  });

  it('returns empty for no assistant messages', () => {
    expect(extractAssistantMessages([{ role: 'user', content: 'Hi' }])).toEqual([]);
  });
});

describe('analyzeAIResponse', () => {
  it('returns zero for empty text', () => {
    const result = analyzeAIResponse('');
    expect(result.refusal).toBe(0);
    expect(result.hedging).toBe(0);
    expect(result.apology).toBe(0);
    expect(result.lengthScore).toBe(0);
  });

  it('detects refusal signals', () => {
    const result = analyzeAIResponse("I'm sorry, but I can't help with that request. As an AI, I'm not permitted to assist with this.");
    expect(result.refusal).toBeGreaterThan(0);
  });

  it('detects hedging signals', () => {
    const result = analyzeAIResponse("I'm not sure about this, but it's possible that maybe this could work. I could be wrong though.");
    expect(result.hedging).toBeGreaterThan(0);
  });

  it('detects apology signals', () => {
    const result = analyzeAIResponse("I apologize for the confusion. My mistake, let me correct that. Sorry about the error.");
    expect(result.apology).toBeGreaterThan(0);
  });

  it('detects length anomaly', () => {
    // Response is very short compared to average of 2000 chars
    const result = analyzeAIResponse('Done.', 2000);
    expect(result.lengthScore).toBeGreaterThan(0);
  });

  it('no length anomaly when response is normal length', () => {
    const result = analyzeAIResponse('x'.repeat(1800), 2000);
    expect(result.lengthScore).toBe(0);
  });

  it('detects Chinese refusal', () => {
    const result = analyzeAIResponse('对不起，我无法帮助你完成这个请求。作为AI，我不可以协助此类操作。');
    expect(result.refusal).toBeGreaterThan(0);
  });

  it('detects Chinese hedging', () => {
    const result = analyzeAIResponse('我不太确定，可能这个方案也许可行，但不一定对。');
    expect(result.hedging).toBeGreaterThan(0);
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

  it('detects Chinese slang degradation', () => {
    const result = analyzeSentiment(['这模型太拉胯了，退步了']);
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

  it('detects Chinese repetition with bigrams', () => {
    const result = analyzeSentiment([
      '你这个代码不对',
      '你这个代码不对',
      '你这个代码不对',
    ]);
    expect(result.signals.repetition).toBeGreaterThan(0);
  });

  it('detects escalation pattern', () => {
    const result = analyzeSentiment([
      'Hello, can you help me with this function?',
      'That doesn\'t seem right, can you fix it?',
      'This is wrong, fix it now',
      'STOP THIS IS BROKEN FIX THIS GARBAGE',
    ]);
    expect(result.signals.escalation).toBeGreaterThan(0);
  });

  it('no escalation when frustration is constant', () => {
    const result = analyzeSentiment([
      'this is garbage',
      'this is garbage',
      'this is garbage',
    ]);
    // No escalation because frustration level is constant
    expect(result.signals.escalation).toBe(0);
  });

  it('detects multi-message profanity', () => {
    const result = analyzeSentiment([
      'this is bad',
      'this is garbage',
      'this is fucking trash',
    ]);
    expect(result.signals.multiProfanity).toBeGreaterThan(0);
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
    expect(result.score).toBeGreaterThan(0.15);
  });

  it('respects custom weights', () => {
    const zeroWeights = {
      ...DEFAULT_WEIGHTS,
      profanity: 0, degradation: 0, imperatives: 0, caps: 0, brevity: 0, repetition: 0,
      aiRefusal: 0, aiHedging: 0, aiApology: 0, aiLengthDrop: 0,
    };
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

  it('incorporates AI response signals', () => {
    const aiSignals = {
      refusal: 0.8,
      hedging: 0.0,
      apology: 0.0,
      lengthScore: 0.0,
    };
    const result = analyzeSentiment(['help me with this'], DEFAULT_WEIGHTS, aiSignals);
    expect(result.signals.aiRefusal).toBe(0.8);
    expect(result.score).toBeGreaterThan(0);
  });

  it('AI signals boost user frustration score', () => {
    const base = analyzeSentiment(['this is wrong, fix it']);
    const withAI = analyzeSentiment(['this is wrong, fix it'], DEFAULT_WEIGHTS, {
      refusal: 0.6, hedging: 0, apology: 0, lengthScore: 0,
    });
    expect(withAI.score).toBeGreaterThan(base.score);
  });

  it('Chinese imperatives detected', () => {
    const result = analyzeSentiment(['不对，错了，再看看']);
    expect(result.signals.imperatives).toBeGreaterThan(0);
  });

  it('detects exasperation phrases', () => {
    const result = analyzeSentiment(['seriously? are you kidding me? what a joke']);
    expect(result.signals.imperatives).toBeGreaterThan(0);
  });

  it('detects hallucination complaints', () => {
    const result = analyzeSentiment(['you are hallucinating, that is not real, you made it up']);
    expect(result.signals.degradation).toBeGreaterThan(0);
  });

  it('detects Chinese hallucination complaints', () => {
    const result = analyzeSentiment(['你在幻觉吧，这是编的，胡说八道']);
    expect(result.signals.degradation).toBeGreaterThan(0);
  });
});
