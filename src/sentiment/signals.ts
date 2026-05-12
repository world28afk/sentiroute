/**
 * Sentiment signal detection — adapted from open-source sentiment analysis research.
 *
 * Techniques integrated:
 * - VADER (Hutto & Gilbert, ICWSM-14) — booster/dampener words, negation handling,
 *   ALL-CAPS amplifier, punctuation emphasis, empirical scalars (B_INCR, C_INCR, N_SCALAR).
 *   Reference: https://github.com/cjhutto/vaderSentiment
 * - NRC Emotion Lexicon — anger/disgust category framework.
 *   Reference: https://github.com/DemetersSon83/NRCLex
 * - LDNOOBW + google-profanity-words — curated English profanity terms (frustration-relevant only).
 *   References: https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words
 *               https://github.com/coffee-and-fun/google-profanity-words
 * - funNLP — Chinese sentiment dictionaries and internet slang corpora.
 *   Reference: https://github.com/fighting41love/funNLP
 */
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
// Curated from LDNOOBW and google-profanity-words for frustration-relevant terms only
// (sexual/discriminatory terms excluded as they are off-topic for coding contexts)
const PROFANITY_KEYWORDS = [
  // English — core profanity
  'fuck', 'shit', 'damn', 'ass', 'crap', 'garbage', 'trash',
  'wtf', 'bs', 'bullshit', 'fucking', 'shitty', 'damnit', 'dammit',
  'motherfucker', 'asshole', 'bitch', 'bastard', 'dickhead', 'dipshit',
  'piece of shit', 'dogshit', 'horse shit', 'clusterfuck', 'shitstorm',
  'piss off', 'screw you', 'go to hell', 'eat shit', 'fuck off',
  // English — milder but frustrated
  'goddamn', 'godammit', 'jesus christ', 'for fuck sake', 'for fucks sake',
  'fucked up', 'fubar', 'snafu', 'crappy', 'sucks', 'sucky',
  'screwed up', 'fcuk', 'fuk', 'fck', 'shyt', 'biatch',
  'bollocks', 'wanker', 'tosser', 'bloody hell', 'arse',
  // Chinese — core
  '垃圾', '废物', '狗屎', '去死', 'sb', '傻逼', '脑残',
  '妈的', '操', '艹', '我靠', '你妈', '草', '日',
  '智障', '白痴', '蠢货', '饭桶', '废柴', '渣',
  '煞笔', '二逼', '逗比', '坑货', '辣鸡', 'lj',
  // Chinese — milder frustration
  '尼玛', '泥煤', '我擦', '卧槽', '我去', '靠',
  '草泥马', 'tmd', '他妈', '他妈的', 'mlgb', 'cnm',
  '滚蛋', '滚开', '滚', '见鬼', '糟糕', '糟透了',
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

// ── VADER-inspired amplifiers ──
// Adapted from VADER (Hutto & Gilbert, 2014). Empirically derived intensity scalars.

const B_INCR = 0.293; // booster word increment
const B_DECR = -0.293; // dampener word decrement
const C_INCR = 0.733; // ALL-CAPS amplifier on a keyword itself
const N_SCALAR = -0.74; // negation scalar (flips/dampens valence)

// Booster words — amplify the sentiment intensity of a nearby keyword
const BOOSTER_WORDS: Record<string, number> = {
  // English boosters (B_INCR)
  'absolutely': B_INCR, 'amazingly': B_INCR, 'awfully': B_INCR,
  'completely': B_INCR, 'considerably': B_INCR, 'decidedly': B_INCR,
  'deeply': B_INCR, 'effing': B_INCR, 'enormously': B_INCR,
  'entirely': B_INCR, 'especially': B_INCR, 'exceptionally': B_INCR,
  'extremely': B_INCR, 'fabulously': B_INCR, 'flipping': B_INCR,
  'fricking': B_INCR, 'frigging': B_INCR, 'fully': B_INCR,
  'fucking': B_INCR, 'greatly': B_INCR, 'hella': B_INCR,
  'highly': B_INCR, 'hugely': B_INCR, 'incredibly': B_INCR,
  'intensely': B_INCR, 'majorly': B_INCR, 'particularly': B_INCR,
  'really': B_INCR, 'remarkably': B_INCR, 'so': B_INCR,
  'substantially': B_INCR, 'thoroughly': B_INCR, 'totally': B_INCR,
  'tremendously': B_INCR, 'unbelievably': B_INCR, 'utterly': B_INCR,
  'very': B_INCR, 'super': B_INCR, 'mega': B_INCR,
  // English dampeners (B_DECR)
  'almost': B_DECR, 'barely': B_DECR, 'hardly': B_DECR,
  'kind of': B_DECR, 'kinda': B_DECR, 'less': B_DECR,
  'marginally': B_DECR, 'occasionally': B_DECR, 'partly': B_DECR,
  'scarcely': B_DECR, 'slightly': B_DECR, 'somewhat': B_DECR,
  'sort of': B_DECR, 'sorta': B_DECR, 'a bit': B_DECR,
  // Chinese boosters
  '非常': B_INCR, '极其': B_INCR, '极度': B_INCR, '极': B_INCR,
  '太': B_INCR, '超': B_INCR, '超级': B_INCR, '巨': B_INCR,
  '特别': B_INCR, '特': B_INCR, '十分': B_INCR, '相当': B_INCR,
  '真是': B_INCR, '真的': B_INCR, '真': B_INCR, '完全': B_INCR,
  '简直': B_INCR, '彻底': B_INCR, '绝对': B_INCR, '老': B_INCR,
  // Chinese dampeners
  '有点': B_DECR, '有些': B_DECR, '稍微': B_DECR, '略': B_DECR,
  '稍': B_DECR, '不太': B_DECR, '不怎么': B_DECR,
};

// Negation words — flip or dampen sentiment of following keyword
const NEGATE_WORDS = new Set([
  // English
  'not', 'never', 'no', 'none', 'nothing', 'nowhere', 'nope',
  'cannot', 'cant', "can't", 'wont', "won't", 'isnt', "isn't",
  'arent', "aren't", 'wasnt', "wasn't", 'werent', "weren't",
  'dont', "don't", 'doesnt', "doesn't", 'didnt', "didn't",
  'hasnt', "hasn't", 'havent', "haven't", 'hadnt', "hadn't",
  'shouldnt', "shouldn't", 'wouldnt', "wouldn't", 'couldnt', "couldn't",
  'rarely', 'seldom', 'without', 'neither', 'nor',
  // Chinese
  '不', '没', '没有', '别', '勿', '未', '非', '无',
  '不是', '不会', '不能', '不要', '不该',
]);

// ── Scoring helpers ──

/**
 * Tokenize text into words, preserving original case for cap detection.
 * Splits on whitespace and punctuation, but keeps the words themselves intact.
 */
function tokenizeWords(text: string): string[] {
  return text.split(/[\s,.;:!?()\[\]{}'"`]+/).filter(Boolean);
}

/**
 * VADER-inspired keyword scoring with booster, negation, and emphasis amplifiers.
 *
 * Adapted from VADER (Hutto & Gilbert, ICWSM-14):
 * - Booster words (e.g., "extremely", "非常") amplify nearby keyword intensity
 * - Negation words (e.g., "not", "不") flip or dampen following keyword
 * - ALL-CAPS keyword gets C_INCR boost
 * - Repeated punctuation ("!!!" or "???") adds emphasis
 */
function keywordScore(text: string, keywords: readonly string[]): number {
  const lower = text.toLowerCase();
  const words = tokenizeWords(text);
  const lowerWords = words.map((w) => w.toLowerCase());

  // Count base hits (substring match for multi-word keywords)
  let totalValence = 0;
  let hits = 0;

  for (const kw of keywords) {
    if (!lower.includes(kw)) continue;
    hits++;

    let valence = 1.0;

    // Locate the keyword's first word in the tokenized list for context analysis
    const kwFirstWord = kw.split(/\s+/)[0]!.toLowerCase();
    const idx = lowerWords.indexOf(kwFirstWord);

    if (idx >= 0) {
      // Check ALL-CAPS on the matched word itself (VADER C_INCR)
      const origWord = words[idx]!;
      if (origWord.length >= 3 && origWord === origWord.toUpperCase() && /[A-Z]/.test(origWord)) {
        valence += C_INCR;
      }

      // Check up to 3 preceding words for boosters and negators (VADER window)
      for (let i = 1; i <= 3 && idx - i >= 0; i++) {
        const prev = lowerWords[idx - i]!;
        // Negation flips/dampens (VADER N_SCALAR)
        if (NEGATE_WORDS.has(prev)) {
          valence *= N_SCALAR;
          break; // negation found, stop scanning
        }
        // Booster amplifies (decays with distance)
        const boost = BOOSTER_WORDS[prev];
        if (boost !== undefined) {
          // Apply with distance decay (farther = less effect)
          const decay = 1 - (i - 1) * 0.05;
          valence += boost * decay;
          // Boost itself in caps gets extra
          const origPrev = words[idx - i]!;
          if (origPrev === origPrev.toUpperCase() && origPrev.length >= 3) {
            valence += C_INCR * 0.5;
          }
        }
      }
    }

    // Punctuation emphasis: trailing !!! or ??? near keyword
    const exclaimMatch = text.match(/[!]{1,4}/g);
    if (exclaimMatch) {
      const totalExclaim = exclaimMatch.join('').length;
      valence += Math.min(0.292, totalExclaim * 0.292 * 0.25);
    }

    // Clamp negative valence to 0 (negated frustration becomes neutral, not anti-frustration)
    totalValence += Math.max(0, valence);
  }

  if (hits === 0) return 0;

  // Average valence × hits/5 cap, then clamp
  const avgValence = totalValence / hits;
  const baseScore = Math.min(1.0, hits / 5);
  return Math.min(1.0, baseScore * avgValence);
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
