/**
 * LLM provider 抽象：装配只依赖这一层，真机后端只是最后一块替换件。
 *
 * 超时走真的 AbortController：外层放弃 Promise 时连接仍在，配额会被白占；
 * 这里在超时点 abort，FallbackChain 的 catch 再退预扣令牌。
 */
import type { DailyBudgetGate } from './dailyBudget.js';
import type { LlmAdapter } from './fallbackChain.js';
export interface LlmProviderRequest {
    readonly prompt: string;
    readonly signal: AbortSignal;
}
export interface LlmProviderUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
}
export interface LlmProviderResponse {
    readonly text: string;
    readonly model: string;
    readonly promptVersion: string;
    /** usage 是尽力而为：宿主可能一次都不发 usage chunk。 */
    readonly usage?: LlmProviderUsage;
}
export interface ILLMProvider {
    readonly id: string;
    generate(request: LlmProviderRequest): Promise<LlmProviderResponse>;
}
export declare class LlmTimeoutError extends Error {
    readonly timeoutMs: number;
    readonly code = "LLM_TIMEOUT";
    constructor(timeoutMs: number);
}
/** 每日额度耗尽时抛出：调用方不该重试，重试也不会放行。 */
export declare class LlmBudgetExceededError extends Error {
    readonly used: number;
    readonly limit: number;
    readonly code = "LLM_BUDGET_EXCEEDED";
    constructor(used: number, limit: number);
}
export interface MockLlmProviderOptions {
    readonly mode?: 'ok' | 'throw' | 'hang';
    readonly text?: string;
    readonly model?: string;
    readonly promptVersion?: string;
    readonly usage?: LlmProviderUsage;
}
/** mock 覆盖除真实网络往返外的全部链路；真机替换时不需要改上层。 */
export declare class MockLlmProvider implements ILLMProvider {
    readonly id = "mock";
    calls: number;
    aborted: boolean;
    lastSignal: AbortSignal | undefined;
    private readonly mode;
    private readonly text;
    private readonly model;
    private readonly promptVersion;
    private readonly usage;
    constructor(options?: MockLlmProviderOptions);
    generate(request: LlmProviderRequest): Promise<LlmProviderResponse>;
}
export interface TimeoutAdapterOptions {
    /**
     * 传入后，每次调用都会过每日额度闸门：
     * 调用前预检、成功后按真实用量结算。不传则完全不参与。
     */
    readonly budget?: DailyBudgetGate;
    /** 单次请求的预估 token，用于调用前预检；缺省按 input.text 长度估算。 */
    readonly estimateTokens?: number;
}
/** 把 ILLMProvider 包成 FallbackChain 认识的 LlmAdapter，并在超时点真 abort。 */
export declare function createTimeoutLlmAdapter(provider: ILLMProvider, timeoutMs: number, options?: TimeoutAdapterOptions): LlmAdapter;
