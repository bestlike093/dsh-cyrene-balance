/**
 * MCP server 配置与工具清单。
 *
 * 这里不启动进程，只做两件容易出错的事：
 *
 * 1. 校验用户贴进来的配置，别等到 spawn 才报错
 * 2. 把多个 server 的工具合并成一张表，同名工具加命名空间
 *
 * 对应能力：`agent.mcp`。
 */
export interface McpServerConfig {
    readonly id: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    readonly cwd?: string;
    readonly enabled: boolean;
}
export interface McpConfigIssue {
    readonly serverId: string;
    readonly field: string;
    readonly message: string;
}
export interface ParseResult {
    readonly servers: readonly McpServerConfig[];
    readonly issues: readonly McpConfigIssue[];
}
/**
 * 解析 `mcpServers` 配置块。
 *
 * 支持 `{ "mcpServers": { ... } }` 和直接给 `{ ... }` 两种写法。
 * 坏掉的项进 `issues`，好的项照常返回——不让一条配置毁掉全部。
 */
export declare function parseServerConfig(input: string | object): ParseResult;
export interface McpToolRef {
    readonly serverId: string;
    readonly name: string;
    readonly qualifiedName: string;
    readonly description?: string;
}
export interface McpToolDecl {
    readonly serverId: string;
    readonly name: string;
    readonly description?: string;
}
export interface MergeResult {
    readonly tools: readonly McpToolRef[];
    /** 同一个 server 里重名的工具，只保留第一个。 */
    readonly collisions: readonly string[];
}
/**
 * 合并多个 server 的工具。
 *
 * 工具名统一成 `server__tool`，避免两个 server 都叫 `search` 时互相覆盖。
 * 名字里的非法字符换成下划线，方便模型调用。
 */
export declare function mergeTools(declarations: readonly (readonly McpToolDecl[])[]): MergeResult;
/** `server__tool`，两端都做字符净化。 */
export declare function qualifyToolName(serverId: string, toolName: string): string;
/** 只留下启用的 server。 */
export declare function enabledServers(servers: readonly McpServerConfig[]): readonly McpServerConfig[];
