import type { SentimentSignalWeights } from '../config/schema.js';

export const DEFAULT_WEIGHTS: SentimentSignalWeights = {
  profanity: 0.8,
  degradation: 0.9,
  imperatives: 0.4,
  caps: 0.3,
  brevity: 0.2,
  repetition: 0.6,
};

// ── Keyword dictionaries ──

// Strong profanity — high confidence frustration
const PROFANITY_KEYWORDS = [
  'fuck', 'shit', 'damn', 'ass', 'crap', 'garbage', 'trash',
  'wtf', 'bs', 'bullshit', 'fucking', 'shitty', 'crap',
  '垃圾', '废物', '狗屎', '去死', 'sb', '傻逼', '脑残',
  '妈的', '操', '艹', '我靠',
];

// Degradation / 降智 signals — the core detection target
const DEGRADATION_KEYWORDS = [
  '降智', 'dumb', 'dumber', 'stupid', 'idiot', 'idiotic',
  'downgrade', 'downgraded', 'lobotomize', 'lobotomized',
  'nerf', 'nerfed', 'useless', 'broken', 'worse',
  'terrible', 'horrible', 'awful', 'pathetic',
  '越来越笨', '变傻了', '不行了', '退化', '变蠢',
  '智商下降', '弱智', '变差了', '不好使了',
  'are you dumb', 'are you stupid', 'what happened to',
  'you used to be', 'not as good', 'dumber than',
];

// Imperatives and mid-level frustration
const IMPERATIVE_KEYWORDS = [
  'stop', "don't", 'wrong', 'incorrect', 'no',
  'fix this', 'fix it', 'bad', '不对', '错了',
  '不是', '能不能', '怎么回事', '又来了', '老是', '总是',
  '烦死了', '怎么会', '为什么', '搞什么', '坑爹',
  '无语', '服了', '受不了', '够了', '到底',
  'listen', 'are you listening', 'read my', 'pay attention',
  'again', 'still wrong', 'not working',
];

// ── Scoring helpers ──

function keywordScore(text: string, keywords: readonly string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) hits++;
  }
  // Cap at 3 hits = 1.0
  return Math.min(1.0, hits / 3);
}

function capsRatioScore(text: string): number {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 8) return 0; // Need minimum length to judge
  const uppers = letters.replace(/[^A-Z]/g, '');
  const ratio = uppers.length / letters.length;
  // Shouting threshold: > 50% caps
  return ratio > 0.5 ? Math.min(1.0, (ratio - 0.5) * 2) : 0;
}

function brevityScore(messages: string[], currentIndex: number): number {
  const current = messages[currentIndex] ?? '';
  // Very short message after longer context
  if (current.length > 15) return 0;

  // Check if previous messages were significantly longer (user was engaged, now terse)
  const prev = messages.slice(Math.max(0, currentIndex - 3), currentIndex);
  const avgPrev = prev.reduce((s, m) => s + m.length, 0) / (prev.length || 1);
  if (avgPrev < 50) return 0; // Context wasn't long enough to judge

  return Math.min(1.0, (15 - current.length) / 15);
}

function repetitionScore(messages: string[]): number {
  if (messages.length < 3) return 0;

  // Look for highly similar adjacent user messages
  let maxConsecutive = 0;
  let currentRun = 0;

  for (let i = 1; i < messages.length; i++) {
    const similarity = jaccardSimilarity(messages[i - 1], messages[i]);
    if (similarity > 0.6) {
      currentRun++;
      maxConsecutive = Math.max(maxConsecutive, currentRun);
    } else {
      currentRun = 0;
    }
  }

  // 2+ repeats (3+ of same thing) → score starts ramping
  if (maxConsecutive < 2) return 0;
  return Math.min(1.0, (maxConsecutive - 1) / 3);
}

function jaccardSimilarity(a: string, b: string): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/));
  const bWords = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...aWords].filter((w) => bWords.has(w)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Main analysis ──

export interface AnalysisResult {
  score: number;
  signals: {
    profanity: number;
    degradation: number;
    imperatives: number;
    caps: number;
    brevity: number;
    repetition: number;
  };
}

export function analyzeSentiment(
  userMessages: string[],
  weights: SentimentSignalWeights = DEFAULT_WEIGHTS,
): AnalysisResult {
  if (!userMessages.length) {
    return { score: 0, signals: { profanity: 0, degradation: 0, imperatives: 0, caps: 0, brevity: 0, repetition: 0 } };
  }

  const lastIdx = userMessages.length - 1;
  const lastMsg = userMessages[lastIdx];

  const signals = {
    profanity: keywordScore(lastMsg, PROFANITY_KEYWORDS),
    degradation: keywordScore(lastMsg, DEGRADATION_KEYWORDS),
    imperatives: keywordScore(lastMsg, IMPERATIVE_KEYWORDS),
    caps: capsRatioScore(lastMsg),
    brevity: brevityScore(userMessages, lastIdx),
    repetition: repetitionScore(userMessages),
  };

  // Weighted average normalized to 0-1
  const totalWeight =
    weights.profanity + weights.degradation + weights.imperatives +
    weights.caps + weights.brevity + weights.repetition;

  if (totalWeight === 0) return { score: 0, signals };

  const score =
    (signals.profanity * weights.profanity +
     signals.degradation * weights.degradation +
     signals.imperatives * weights.imperatives +
     signals.caps * weights.caps +
     signals.brevity * weights.brevity +
     signals.repetition * weights.repetition) / totalWeight;

  return { score: Math.min(1.0, score), signals };
}

export function extractUserMessages(
  messages: Array<{ role: string; content: string | unknown }>,
): string[] {
  const result: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') {
      result.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      const texts = (msg.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!);
      if (texts.length) result.push(texts.join('\n'));
    }
  }
  return result;
}
