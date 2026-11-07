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
/**
 * 解析 `mcpServers` 配置块。
 *
 * 支持 `{ "mcpServers": { ... } }` 和直接给 `{ ... }` 两种写法。
 * 坏掉的项进 `issues`，好的项照常返回——不让一条配置毁掉全部。
 */
export function parseServerConfig(input) {
    const servers = [];
    const issues = [];
    let raw = input;
    if (typeof input === 'string') {
        try {
            raw = JSON.parse(input);
        }
        catch {
            return {
                servers: [],
                issues: [{ serverId: '*', field: 'json', message: '配置不是合法的 JSON' }]
            };
        }
    }
    if (raw === null || typeof raw !== 'object') {
        return {
            servers: [],
            issues: [{ serverId: '*', field: 'root', message: '配置必须是一个对象' }]
        };
    }
    const container = raw;
    const table = (container.mcpServers ?? container);
    if (table === null || typeof table !== 'object' || Array.isArray(table)) {
        return {
            servers: [],
            issues: [{ serverId: '*', field: 'mcpServers', message: 'mcpServers 必须是对象' }]
        };
    }
    for (const [id, value] of Object.entries(table)) {
        const parsed = parseOne(id, value);
        if ('issue' in parsed) {
            issues.push(parsed.issue);
            continue;
        }
        servers.push(parsed.server);
    }
    return { servers, issues };
}
function parseOne(id, value) {
    if (id.trim().length === 0) {
        return { issue: { serverId: id, field: 'id', message: 'server 名不能为空' } };
    }
    if (value === null || typeof value !== 'object') {
        return { issue: { serverId: id, field: 'value', message: 'server 配置必须是对象' } };
    }
    const entry = value;
    const command = entry.command;
    if (typeof command !== 'string' || command.trim().length === 0) {
        return { issue: { serverId: id, field: 'command', message: '缺少可执行命令' } };
    }
    const args = entry.args ?? [];
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
        return { issue: { serverId: id, field: 'args', message: 'args 必须是字符串数组' } };
    }
    const env = {};
    if (entry.env !== undefined) {
        if (entry.env === null || typeof entry.env !== 'object' || Array.isArray(entry.env)) {
            return { issue: { serverId: id, field: 'env', message: 'env 必须是键值对象' } };
        }
        for (const [key, val] of Object.entries(entry.env)) {
            if (typeof val === 'string')
                env[key] = val;
        }
    }
    const cwd = typeof entry.cwd === 'string' ? entry.cwd : undefined;
    const enabled = entry.enabled === false ? false : true;
    return {
        server: {
            id: id.trim(),
            command: command.trim(),
            args: args,
            env,
            cwd,
            enabled
        }
    };
}
/**
 * 合并多个 server 的工具。
 *
 * 工具名统一成 `server__tool`，避免两个 server 都叫 `search` 时互相覆盖。
 * 名字里的非法字符换成下划线，方便模型调用。
 */
export function mergeTools(declarations) {
    const seen = new Set();
    const tools = [];
    const collisions = [];
    for (const list of declarations) {
        for (const decl of list) {
            const qualified = qualifyToolName(decl.serverId, decl.name);
            if (seen.has(qualified)) {
                collisions.push(qualified);
                continue;
            }
            seen.add(qualified);
            tools.push({
                serverId: decl.serverId,
                name: decl.name,
                qualifiedName: qualified,
                description: decl.description
            });
        }
    }
    return { tools, collisions };
}
/** `server__tool`，两端都做字符净化。 */
export function qualifyToolName(serverId, toolName) {
    const clean = (value) => value
        .trim()
        .replace(/[^A-Za-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    const server = clean(serverId) || 'server';
    const tool = clean(toolName) || 'tool';
    return `${server}__${tool}`;
}
/** 只留下启用的 server。 */
export function enabledServers(servers) {
    return servers.filter((server) => server.enabled);
}
