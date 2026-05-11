import { anthropicToOpenAI } from './request/anthropic-to-openai.js';
import { openaiToAnthropic } from './request/openai-to-anthropic.js';
import {
  translateAnthropicToOpenAIResponse,
  translateAnthropicToOpenAIStream,
} from './response/anthropic-to-openai.js';
import {
  translateOpenAIToAnthropicResponse,
  translateOpenAIToAnthropicStream,
} from './response/openai-to-anthropic.js';
import type { AnthropicRequest, OpenAIRequest, AnthropicResponse, OpenAIResponse } from './types.js';

export interface Translator {
  translateRequest(body: Record<string, unknown>, upstreamModel: string): Record<string, unknown>;
  translateResponse(body: string, upstreamModel: string): string;
  translateStream(
    stream: ReadableStream<Uint8Array>,
    upstreamModel: string,
  ): ReadableStream<Uint8Array>;
}

export function getTranslator(
  clientFormat: 'anthropic' | 'openai',
  upstreamFormat: 'anthropic' | 'openai',
): Translator | null {
  if (clientFormat === upstreamFormat) return null;

  if (clientFormat === 'anthropic' && upstreamFormat === 'openai') {
    return {
      translateRequest(body, model) {
        return anthropicToOpenAI(body as unknown as AnthropicRequest, model) as unknown as Record<string, unknown>;
      },
      translateResponse(body, model) {
        const parsed = JSON.parse(body) as AnthropicResponse;
        return JSON.stringify(translateAnthropicToOpenAIResponse(parsed, model));
      },
      translateStream: translateAnthropicToOpenAIStream,
    };
  }

  // clientFormat === 'openai' && upstreamFormat === 'anthropic'
  return {
    translateRequest(body, model) {
      return openaiToAnthropic(body as unknown as OpenAIRequest, model) as unknown as Record<string, unknown>;
    },
    translateResponse(body, model) {
      const parsed = JSON.parse(body) as OpenAIResponse;
      return JSON.stringify(translateOpenAIToAnthropicResponse(parsed, model));
    },
    translateStream: translateOpenAIToAnthropicStream,
  };
}
