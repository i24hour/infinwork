/**
 * LiteLLM-compatible LLM config.
 *
 * Default: AWS Bedrock Mantle (OpenAI-compatible) with Kimi K2.5.
 * Optional: point LITELLM_BASE_URL at a LiteLLM proxy to route multiple models.
 */
export type LlmProviderMode = 'bedrock_mantle' | 'litellm_proxy';

export interface LlmConfig {
    enabled: boolean;
    mode: LlmProviderMode;
    /** OpenAI-compatible API key (Bedrock bearer token or LiteLLM proxy key). */
    apiKey: string;
    /** OpenAI-compatible base URL. */
    baseURL: string;
    /**
     * Model id sent to the API.
     * Bedrock Mantle: moonshotai.kimi-k2.5
     * LiteLLM proxy may accept aliases like kimi-k2.5
     */
    model: string;
    region: string;
    timeoutMs: number;
}

export function getLlmConfig(): LlmConfig {
    const region =
        process.env.AWS_REGION_NAME ||
        process.env.AWS_REGION ||
        process.env.BEDROCK_REGION ||
        'us-east-1';

    const proxyBase = (process.env.LITELLM_BASE_URL || '').trim().replace(/\/$/, '');
    const mode: LlmProviderMode = proxyBase ? 'litellm_proxy' : 'bedrock_mantle';

    const apiKey = (
        mode === 'litellm_proxy'
            ? (process.env.LITELLM_API_KEY ||
                process.env.AWS_BEARER_TOKEN_BEDROCK ||
                process.env.BEDROCK_API_KEY)
            : (process.env.AWS_BEARER_TOKEN_BEDROCK ||
                process.env.LITELLM_API_KEY ||
                process.env.BEDROCK_API_KEY)
    )?.trim() || '';

    const baseURL =
        proxyBase ||
        (process.env.BEDROCK_MANTLE_BASE_URL || '').trim().replace(/\/$/, '') ||
        `https://bedrock-mantle.${region}.api.aws/v1`;

    const model = (
        process.env.LLM_MODEL ||
        process.env.BEDROCK_MODEL_ID ||
        'moonshotai.kimi-k2.5'
    ).trim();

    const timeoutMs = Math.max(
        5000,
        Number(process.env.LLM_TIMEOUT_MS || 45000) || 45000
    );

    return {
        enabled: Boolean(apiKey),
        mode,
        apiKey,
        baseURL,
        model,
        region,
        timeoutMs,
    };
}

export function isLlmConfigured(): boolean {
    return getLlmConfig().enabled;
}
