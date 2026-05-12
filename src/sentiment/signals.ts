import type { SentimentSignalWeights } from '../config/schema.js';

export const DEFAULT_WEIGHTS: SentimentSignalWeights = {
  profanity: 0.8,
  degradation: 0.9,
  imperatives: 0.4,
  caps: 0.3,
  brevity: 0.2,
  repetition: 0.6,
  aiRefusal: 0.7,
  aiHedging: 0.3,
  aiApology: 0.4,
  aiLengthDrop: 0.5,
};

// ── Keyword dictionaries ──

// Strong profanity — high confidence frustration
const PROFANITY_KEYWORDS = [
  // English
  'fuck', 'shit', 'damn', 'ass', 'crap', 'garbage', 'trash',
  'wtf', 'bs', 'bullshit', 'fucking', 'shitty',
  'motherfucker', 'asshole', 'bitch', 'bastard', 'dickhead',
  'piece of shit', 'dogshit', 'horse shit', 'clusterfuck',
  'piss off', 'screw you', 'go to hell', 'eat shit',
  // Chinese
  '垃圾', '废物', '狗屎', '去死', 'sb', '傻逼', '脑残',
  '妈的', '操', '艹', '我靠', '你妈', '草', '日',
  '智障', '白痴', '蠢货', '饭桶', '废柴', '渣',
  '煞笔', '二逼', '逗比', '坑货', '辣鸡', 'lj',
];

// Degradation / 降智 signals — the core detection target
const DEGRADATION_KEYWORDS = [
  // English — direct
  '降智', 'dumb', 'dumber', 'stupid', 'idiot', 'idiotic',
  'downgrade', 'downgraded', 'lobotomize', 'lobotomized',
  'nerf', 'nerfed', 'useless', 'broken', 'worse',
  'terrible', 'horrible', 'awful', 'pathetic', 'trash',
  // English — comparative / regression
  'regression', 'regressed', 'degraded', 'degradation',
  'used to be better', 'not as good', 'dumber than',
  'getting worse', 'went downhill', 'took a dive',
  'quality dropped', 'went to shit', 'fell off',
  'braindead', 'brain dead', 'smooth brain', 'regarded',
  'incompetent', 'incapable', 'clueless', 'helpless',
  'hallucinating', 'making things up', 'fabricated',
  'confabulat', 'you\'re lying', 'that\'s not real',
  // English — meta complaints
  'are you dumb', 'are you stupid', 'what happened to',
  'you used to', 'what\'s wrong with you', 'get your act',
  'do you even', 'can you not', 'how hard is it',
  // Chinese — direct
  '越来越笨', '变傻了', '不行了', '退化', '变蠢',
  '智商下降', '弱智', '变差了', '不好使了',
  // Chinese — regression / slang
  '拉胯', '拉了', '摆烂', '离谱', '逆天', '无语子',
  '退步了', '开倒车', '不如以前', '越更新越烂',
  '又犯病了', '老毛病又犯了', '犯了什么毛病',
  '是不是换模型了', '降级了吧', '降智了吧',
  '答非所问', '不知所云', '一头雾水',
  '什么玩意', '这都答不对', '你在逗我',
  '幻觉', '编的', '瞎编', '胡说八道', '胡扯',
  '人工智障', '人工愚蠢', '智障助手',
];

// Imperatives and mid-level frustration
const IMPERATIVE_KEYWORDS = [
  // English
  'stop', "don't", 'wrong', 'incorrect', 'no',
  'fix this', 'fix it', 'bad', 'terrible',
  'listen', 'are you listening', 'read my', 'pay attention',
  'again', 'still wrong', 'not working', 'doesn\'t work',
  'for the last time', 'I already told you', 'how many times',
  'I said', 'as I said', 'like I said', 'I just said',
  'seriously', 'unbelievable', 'unacceptable', 'are you kidding',
  'what a joke', 'give me a break', 'come on',
  're-read', 'reread', 'look again', 'try again',
  'not what I asked', 'that\'s not what', 'I didn\'t ask',
  'you\'re not helping', 'this is pointless', 'waste of time',
  'same error', 'same mistake', 'still broken', 'still not',
  'why do you keep', 'stop refusing', 'just do it',
  // Chinese
  '不对', '错了', '不是', '能不能', '怎么回事', '又来了',
  '老是', '总是', '烦死了', '怎么会', '为什么', '搞什么',
  '坑爹', '无语', '服了', '受不了', '够了', '到底',
  '听不懂吗', '看不懂吗', '我说了', '再说一遍',
  '你没听见', '你没看到', '重新看', '重新读',
  '不是这个意思', '你理解错了', '你听我说',
  '别再', '不要再说', '闭嘴', '行了行了',
  '白说了', '说了等于没说', '对牛弹琴',
  '什么鬼', '搞毛', '搞啥', '啥玩意',
];

// ── AI Response analysis keywords ──

// Refusal signals — model declining to help
const REFUSAL_KEYWORDS = [
  // English
  "i can't help with", "i cannot assist", "i'm unable to",
  "i'm not able to", "i must decline", "i'm not permitted",
  "against my guidelines", "i'm not allowed", "i can't provide",
  "i cannot provide", "i'm not comfortable", "i must refuse",
  "that's not something i can", "beyond my capabilities",
  "i don't have the ability", "i lack the ability",
  "as an ai", "as a language model", "as an assistant",
  "i don't have access", "i cannot access", "i can't access",
  "i'm designed to", "my training doesn't",
  "please consult a professional", "seek professional advice",
  "i strongly recommend against", "i advise against",
  // Chinese
  '不能', '无法', '没办法', '不可以', '不允许', '违反规定',
  '超出了我的能力', '我无法帮助', '我不能协助',
  '作为AI', '作为语言模型', '作为助手',
  '我没有权限', '我没有访问', '建议咨询专业人士',
];

// Hedging/uncertainty signals — model becoming less confident
const HEDGING_KEYWORDS = [
  // English
  "i'm not sure", "it's possible", "maybe", "this might",
  "i think perhaps", "not 100%", "i could be wrong",
  "uncertain", "it depends", "there's a chance",
  "i'm not entirely sure", "i'm not confident",
  "take this with a grain of salt", "don't quote me",
  "roughly", "approximately", "more or less",
  "i believe", "my understanding is", "to my knowledge",
  "if i recall correctly", "if i'm not mistaken",
  // Chinese
  '不确定', '可能', '也许', '大概', '或许', '不一定',
  '我不太确定', '我不太清楚', '据我所知',
  '仅供参考', '不一定对', '可能有误',
];

// Apology signals — model frequently apologizing
const APOLOGY_KEYWORDS = [
  // English
  'i apologize', 'sorry about that', 'my mistake', 'my apologies',
  'i was wrong', 'let me correct', 'apologize for the confusion',
  'i\'m sorry', 'sorry for the', 'apologies for',
  'i made an error', 'that was my fault', 'i messed up',
  'let me try again', 'let me redo', 'let me fix that',
  'i appreciate your patience', 'thank you for your patience',
  'bear with me', 'please excuse',
  // Chinese
  '抱歉', '对不起', '不好意思', '我的错', '我错了',
  '请原谅', '请见谅', '感谢您的耐心', '请稍等',
];

// ── Scoring helpers ──

function keywordScore(text: string, keywords: readonly string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) hits++;
  }
  // Cap at 5 hits = 1.0 (raised from 3)
  return Math.min(1.0, hits / 5);
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

/**
 * Jaccard similarity with CJK-aware tokenization.
 * For CJK text, uses character bigrams instead of whitespace splitting.
 */
function jaccardSimilarity(a: string, b: string): number {
  const aTokens = tokenize(a.toLowerCase());
  const bTokens = tokenize(b.toLowerCase());
  const intersection = [...aTokens].filter((w) => bTokens.has(w)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

const CJK_RANGE = /[一-鿿㐀-䶿豈-﫿]/;

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  // Split on whitespace for Latin words
  const words = text.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (CJK_RANGE.test(w)) {
      // CJK word: emit character bigrams
      for (let i = 0; i < w.length - 1; i++) {
        tokens.add(w[i]! + w[i + 1]!);
      }
      // Also emit single chars for very short words
      if (w.length === 1) tokens.add(w);
    } else {
      tokens.add(w);
    }
  }
  // Also scan raw text for CJK bigrams that may not be whitespace-separated
  for (let i = 0; i < text.length - 1; i++) {
    if (CJK_RANGE.test(text[i]!) && CJK_RANGE.test(text[i + 1]!)) {
      tokens.add(text[i]! + text[i + 1]!);
    }
  }
  return tokens;
}

// ── Multi-message analysis ──

/**
 * Analyze the last N user messages for accumulated frustration signals.
 * Returns a score based on keyword density across recent messages.
 */
function multiMessageScore(messages: string[], keywords: readonly string[], window: number = 3): number {
  if (messages.length === 0) return 0;
  const recent = messages.slice(-window);
  const combined = recent.join(' ');
  return keywordScore(combined, keywords);
}

/**
 * Detect escalation pattern: user getting progressively more frustrated.
 * Compares sentiment density of recent messages vs earlier ones.
 */
function escalationScore(messages: string[]): number {
  if (messages.length < 4) return 0;

  const halfIdx = Math.floor(messages.length / 2);
  const earlier = messages.slice(0, halfIdx).join(' ');
  const recent = messages.slice(halfIdx).join(' ');

  const allKw = [...PROFANITY_KEYWORDS, ...DEGRADATION_KEYWORDS, ...IMPERATIVE_KEYWORDS];
  const lowerEarlier = earlier.toLowerCase();
  const lowerRecent = recent.toLowerCase();

  let earlierHits = 0;
  let recentHits = 0;
  for (const kw of allKw) {
    if (lowerEarlier.includes(kw)) earlierHits++;
    if (lowerRecent.includes(kw)) recentHits++;
  }

  // Normalize by length
  const earlierDensity = earlier.length > 0 ? earlierHits / (earlier.length / 100) : 0;
  const recentDensity = recent.length > 0 ? recentHits / (recent.length / 100) : 0;

  // Significant increase in frustration density
  if (recentDensity > earlierDensity * 2 && recentHits >= 2) {
    return Math.min(1.0, (recentDensity - earlierDensity) * 2);
  }
  return 0;
}

// ── AI Response analysis ──

export interface AIResponseSignals {
  refusal: number;
  hedging: number;
  apology: number;
  lengthScore: number;
}

/**
 * Extract assistant messages from conversation history.
 */
export function extractAssistantMessages(
  messages: Array<{ role: string; content: string | unknown }>,
): string[] {
  const result: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
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

/**
 * Analyze an AI response for degradation signals.
 */
export function analyzeAIResponse(
  responseText: string,
  avgResponseLength: number = 0,
): AIResponseSignals {
  if (!responseText) {
    return { refusal: 0, hedging: 0, apology: 0, lengthScore: 0 };
  }

  const refusal = keywordScore(responseText, REFUSAL_KEYWORDS);
  const hedging = keywordScore(responseText, HEDGING_KEYWORDS);
  const apology = keywordScore(responseText, APOLOGY_KEYWORDS);

  // Length anomaly: compare to rolling average
  let lengthScore = 0;
  if (avgResponseLength > 100) {
    const ratio = responseText.length / avgResponseLength;
    // If response is less than 40% of average length, flag it
    if (ratio < 0.4) {
      lengthScore = Math.min(1.0, (0.4 - ratio) * 2.5);
    }
  }

  return { refusal, hedging, apology, lengthScore };
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
    escalation: number;
    multiProfanity: number;
    multiDegradation: number;
    aiRefusal: number;
    aiHedging: number;
    aiApology: number;
    aiLengthDrop: number;
  };
}

export function analyzeSentiment(
  userMessages: string[],
  weights: SentimentSignalWeights = DEFAULT_WEIGHTS,
  aiSignals?: AIResponseSignals,
): AnalysisResult {
  if (!userMessages.length) {
    return {
      score: 0,
      signals: {
        profanity: 0, degradation: 0, imperatives: 0, caps: 0,
        brevity: 0, repetition: 0, escalation: 0,
        multiProfanity: 0, multiDegradation: 0,
        aiRefusal: 0, aiHedging: 0, aiApology: 0, aiLengthDrop: 0,
      },
    };
  }

  const lastIdx = userMessages.length - 1;
  const lastMsg = userMessages[lastIdx]!;

  // Single-message signals
  const signals = {
    profanity: keywordScore(lastMsg, PROFANITY_KEYWORDS),
    degradation: keywordScore(lastMsg, DEGRADATION_KEYWORDS),
    imperatives: keywordScore(lastMsg, IMPERATIVE_KEYWORDS),
    caps: capsRatioScore(lastMsg),
    brevity: brevityScore(userMessages, lastIdx),
    repetition: repetitionScore(userMessages),
    // Multi-message signals (look at last 3 messages)
    escalation: escalationScore(userMessages),
    multiProfanity: multiMessageScore(userMessages, PROFANITY_KEYWORDS, 3),
    multiDegradation: multiMessageScore(userMessages, DEGRADATION_KEYWORDS, 3),
    // AI response signals
    aiRefusal: aiSignals?.refusal ?? 0,
    aiHedging: aiSignals?.hedging ?? 0,
    aiApology: aiSignals?.apology ?? 0,
    aiLengthDrop: aiSignals?.lengthScore ?? 0,
  };

  // Weighted average normalized to 0-1
  const totalWeight =
    weights.profanity + weights.degradation + weights.imperatives +
    weights.caps + weights.brevity + weights.repetition +
    weights.aiRefusal + weights.aiHedging + weights.aiApology + weights.aiLengthDrop;

  if (totalWeight === 0) return { score: 0, signals };

  // Take the max of single-message and multi-message for profanity/degradation
  const effectiveProfanity = Math.max(signals.profanity, signals.multiProfanity * 0.8);
  const effectiveDegradation = Math.max(signals.degradation, signals.multiDegradation * 0.8);

  const score =
    (effectiveProfanity * weights.profanity +
     effectiveDegradation * weights.degradation +
     signals.imperatives * weights.imperatives +
     signals.caps * weights.caps +
     signals.brevity * weights.brevity +
     signals.repetition * weights.repetition +
     signals.escalation * 0.5 +
     signals.aiRefusal * weights.aiRefusal +
     signals.aiHedging * weights.aiHedging +
     signals.aiApology * weights.aiApology +
     signals.aiLengthDrop * weights.aiLengthDrop) / (totalWeight + 0.5);

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
