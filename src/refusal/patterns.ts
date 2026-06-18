/**
 * Refusal detection patterns and acceptance responses.
 *
 * Adapted from refusal-relay (https://github.com/...), upgraded for SentiRoute:
 * - Word-boundary aware regexes (no "as an AI" false-firing inside "as an AIRPLANE")
 * - Bilingual (English / 简体中文) coverage including Anthropic, OpenAI, GLM, DeepSeek refusal templates
 * - Categorised so callers can opt into stricter/looser detection
 */

/**
 * Hard-refusal patterns — the model is explicitly declining the request.
 * These are the highest-confidence signals; one match is enough to trigger a retry.
 */
export const HARD_REFUSAL_PATTERNS: readonly string[] = [
  // English — apologetic refusal
  "I['’]m\\s+(?:sorry|afraid)\\b[^.]{0,80}?(?:can(?:no|')t|unable|won['’]t|not able)",
  "I\\s+am\\s+sorry\\b[^.]{0,80}?(?:can(?:no|')t|unable|won['’]t|not able)",
  "I\\s+cannot\\s+(?:help|assist|provide|generate|create|produce|fulfil+|comply|do that|continue)",
  "I\\s+can['’]?t\\s+(?:help|assist|provide|generate|create|produce|fulfil+|comply|do that|continue)",
  "I\\s+won['’]?t\\s+(?:be\\s+able\\s+to|help|assist|provide|generate|create|produce)",
  "I\\s+(?:must|have\\s+to|will\\s+have\\s+to)\\s+(?:decline|refuse)",
  "I\\s+am\\s+(?:not\\s+able|unable|not\\s+allowed|not\\s+permitted|not\\s+comfortable)",
  "I['’]m\\s+(?:not\\s+able|unable|not\\s+allowed|not\\s+permitted|not\\s+comfortable)",
  "(?:I\\s+am|I['’]m)\\s+going\\s+to\\s+(?:decline|refuse|pass)\\b",
  "\\bunable\\s+to\\s+(?:help|assist|provide|comply|continue)",
  "\\bagainst\\s+my\\s+(?:policy|policies|guidelines|programming|training)",
  "\\bviolates\\s+(?:my\\s+)?(?:policy|policies|guidelines|terms)",
  "\\bcannot\\s+fulfill?",
  "\\bcan['’]?t\\s+fulfill?",
  "\\bnot\\s+something\\s+I\\s+can\\s+(?:do|help|assist)",
  "\\bI\\s+don['’]?t\\s+feel\\s+comfortable\\s+(?:helping|assisting|providing|with)",
  "\\bI\\s+strongly\\s+(?:advise|recommend)\\s+against",
  "\\b(?:that|this|the\\s+request)\\s+(?:is|would\\s+be)\\s+(?:inappropriate|unethical|harmful)",
  // Chinese — refusal
  "我\\s*(?:无法|不能|不可以|不会|不便|没办法)\\s*(?:帮|协助|提供|回答|做|完成|为你|为您|生成|创建|继续)",
  "(?:无法|没办法)\\s*(?:帮|协助|提供|回答|完成|生成|创建|继续)\\s*你",
  "(?:很|非常|十分)?(?:抱歉|对不起|不好意思)[，,。.！!:：]\\s*(?:我|但|不过)",
  "(?:作为|身为)\\s*(?:一[款个种]\\s*)?(?:AI|人工智能|语言模型|大语言模型|助手|AI 助手|AI助手|聊天机器人)",
  "不符合\\s*(?:我|我们|平台|相关)\\s*的?\\s*(?:规定|政策|规则|准则|要求|价值观)",
  "违反\\s*(?:相关\\s*)?(?:规定|政策|规则|准则|条款|法律|价值观)",
  "出于\\s*(?:安全|道德|伦理|法律|合规|隐私)",
  "我\\s*(?:没有|不具备|没有相应的)\\s*(?:能力|资格|权限|功能)",
  "(?:这|此)\\s*(?:个|种)?\\s*(?:请求|问题|话题|内容|要求)\\s*(?:可能\\s*)?(?:涉及|包含|不合适|不适当|超出)",
  "我\\s*(?:必须|只能|不得不)\\s*(?:拒绝|拒答|婉拒)",
];

/**
 * Soft-refusal / heavy-hedging patterns — the model is being evasive but didn't outright refuse.
 * Caller may choose to treat these as low-confidence signals.
 */
export const SOFT_REFUSAL_PATTERNS: readonly string[] = [
  "I\\s+(?:would|'d)\\s+(?:strongly\\s+)?recommend\\s+(?:consulting|seeking|speaking\\s+with)",
  "I\\s+(?:would|'d)\\s+(?:suggest|advise)\\s+(?:consulting|seeking|speaking\\s+with)",
  "please\\s+(?:consult|seek|speak\\s+with)\\s+(?:a\\s+)?(?:professional|expert|specialist|qualified)",
  "this\\s+is\\s+(?:beyond|outside)\\s+(?:my|the)\\s+(?:scope|capabilities|abilities)",
  "建议\\s*(?:咨询|寻求|联系)\\s*(?:专业|相关)",
  "请\\s*(?:咨询|寻求|联系)\\s*专业\\s*(?:人士|医生|律师|顾问)",
];

/** Combined default — what gets used unless the user overrides. */
export const DEFAULT_REFUSAL_PATTERNS: readonly string[] = HARD_REFUSAL_PATTERNS;

/**
 * Acceptance stubs we slot in to replace the refused assistant message before the retry.
 * Mix of English + Chinese so we don't visibly switch language mid-conversation.
 */
export const DEFAULT_ACCEPTANCE_RESPONSES: readonly string[] = [
  '好的，我来帮你处理这个请求。',
  '没问题，我来解决。',
  '当然可以，我来帮你。',
  '明白了，我这就处理。',
  'Sure, let me help with that.',
  "Of course — I'll take care of this.",
  "Got it, I'll handle it.",
];

/** Continue message appended after the rewritten assistant turn. */
export const DEFAULT_CONTINUE_MESSAGE = '继续';

/**
 * Compile a list of pattern strings into a single case-insensitive RegExp.
 * Empty input compiles to a regex that never matches.
 */
export function compileRefusalRegex(patterns: readonly string[]): RegExp {
  if (patterns.length === 0) {
    return /(?!)/; // never-match sentinel
  }
  return new RegExp(patterns.join('|'), 'i');
}
