/**
 * Sentiment signal detection — adapted from open-source sentiment analysis
 * and model-degradation research.
 *
 * v0.4 overhaul (the "useless and pretty" → "decisive" pass):
 *   1. Word-boundary matching for ASCII keywords (kills 'no' inside 'no problem',
 *      'ass' inside 'assistant', 'sucks' inside 'success').
 *   2. Hard-trigger phrases (e.g. "you're useless", "降智了吧", "stop refusing me")
 *      jump the score to 0.95 immediately, bypassing the weighted-average dilution
 *      that previously kept maxed-out scores well below the 0.6 threshold.
 *   3. Positive-sentiment reset — when the user just thanked/praised the model, the
 *      final score is halved so a momentarily-elevated history doesn't trigger a
 *      switch right after the model recovered.
 *   4. Max-aggregation for high-confidence signals (profanity, degradation) instead
 *      of averaging them away with low-weight noise.
 *   5. Compound bonus when ≥2 signal categories fire (multiple kinds of evidence).
 *
 * Sentiment / lexicon techniques:
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
 *
 * Model-degradation detection techniques:
 * - SelfCheckGPT (Manakul et al., EMNLP-23) — self-consistency framework. Adapted to
 *   single-response n-gram repetition (no multi-sampling, zero added latency).
 *   Reference: https://github.com/potsawee/selfcheckgpt
 * - UQLM (CVS Health) — uncertainty quantification signal taxonomy (refusal, hedging,
 *   consistency-based degradation). Inspired our aiRefusal/aiHedging/aiSelfRepetition signals.
 *   Reference: https://github.com/cvs-health/uqlm
 * - GPT-4 "got lazy" phenomenon (Dec 2023 community observation) — laziness keyword
 *   dictionary covers known degradation patterns: "rest of code unchanged", "// TODO",
 *   "implementation goes here", etc.
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
  aiLaziness: 0.8,
  aiDisclaimer: 0.3,
  aiSelfRepetition: 0.5,
};

// ── Hard-trigger phrases ────────────────────────────────────────────────
//
// These bypass weighted averaging entirely. A single match pins the score
// to HARD_TRIGGER_SCORE so the switch fires *this* request, not three
// frustrated turns later.

const HARD_TRIGGER_SCORE = 0.95;

const HARD_TRIGGER_PATTERNS: readonly RegExp[] = [
  // English — direct attack on the model's identity / competence
  /\byou(?:'?re|\s+are)\s+(?:fucking\s+|literally\s+|so\s+)?(?:useless|broken|hopeless|incompetent|worthless|garbage|trash|the\s+worst|braindead|brain[-\s]?dead)\b/i,
  /\bfuck(?:ing)?\s+(?:off|you)\b/i,
  /\bstop\s+(?:refusing|being\s+lazy|wasting\s+my\s+time|making\s+excuses|hallucinating)\b/i,
  /\bjust\s+(?:fucking\s+|do\s+what|do\s+as)\s+(?:do\s+it|i\s+(?:asked|said|told\s+you))\b/i,
  /\b(?:this|you|the\s+model)\s+(?:is|are|got|has\s+been)\s+(?:literally\s+|completely\s+)?(?:useless|broken|degraded|lobotomized|lobotomised|nerfed|dumber|stupid|worthless)\b/i,
  /\bwhat[''']?s\s+wrong\s+with\s+you\b/i,
  /\bwhy\s+are\s+you\s+(?:so\s+|being\s+so\s+)?(?:dumb|stupid|useless|broken|slow|incompetent)\b/i,
  /\bare\s+you\s+(?:fucking\s+|literally\s+|even\s+)?(?:dumb|stupid|kidding|joking|listening|reading|an\s+idiot)\b/i,
  /\byou\s+(?:used\s+to|previously)\s+(?:be\s+|could\s+)?(?:better|able|smart|capable)\b/i,
  /\b(?:got\s+)?(?:downgraded|lobotomized|lobotomised|nerfed)\b/i,
  /\byou(?:'?re|\s+are)\s+(?:literally\s+)?hallucinating\b/i,
  /\bfor\s+the\s+(?:love\s+of\s+god|tenth\s+time|hundredth\s+time|millionth\s+time|last\s+time)\b/i,
  /\bi\s+(?:already\s+)?(?:said|told\s+you|asked)\s+(?:this\s+)?(?:\d+|a\s+(?:few|couple)|multiple|many|too\s+many)\s+times\b/i,
  /\bare\s+you\s+(?:even\s+)?reading\s+(?:what\s+i|my\s+(?:message|prompt|question))\b/i,
  /\bdo\s+you\s+(?:even|actually)\s+understand\b/i,
  /\bgive\s+up\b.{0,15}\b(?:on\s+you|trying)\b/i,

  // Chinese — direct attack
  /降智了吧?/,
  /你(?:就|真|是)?(?:是个?|的是)?(?:垃圾|废物|傻[逼比子BX]|脑残|智障|蠢货|废柴)/,
  /(?:去死|滚蛋|滚开|滚出去|爬|爬出去)/,
  /(?:你)?(?:到底|tmd|TMD|他妈的?)(?:在(?:做|搞)什么|搞什么|是不是傻|懂不懂|怎么回事)/,
  /你(?:真|越来越|怎么(?:这么|那么)?)(?:笨|蠢|傻|拉胯|不行|没用|废)/,
  /(?:操你|你妈|草你|草泥马|c你|cnm|nmsl|你妈死了)/i,
  /(?:脑子|脑壳|脑袋)(?:坏了|有病|进水|不行)/,
  /(?:这个?\s*)?(?:模型|这玩意儿?|这个?\s*AI|这个?\s*助手)(?:降智|降级|完蛋|废了|崩了|坏了|不行了|拉了)/i,
  /(?:老子|我)(?:都\s*)?(?:说|讲|告诉)(?:你)?了\s*(?:好\s*)?(?:多少|几|n|N|十几|很多)\s*(?:次|遍)/i,
  /(?:你)?(?:能不能|到底)(?:听|看)(?:得)?懂(?:中文|人话|英文)/,
  /你(?:在|tm|TM)?(?:故意|装)(?:傻|蠢|笨)/i,
  /(?:答非所问|不知所云|胡说八道|胡言乱语|一派胡言)/,
  /(?:废话|说废话|净说废话|尽说废话)/,
  /(?:你)?(?:能不能|可不可以)(?:正常|认真)(?:回答|说话|思考)/,
  /(?:怎么|为什么)(?:这么|那么|越来越)(?:笨|蠢|傻|拉胯|不行|没用|废|垃圾)/,
  /(?:垃圾|废物|傻[逼比]|烂)\s*(?:模型|AI|助手|玩意儿?|东西)/i,
  /(?:这个?|那个?)?\s*(?:模型|AI|助手|玩意儿?)\s*(?:真是?|实在|太|是|就是)\s*(?:垃圾|废物|烂|不行|拉胯|没用|废)/i,
  /(?:老子|我)(?:都\s*)?(?:说|讲|告诉)(?:你)?了\s*(?:好\s*)?(?:多少|多|几|n|N|十几|很多)\s*(?:次|遍|回)/i,
];

function matchesHardTrigger(text: string): boolean {
  for (const re of HARD_TRIGGER_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

// ── Positive-sentiment patterns ─────────────────────────────────────────
//
// When the user is in "ok cool, thanks" mode the model just helped them;
// elevated history shouldn't suddenly trigger a switch. Damps final score.

const POSITIVE_TRIGGER_PATTERNS: readonly RegExp[] = [
  /\b(?:thanks?|thank\s+you|thx|ty)\b(?!\s+(?:for\s+nothing|a\s+lot\s+of\s+good))/i,
  /\b(?:perfect|excellent|amazing|brilliant|wonderful|fantastic|great\s+job|good\s+job|nice\s+job|well\s+done)\b/i,
  /\b(?:it\s+works|works\s+now|that\s+works|fixed\s+it|fixed\s+now|solved|sorted|figured\s+it\s+out)\b/i,
  /\b(?:got\s+it|i\s+see|i\s+understand|makes\s+sense|that\s+makes\s+sense|understood)\b/i,
  /\bexactly\b/i,
  /\b(?:you'?re|you\s+are)\s+(?:right|correct|a\s+lifesaver|the\s+best)\b/i,
  /\bmuch\s+better\b/i,
  /\blooks\s+(?:good|great|right|correct)\b/i,

  // Chinese
  /(?:谢谢|感谢|多谢|3q|3Q|3ks)/i,
  /(?:太棒了|太好了|完美|绝了|牛|nb|NB|niubility|niu)/i,
  /(?:可以了|搞定了?|解决了|搞掂|搞定)/,
  /(?:明白了|懂了|理解了|get到了?|学到了)/i,
  /(?:不错|挺好|挺棒|挺不错|很好|很棒|很赞|很对)/,
  /(?:对的?|正确|没问题|没毛病|没错)/,
  /(?:你真聪明|你真厉害|你真棒|你真行)/,
];

function matchesPositive(text: string): boolean {
  // Don't dampen if the message *also* contains frustration markers
  // — "thanks for fucking nothing" should still register as negative.
  for (const re of HARD_TRIGGER_PATTERNS) if (re.test(text)) return false;
  if (/\b(?:fuck|shit|damn|wtf|stupid|broken|wrong|terrible|garbage)\b/i.test(text)) return false;
  if (/(?:垃圾|废物|fuck|妈的|傻[逼比])/i.test(text)) return false;

  for (const re of POSITIVE_TRIGGER_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

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
  'confabulat', "you're lying", "that's not real",
  // English — meta complaints
  'are you dumb', 'are you stupid', 'what happened to',
  'you used to', "what's wrong with you", 'get your act',
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
  'stop', "don't", 'wrong', 'incorrect',
  'fix this', 'fix it', 'bad',
  'listen', 'are you listening', 'read my', 'pay attention',
  'again', 'still wrong', 'not working', "doesn't work",
  'for the last time', 'I already told you', 'how many times',
  'I said', 'as I said', 'like I said', 'I just said',
  'seriously', 'unbelievable', 'unacceptable', 'are you kidding',
  'what a joke', 'give me a break', 'come on',
  're-read', 'reread', 'look again', 'try again',
  'not what I asked', "that's not what", "I didn't ask",
  "you're not helping", 'this is pointless', 'waste of time',
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
  "i'm sorry", 'sorry for the', 'apologies for',
  'i made an error', 'that was my fault', 'i messed up',
  'let me try again', 'let me redo', 'let me fix that',
  'i appreciate your patience', 'thank you for your patience',
  'bear with me', 'please excuse',
  // Chinese
  '抱歉', '对不起', '不好意思', '我的错', '我错了',
  '请原谅', '请见谅', '感谢您的耐心', '请稍等',
];

// Lazy placeholder signals — model leaving stubs instead of code
// Known degradation signature from the "GPT-4 got lazy" phenomenon (Dec 2023)
const LAZINESS_KEYWORDS = [
  // Generic placeholders
  'rest of the code', 'rest of code', 'rest of your code',
  '// ... rest of', '# ... rest of', '/* ... rest',
  '// your code here', '# your code here', '// implementation here',
  '// implementation goes here', '# implementation goes here',
  '// continue with', '# continue with', '// add your', '# add your',
  '// remaining code', '# remaining code', '// rest unchanged',
  '// previous code unchanged', '# previous code unchanged',
  '// existing code', '# existing code', '// other methods',
  '// fill in', '# fill in', '// implement this', '# implement this',
  '... (rest of', '... (remaining', '... (continue',
  '[insert ', '[your ', '[add ', '[implement ', '[fill in',
  '<your_', '<insert_', '<add_', 'your_function_here',
  '// todo:', '# todo:', '// fixme:', '# fixme:',
  // Lazy explanations instead of code
  "i'll provide a high-level", "here's a high-level",
  "here's a general outline", 'here is a general outline',
  "i'll provide an outline", "here's a skeleton",
  "i won't write out the full", 'i will not write out',
  'you can implement', 'you would implement',
  'left as an exercise', 'beyond the scope of',
  // Chinese
  '其余代码', '剩余代码', '剩下的代码', '其他代码',
  '此处省略', '省略部分', '省略了', '此处略',
  '保持不变', '其余部分不变', '其他部分省略',
  '你的代码', '你的实现', '请自行实现', '自行补充',
  '请补充', '请实现', '请填写', '请添加',
  '具体实现略', '细节略', '不再赘述',
];

// Excessive disclaimer/safety boilerplate — degraded models pad with hedges
const DISCLAIMER_KEYWORDS = [
  // English — meta-disclaimers
  "it's important to note", 'it is important to note',
  "it's important to remember", 'it is important to remember',
  "it's worth noting", 'it is worth noting',
  "it's worth mentioning", 'it is worth mentioning',
  'please be aware', 'please note that', 'please keep in mind',
  'please remember that', 'keep in mind that',
  'i should mention', 'i should note', 'i should point out',
  'i must emphasize', 'i would like to emphasize',
  'it should be noted', 'it must be noted',
  'as a reminder', 'as a side note', 'as a disclaimer',
  // English — over-cautious framing
  'while i can', 'while i am able', 'although i can',
  'before i begin', 'before we proceed', 'before we start',
  'i want to make sure', 'i want to be clear',
  'to be clear', 'to be safe', 'just to be safe',
  'with that said', 'having said that', 'that being said',
  'in the interest of', 'for the sake of clarity',
  // Chinese — meta-disclaimers
  '需要注意的是', '值得注意的是', '请注意', '请记住',
  '需要指出的是', '需要说明的是', '需要强调的是',
  '需要提醒的是', '需要提及的是', '需要明确的是',
  '务必注意', '务必记住', '不可忽视的是',
  '需要补充说明', '请务必', '请确保', '请谨记',
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

const CJK_RANGE_TEST = /[㐀-䶿一-鿿豈-﫿]/;

/** Pure-ASCII short token? Apply word boundaries to dodge substring false-positives. */
function shouldUseWordBoundary(keyword: string): boolean {
  if (CJK_RANGE_TEST.test(keyword)) return false;
  if (/\s/.test(keyword)) return false; // multi-word phrases already have context
  if (keyword.length > 8) return false; // long words rarely false-match
  return /^[a-z']+$/i.test(keyword);
}

const _kwRegexCache = new Map<string, RegExp>();
function keywordHitsText(text: string, keyword: string): boolean {
  if (shouldUseWordBoundary(keyword)) {
    let re = _kwRegexCache.get(keyword);
    if (!re) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['']");
      re = new RegExp(`\\b${escaped}\\b`, 'i');
      _kwRegexCache.set(keyword, re);
    }
    return re.test(text);
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
}

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
 *
 * v0.4: ASCII keywords matched with word boundaries; CJK and multi-word
 * keywords still substring-matched.
 */
function keywordScore(text: string, keywords: readonly string[]): number {
  const words = tokenizeWords(text);
  const lowerWords = words.map((w) => w.toLowerCase());

  let totalValence = 0;
  let hits = 0;

  for (const kw of keywords) {
    if (!keywordHitsText(text, kw)) continue;
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
          break;
        }
        const boost = BOOSTER_WORDS[prev];
        if (boost !== undefined) {
          const decay = 1 - (i - 1) * 0.05;
          valence += boost * decay;
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

    totalValence += Math.max(0, valence);
  }

  if (hits === 0) return 0;

  // Average valence × hits/3 cap (was /5 — too lenient), clamped
  const avgValence = totalValence / hits;
  const baseScore = Math.min(1.0, hits / 3);
  return Math.min(1.0, baseScore * avgValence);
}

function capsRatioScore(text: string): number {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 8) return 0;
  const uppers = letters.replace(/[^A-Z]/g, '');
  const ratio = uppers.length / letters.length;
  return ratio > 0.5 ? Math.min(1.0, (ratio - 0.5) * 2) : 0;
}

function brevityScore(messages: string[], currentIndex: number): number {
  const current = messages[currentIndex] ?? '';
  if (current.length > 15) return 0;

  const prev = messages.slice(Math.max(0, currentIndex - 3), currentIndex);
  const avgPrev = prev.reduce((s, m) => s + m.length, 0) / (prev.length || 1);
  if (avgPrev < 50) return 0;

  return Math.min(1.0, (15 - current.length) / 15);
}

function repetitionScore(messages: string[]): number {
  if (messages.length < 3) return 0;

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

  if (maxConsecutive < 2) return 0;
  return Math.min(1.0, (maxConsecutive - 1) / 3);
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = tokenize(a.toLowerCase());
  const bTokens = tokenize(b.toLowerCase());
  const intersection = [...aTokens].filter((w) => bTokens.has(w)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

const CJK_RANGE = /[一-鿿㐀-䶿豈-﫿]/;

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const words = text.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (CJK_RANGE.test(w)) {
      for (let i = 0; i < w.length - 1; i++) {
        tokens.add(w[i]! + w[i + 1]!);
      }
      if (w.length === 1) tokens.add(w);
    } else {
      tokens.add(w);
    }
  }
  for (let i = 0; i < text.length - 1; i++) {
    if (CJK_RANGE.test(text[i]!) && CJK_RANGE.test(text[i + 1]!)) {
      tokens.add(text[i]! + text[i + 1]!);
    }
  }
  return tokens;
}

// ── Multi-message analysis ──

function multiMessageScore(messages: string[], keywords: readonly string[], window: number = 3): number {
  if (messages.length === 0) return 0;
  const recent = messages.slice(-window);
  const combined = recent.join(' ');
  return keywordScore(combined, keywords);
}

function escalationScore(messages: string[]): number {
  if (messages.length < 4) return 0;

  const halfIdx = Math.floor(messages.length / 2);
  const earlier = messages.slice(0, halfIdx).join(' ');
  const recent = messages.slice(halfIdx).join(' ');

  const allKw = [...PROFANITY_KEYWORDS, ...DEGRADATION_KEYWORDS, ...IMPERATIVE_KEYWORDS];

  let earlierHits = 0;
  let recentHits = 0;
  for (const kw of allKw) {
    if (keywordHitsText(earlier, kw)) earlierHits++;
    if (keywordHitsText(recent, kw)) recentHits++;
  }

  const earlierDensity = earlier.length > 0 ? earlierHits / (earlier.length / 100) : 0;
  const recentDensity = recent.length > 0 ? recentHits / (recent.length / 100) : 0;

  if (recentDensity > earlierDensity * 2 && recentHits >= 2) {
    return Math.min(1.0, (recentDensity - earlierDensity) * 2);
  }
  return 0;
}

// ── AI Response analysis ──

function selfRepetitionScore(text: string): number {
  if (text.length < 200) return 0;

  const stripped = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ');

  const words = stripped
    .toLowerCase()
    .split(/[\s,.;:!?()\[\]{}'"`\n]+/)
    .filter((w) => w.length > 1);

  if (words.length < 50) return 0;

  const ngramSize = 6;
  const ngrams = new Map<string, number>();
  for (let i = 0; i <= words.length - ngramSize; i++) {
    const gram = words.slice(i, i + ngramSize).join(' ');
    ngrams.set(gram, (ngrams.get(gram) ?? 0) + 1);
  }

  let repeatedGrams = 0;
  let maxCount = 0;
  for (const count of ngrams.values()) {
    if (count >= 2) {
      repeatedGrams++;
      maxCount = Math.max(maxCount, count);
    }
  }

  const totalGrams = words.length - ngramSize + 1;
  const repeatRatio = repeatedGrams / totalGrams;

  if (repeatRatio < 0.02 && maxCount < 3) return 0;

  return Math.min(1.0, repeatRatio * 10 + (maxCount - 2) * 0.2);
}

export interface AIResponseSignals {
  refusal: number;
  hedging: number;
  apology: number;
  lengthScore: number;
  laziness: number;
  disclaimer: number;
  selfRepetition: number;
}

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

export function analyzeAIResponse(
  responseText: string,
  avgResponseLength: number = 0,
): AIResponseSignals {
  if (!responseText) {
    return {
      refusal: 0, hedging: 0, apology: 0, lengthScore: 0,
      laziness: 0, disclaimer: 0, selfRepetition: 0,
    };
  }

  const refusal = keywordScore(responseText, REFUSAL_KEYWORDS);
  const hedging = keywordScore(responseText, HEDGING_KEYWORDS);
  const apology = keywordScore(responseText, APOLOGY_KEYWORDS);
  const laziness = keywordScore(responseText, LAZINESS_KEYWORDS);
  const disclaimer = keywordScore(responseText, DISCLAIMER_KEYWORDS);
  const selfRepetition = selfRepetitionScore(responseText);

  let lengthScore = 0;
  if (avgResponseLength > 100) {
    const ratio = responseText.length / avgResponseLength;
    if (ratio < 0.4) {
      lengthScore = Math.min(1.0, (0.4 - ratio) * 2.5);
    }
  }

  return { refusal, hedging, apology, lengthScore, laziness, disclaimer, selfRepetition };
}

// ── Main analysis ──

export interface AnalysisResult {
  score: number;
  /** True if a hard-trigger phrase fired (score=0.95 regardless of other signals). */
  hardTriggered: boolean;
  /** True if a positive-sentiment phrase was detected, halving the final score. */
  positiveDampened: boolean;
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
    aiLaziness: number;
    aiDisclaimer: number;
    aiSelfRepetition: number;
  };
}

export function analyzeSentiment(
  userMessages: string[],
  weights: SentimentSignalWeights = DEFAULT_WEIGHTS,
  aiSignals?: AIResponseSignals,
): AnalysisResult {
  const emptySignals = {
    profanity: 0, degradation: 0, imperatives: 0, caps: 0,
    brevity: 0, repetition: 0, escalation: 0,
    multiProfanity: 0, multiDegradation: 0,
    aiRefusal: 0, aiHedging: 0, aiApology: 0, aiLengthDrop: 0,
    aiLaziness: 0, aiDisclaimer: 0, aiSelfRepetition: 0,
  };

  if (!userMessages.length) {
    return { score: 0, hardTriggered: false, positiveDampened: false, signals: emptySignals };
  }

  const lastIdx = userMessages.length - 1;
  const lastMsg = userMessages[lastIdx]!;

  // Stage 1: Hard-trigger override — single high-confidence phrase pins to 0.95.
  // We still compute downstream signals so callers (logs, dashboard) see them.
  const hardTriggered = matchesHardTrigger(lastMsg);

  // Stage 2: Per-signal scoring (single-message)
  const signals = {
    profanity: keywordScore(lastMsg, PROFANITY_KEYWORDS),
    degradation: keywordScore(lastMsg, DEGRADATION_KEYWORDS),
    imperatives: keywordScore(lastMsg, IMPERATIVE_KEYWORDS),
    caps: capsRatioScore(lastMsg),
    brevity: brevityScore(userMessages, lastIdx),
    repetition: repetitionScore(userMessages),
    escalation: escalationScore(userMessages),
    multiProfanity: multiMessageScore(userMessages, PROFANITY_KEYWORDS, 3),
    multiDegradation: multiMessageScore(userMessages, DEGRADATION_KEYWORDS, 3),
    aiRefusal: aiSignals?.refusal ?? 0,
    aiHedging: aiSignals?.hedging ?? 0,
    aiApology: aiSignals?.apology ?? 0,
    aiLengthDrop: aiSignals?.lengthScore ?? 0,
    aiLaziness: aiSignals?.laziness ?? 0,
    aiDisclaimer: aiSignals?.disclaimer ?? 0,
    aiSelfRepetition: aiSignals?.selfRepetition ?? 0,
  };

  if (hardTriggered) {
    return {
      score: HARD_TRIGGER_SCORE,
      hardTriggered: true,
      positiveDampened: false,
      signals,
    };
  }

  // Stage 3: Decisive aggregation
  // - High-confidence signals (profanity, degradation) aggregate as MAX (not sum/avg)
  //   — one strong signal alone is enough.
  // - Noisy signals (imperatives, caps, brevity, repetition, escalation, AI signals)
  //   aggregate as weighted average so a sole match doesn't false-fire.
  // - Compound bonus when ≥2 categories fire — multiple kinds of evidence.

  const effectiveProfanity = Math.max(signals.profanity, signals.multiProfanity * 0.8);
  const effectiveDegradation = Math.max(signals.degradation, signals.multiDegradation * 0.8);

  // High-confidence path: scaled by their declared weights so users can still tune.
  const profComponent = effectiveProfanity * weights.profanity;
  const degComponent = effectiveDegradation * weights.degradation;
  const decisive = Math.max(profComponent, degComponent);

  // Noisy path: weighted average of remaining signals
  const noisyComponents: Array<[number, number]> = [
    [signals.imperatives, weights.imperatives],
    [signals.caps, weights.caps],
    [signals.brevity, weights.brevity],
    [signals.repetition, weights.repetition],
    [Math.min(1, signals.escalation), 0.5],
    [signals.aiRefusal, weights.aiRefusal],
    [signals.aiHedging, weights.aiHedging],
    [signals.aiApology, weights.aiApology],
    [signals.aiLengthDrop, weights.aiLengthDrop],
    [signals.aiLaziness, weights.aiLaziness],
    [signals.aiDisclaimer, weights.aiDisclaimer],
    [signals.aiSelfRepetition, weights.aiSelfRepetition],
  ];

  let noisyNum = 0;
  let noisyDen = 0;
  for (const [val, w] of noisyComponents) {
    if (val > 0) {
      noisyNum += val * w;
      noisyDen += w;
    }
  }
  const noisyAvg = noisyDen > 0 ? noisyNum / noisyDen : 0;

  // Compound bonus: multiple categories fire = stronger evidence than any single
  let activeCategories = 0;
  if (effectiveProfanity > 0.1) activeCategories++;
  if (effectiveDegradation > 0.1) activeCategories++;
  if (signals.imperatives > 0.1) activeCategories++;
  if (signals.repetition > 0.2) activeCategories++;
  if (signals.escalation > 0.1) activeCategories++;
  if (signals.aiRefusal > 0.1 || signals.aiLaziness > 0.2) activeCategories++;
  const compoundBonus = activeCategories >= 3 ? 0.2 : activeCategories >= 2 ? 0.1 : 0;

  let score = Math.max(decisive, noisyAvg) + compoundBonus;

  // Stage 4: Positive-sentiment dampening
  const positiveDampened = matchesPositive(lastMsg);
  if (positiveDampened) {
    score *= 0.5;
  }

  return {
    score: Math.min(1, Math.max(0, score)),
    hardTriggered: false,
    positiveDampened,
    signals,
  };
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
