/**
 * 外部服务的接入接口。
 *
 * 原则：不内置任何服务商与密钥。桌宠发出去给别人用，写死一家、
 * 或者带一个默认 key，都会变成「作者替使用者做了决定」——既不合适，
 * 也让换服务变成改代码。
 *
 * 所以这里只定义三样东西：
 *
 * 1. 用户要填什么（`ServiceCredential`）
 * 2. 没填时怎么报（`resolveService` 返回缺哪几项，而不是抛一个模糊错误）
 * 3. 填了之后怎么跑（`defineService` 把请求拼装、解析、缓存串起来）
 *
 * 具体请求长什么样由调用方定义，core 不猜接口格式。
 */
import { type FetchLike, type HttpJsonOptions } from './httpJson.js';
import { TtlCache } from './ttlCache.js';
export type ServiceId = 'weather' | 'exchangeRate' | 'translate' | 'llm';
export declare const SERVICE_IDS: readonly ServiceId[];
/**
 * 用户填的凭据。
 *
 * `endpoint` 可选：多数服务有固定地址，留空就用 `ServiceDefinition.endpoint`。
 * 自建代理或换服务商时填这里，不用改代码。
 *
 * `baseUrl` / `proxy` 与大模型相关：这两个也是最容易被写进日志的东西，
 * 落盘前必须先过 `serviceSchema` 的 `splitForStorage`，交给加密仓库。
 */
export interface ServiceCredential {
    readonly apiKey?: string;
    readonly endpoint?: string;
    /** 大模型接口地址。与 `endpoint` 同义，单独列出来是因为字段名不同。 */
    readonly baseUrl?: string;
    /** 大模型标识。 */
    readonly model?: string;
    /** 代理地址，含 IP。 */
    readonly proxy?: string;
    /** 有些服务要额外的账号或区域参数，键值对留着给它们用。 */
    readonly extras?: Readonly<Record<string, string>>;
}
export type ExternalServiceConfig = Readonly<Partial<Record<ServiceId, ServiceCredential>>>;
export type MissingField = 'apiKey' | 'endpoint' | 'model';
export interface ServiceStatus {
    readonly id: ServiceId;
    readonly configured: boolean;
    /** 缺哪些项。`configured=false` 时至少有一项。 */
    readonly missing: readonly MissingField[];
}
/**
 * 判断某个服务能不能用。
 *
 * 两项都缺时按「还差什么」的顺序列出来，让人一次填完，
 * 避免填了 key 之后再被告诉「还缺地址」。
 */
export declare function resolveService(config: ExternalServiceConfig, id: ServiceId, definition?: Pick<ServiceDefinition<unknown, unknown>, 'endpoint'>): ServiceStatus;
/** 一次报出所有服务的状态，面板可以照着标红字。 */
export declare function resolveAll(config: ExternalServiceConfig, definitions?: Readonly<Partial<Record<ServiceId, ServiceDefinition<unknown, unknown>>>>): readonly ServiceStatus[];
export interface ServiceRequest {
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
}
/**
 * 一个外部服务的定义。
 *
 * 泛型是「输入」和「输出」，中间怎么拼 URL、怎么读响应，都由定义方决定。
 * core 只负责按缓存策略调用、按统一格式报错。
 */
export interface ServiceDefinition<In, Out> {
    readonly id: string;
    /** 用户没填 endpoint 时用这个。 */
    readonly endpoint: string;
    /** 缓存多久。高频查询服务可以给大一些。 */
    readonly ttlMs: number;
    readonly buildRequest: (input: In, credential: Required<Pick<ServiceCredential, 'apiKey'>> & ServiceCredential) => ServiceRequest;
    readonly parse: (raw: unknown) => Out;
}
export interface ServiceRunnerOptions {
    readonly fetchImpl: FetchLike;
    readonly cache?: TtlCache<unknown>;
    readonly now?: () => number;
    readonly http?: HttpJsonOptions;
}
export declare class ServiceNotConfiguredError extends Error {
    readonly id: ServiceId;
    readonly missing: readonly MissingField[];
    constructor(id: ServiceId, missing: readonly MissingField[]);
}
/**
 * 把定义和配置绑成一个可调用的东西。
 *
 * 没配置时返回 `null` 而不是抛错——调用方据此在面板上提示用户去填，
 * 而不是在业务逻辑里到处 try/catch。
 */
export declare function createServiceRunner<In, Out>(definition: ServiceDefinition<In, Out>, config: ExternalServiceConfig, options: ServiceRunnerOptions): ((input: In) => Promise<Out>) | null;
