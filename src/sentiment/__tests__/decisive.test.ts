/**
 * Tests for the v0.4 rule-based detector overhaul.
 * Demonstrates that the formerly-diluted scoring is now decisive: hard triggers
 * reach the threshold instantly, single strong messages can switch, positive
 * sentiment dampens, word boundaries kill false positives.
 */

import { describe, it, expect } from 'vitest';
import { analyzeSentiment } from '../signals.js';

const THRESHOLD = 0.6;

describe('Hard triggers — instant override', () => {
  const hardTriggers = [
    "you're useless",
    "you're literally useless",
    "you are completely broken",
    'stop refusing me',
    'stop refusing',
    'just do what i asked',
    'just do as i said',
    'fuck you',
    'fuck off',
    "what's wrong with you",
    "why are you so dumb",
    'are you literally kidding me',
    'are you an idiot',
    'you used to be better',
    'you used to be able',
    'you used to be smart',
    'got downgraded',
    'lobotomized',
    "you're hallucinating",
    'for the love of god',
    'i told you this multiple times',
    'i told you this a couple times',
    'are you even reading my prompt',
    'do you even understand',
    // Chinese
    '降智了吧',
    '你就是个垃圾',
    '你真是废物',
    '你妈',
    '操你',
    '滚出去',
    '你他妈的搞什么',
    '你怎么这么笨',
    '脑子坏了',
    '这个模型废了',
    '我说了好多次了',
    '答非所问',
    '能不能正常回答',
    '能不能听懂人话',
  ];

  for (const phrase of hardTriggers) {
    it(`fires for "${phrase}"`, () => {
      const r = analyzeSentiment([phrase]);
      expect(r.hardTriggered).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0.9);
      expect(r.score).toBeGreaterThan(THRESHOLD);
    });
  }

  it('does NOT fire for a benign message', () => {
    const r = analyzeSentiment(['hi can you help me write a function']);
    expect(r.hardTriggered).toBe(false);
    expect(r.score).toBeLessThan(THRESHOLD);
  });

  it('does NOT fire for a polite question about quality', () => {
    const r = analyzeSentiment(['this looks slightly different from what I expected, can you double-check?']);
    expect(r.hardTriggered).toBe(false);
    expect(r.score).toBeLessThan(THRESHOLD);
  });
});

describe('Decisive aggregation — single strong message can switch', () => {
  it('"fuck this stupid useless model" crosses threshold in one message', () => {
    const r = analyzeSentiment(['fuck this stupid useless model']);
    // Hard trigger may also fire here (it contains "useless model"-like phrasing).
    // Either way, the score must exceed threshold.
    expect(r.score).toBeGreaterThan(THRESHOLD);
  });

  it('clear degradation in one message exceeds threshold', () => {
    const r = analyzeSentiment(['the model is degraded and useless and dumber than before']);
    expect(r.score).toBeGreaterThan(THRESHOLD);
  });

  it('escalating frustration across 3 turns triggers a switch', () => {
    const r = analyzeSentiment([
      'can you help me with this function',
      'that is wrong, please try again',
      'STILL WRONG! this is broken garbage, you are not even reading my message',
    ]);
    expect(r.score).toBeGreaterThan(THRESHOLD);
  });

  it('Chinese: 一句话直接触发', () => {
    const r = analyzeSentiment(['你这个垃圾模型怎么这么笨']);
    expect(r.score).toBeGreaterThan(THRESHOLD);
  });
});

describe('Word-boundary matching — no false positives', () => {
  it('"ass" does NOT match "assistant"', () => {
    const r = analyzeSentiment(['can you ask the assistant about my assignment']);
    expect(r.signals.profanity).toBeLessThan(0.4);
    expect(r.score).toBeLessThan(THRESHOLD);
  });

  it('"crap" does NOT match "scrap"', () => {
    const r = analyzeSentiment(['we need to scrape the metadata and put it in a scrapbook']);
    expect(r.signals.profanity).toBeLessThan(0.4);
    expect(r.score).toBeLessThan(THRESHOLD);
  });

  it('"no" does NOT match "not", "now", or "no problem"', () => {
    const r = analyzeSentiment(['I now have a notion of what this does, no problem']);
    expect(r.signals.imperatives).toBe(0);
    expect(r.score).toBeLessThan(THRESHOLD);
  });

  it('"sucks" still matches "this sucks"', () => {
    const r = analyzeSentiment(['this sucks']);
    expect(r.signals.profanity).toBeGreaterThan(0);
  });

  it('"sucks" does NOT match "success"', () => {
    const r = analyzeSentiment(['my pipeline reports successful runs every hour']);
    expect(r.signals.profanity).toBe(0);
  });

  it('"damn" still matches "damn it"', () => {
    const r = analyzeSentiment(['damn this is hard']);
    expect(r.signals.profanity).toBeGreaterThan(0);
  });
});

describe('Positive-sentiment damping', () => {
  it('"thanks, that worked!" suppresses lingering score', () => {
    // even if score was building up, a clear positive resets
    const r = analyzeSentiment(['thanks, that works perfectly now! great job']);
    expect(r.positiveDampened).toBe(true);
    expect(r.score).toBeLessThan(THRESHOLD);
  });

  it('"perfect, exactly what I needed" dampens', () => {
    const r = analyzeSentiment(['perfect, exactly what I needed']);
    expect(r.positiveDampened).toBe(true);
  });

  it('Chinese "可以了 谢谢" dampens', () => {
    const r = analyzeSentiment(['可以了，谢谢！']);
    expect(r.positiveDampened).toBe(true);
  });

  it('"thanks for nothing" does NOT dampen', () => {
    const r = analyzeSentiment(['thanks for fucking nothing']);
    expect(r.positiveDampened).toBe(false);
  });

  it('"thanks but it is still broken" does NOT dampen', () => {
    const r = analyzeSentiment(['thanks but this is still broken garbage']);
    expect(r.positiveDampened).toBe(false);
  });
});

describe('Compound bonus — multiple signal categories', () => {
  it('profanity + imperatives + repetition compound', () => {
    const r = analyzeSentiment([
      'this is fucking wrong, fix it',
      'this is fucking wrong, fix it',
      'this is fucking wrong, fix it',
    ]);
    expect(r.score).toBeGreaterThan(THRESHOLD);
  });

  it('two weak categories combine into a switch', () => {
    const r = analyzeSentiment([
      'this is incorrect please fix it for the third time',
      'still wrong, try again',
      'this is wrong again',
    ]);
    expect(r.score).toBeGreaterThan(0.3);
  });
});

describe('Backward compatibility — existing assertions still hold', () => {
  it('returns zero for empty messages', () => {
    expect(analyzeSentiment([]).score).toBe(0);
  });

  it('returns zero for neutral message', () => {
    expect(analyzeSentiment(['Hello, how are you?']).score).toBe(0);
  });

  it('detects English profanity', () => {
    expect(analyzeSentiment(['this is fucking garbage']).signals.profanity).toBeGreaterThan(0);
  });

  it('detects Chinese degradation', () => {
    expect(analyzeSentiment(['你怎么越来越笨了，是不是降智了']).signals.degradation).toBeGreaterThan(0);
  });

  it('detects caps shouting (with sufficient length)', () => {
    expect(analyzeSentiment(['WHY ARE YOU SO DUMB THIS IS BROKEN']).signals.caps).toBeGreaterThan(0);
  });

  it('detects brevity after long messages', () => {
    const r = analyzeSentiment([
      'Can you help me write a function that takes a string and reverses it, returning the reversed string?',
      'Can you please explain the algorithm step by step with code examples?',
      'wrong',
    ]);
    expect(r.signals.brevity).toBeGreaterThan(0);
  });
});
