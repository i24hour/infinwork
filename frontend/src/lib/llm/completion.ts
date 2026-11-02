import OpenAI from 'openai';
import { getLlmConfig } from './config';

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LlmCompletionOptions {
    messages: LlmMessage[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    /** Soft JSON-mode hint; providers may ignore. */
    json?: boolean;
}

export interface LlmCompletionResult {
    content: string;
    model: string;
    provider: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
}

/**
 * Unified chat completion — LiteLLM-style entrypoint.
 * Swap models via LLM_MODEL / LITELLM_BASE_URL without changing call sites.
 */
export async function llmCompletion(
    options: LlmCompletionOptions
): Promise<LlmCompletionResult> {
    const config = getLlmConfig();
    if (!config.enabled) {
        throw new Error(
            'LLM is not configured. Set AWS_BEARER_TOKEN_BEDROCK (or LITELLM_API_KEY + LITELLM_BASE_URL).'
        );
    }

    const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: config.timeoutMs,
        // Classification falls back to keywords; don't burn the batch
        // timeout retrying a failing LLM.
        maxRetries: 0,
    });

    const model = options.model || config.model;

    const response = await client.chat.completions.create({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 400,
        ...(options.json
            ? {
                  // Best-effort; Mantle/LiteLLM may honor OpenAI json_object.
                  response_format: { type: 'json_object' as const },
              }
            : {}),
    });

    const content = response.choices?.[0]?.message?.content?.trim() || '';
    if (!content) {
        throw new Error(`Empty LLM response from model ${model}`);
    }

    return {
        content,
        model: response.model || model,
        provider: config.mode,
        usage: {
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
            totalTokens: response.usage?.total_tokens,
        },
    };
}
