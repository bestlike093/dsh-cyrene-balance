/**
 * 外部服务的配置表单描述。
 *
 * 抄两处做法：
 *
 * - 宿主（Cyrene）是「设置 → 插件 → 填 Key」，字段少但每加一项都要改页面。
 * - AstrBot 是插件自带一份配置 schema，WebUI 照着渲染表单，插件不用画界面。
 *
 * 取后者：桌宠只描述「有哪些字段、什么类型、必填与否、怎么校验」，
 * 面板照着渲染就行。加一个服务时不碰 UI 代码。
 *
 * 密钥字段单独标成 `secret`，UI 应当用密码框并以掩码回显，
 * 不允许把明文写进日志或拼进错误信息。
 */
/**
 * 三个服务的表单。
 *
 * 刻意不写死任何服务商名字：换一家、走自建代理都只是改值，
 * 不需要改这份 schema。
 */
export const SERVICE_SCHEMAS = [
    {
        id: 'weather',
        title: '天气',
        description: '查实时天气。没填就不显示天气，其他功能不受影响。',
        fields: [
            {
                key: 'apiKey',
                label: '接口密钥',
                type: 'secret',
                required: true,
                description: '只保存在本机，不会上传。',
                placeholder: '粘贴密钥'
            },
            {
                key: 'endpoint',
                label: '接口地址',
                type: 'url',
                required: false,
                sensitive: true,
                description: '留空使用默认地址；换服务商或走自建代理时填这里。',
                placeholder: 'https://…'
            }
        ]
    },
    {
        id: 'exchangeRate',
        title: '汇率',
        description: '货币换算。没填就不提供换算。',
        fields: [
            {
                key: 'apiKey',
                label: '接口密钥',
                type: 'secret',
                required: true,
                placeholder: '粘贴密钥'
            },
            {
                key: 'endpoint',
                label: '接口地址',
                type: 'url',
                required: false,
                sensitive: true,
                placeholder: 'https://…'
            },
            {
                key: 'base',
                label: '基准货币',
                type: 'text',
                required: false,
                defaultValue: 'CNY',
                description: '三位货币代码，留空按 CNY。',
                placeholder: 'CNY'
            }
        ]
    },
    {
        id: 'translate',
        title: '翻译',
        description: '文本翻译。没填就不提供翻译。',
        fields: [
            {
                key: 'apiKey',
                label: '接口密钥',
                type: 'secret',
                required: true,
                placeholder: '粘贴密钥'
            },
            {
                key: 'endpoint',
                label: '接口地址',
                type: 'url',
                required: false,
                sensitive: true,
                placeholder: 'https://…'
            },
            {
                key: 'target',
                label: '默认目标语言',
                type: 'select',
                required: false,
                defaultValue: 'zh',
                description: '用户没指定时用这个。',
                options: [
                    { value: 'zh', label: '中文' },
                    { value: 'en', label: '英文' },
                    { value: 'ja', label: '日文' }
                ]
            },
            {
                key: 'cacheSeconds',
                label: '缓存秒数',
                type: 'number',
                required: false,
                defaultValue: 300,
                description: '同一句话在这段时间内重复翻译不再请求。',
                min: 0,
                max: 86_400
            }
        ]
    },
    {
        id: 'llm',
        title: '大模型',
        description: '填好这一项，桌宠才能开口说话。不填也能运行，只是不会回话。',
        fields: [
            {
                key: 'apiKey',
                label: '接口密钥',
                type: 'secret',
                required: true,
                description: '只保存在本机加密仓库，不会上传。',
                placeholder: '粘贴密钥'
            },
            {
                key: 'baseUrl',
                label: '接口地址',
                type: 'url',
                required: true,
                sensitive: true,
                description: '自己的网关、内网地址、反代或代理都填这里。会加密保存。',
                placeholder: 'https://…'
            },
            {
                key: 'model',
                label: '模型名',
                type: 'text',
                required: true,
                description: '服务商文档里给的那个名字，原样填。',
                placeholder: '模型标识'
            },
            {
                key: 'proxy',
                label: '代理地址',
                type: 'text',
                required: false,
                sensitive: true,
                description: '需要走代理时填。会加密保存。',
                placeholder: 'http://127.0.0.1:7890'
            },
            {
                key: 'temperature',
                label: '温度',
                type: 'number',
                required: false,
                defaultValue: 0.8,
                description: '低一些更稳，高一些更活。',
                min: 0,
                max: 2
            }
        ]
    },
    {
        id: 'bilibili',
        title: 'B 站账号',
        description: '要用点赞、评论、投币这些操作才需要填。Cookie 等于登录态，会加密保存。',
        fields: [
            {
                key: 'cookie',
                label: 'Cookie',
                type: 'secret',
                required: true,
                description: '从浏览器开发者工具里复制整条 Cookie。含 SESSDATA，等同于把这台设备的登录权限交出来。',
                placeholder: 'SESSDATA=…; bili_jct=…'
            },
            {
                key: 'csrf',
                label: 'CSRF 令牌',
                type: 'secret',
                required: false,
                description: '也就是 Cookie 里的 bili_jct。写操作要用它，单独填一次省得每次再解析。'
            },
            {
                key: 'uid',
                label: '账号 UID',
                type: 'text',
                required: false,
                sensitive: true,
                description: '数字 UID 能关联到具体账号，按隐私处理。'
            }
        ]
    },
    {
        id: 'game',
        title: '游戏账号',
        description: '日常排班和自动登录要用。账号、密码、设备标识都会加密保存。',
        fields: [
            {
                key: 'account',
                label: '账号',
                type: 'text',
                required: false,
                sensitive: true,
                description: '手机号或邮箱形式的账号按隐私处理。'
            },
            {
                key: 'password',
                label: '密码',
                type: 'secret',
                required: false,
                description: '只保存在本机加密仓库。不建议在共用电脑上填。'
            },
            {
                key: 'cookie',
                label: '登录 Cookie',
                type: 'secret',
                required: false,
                description: '有些客户端不认账号密码，只认登录态。'
            },
            {
                key: 'deviceId',
                label: '设备标识',
                type: 'text',
                required: false,
                sensitive: true,
                description: '设备指纹能把多台机器上的同一个账号串起来，按隐私处理。'
            },
            {
                key: 'server',
                label: '区服',
                type: 'text',
                required: false,
                description: '比如「官服」「B 服」。区服名本身不涉及隐私。'
            }
        ]
    }
];
/**
 * 校验一份表单值。
 *
 * 一次返回全部问题，面板能一次标完红字，不用让用户改一处试一次。
 * `secret` 字段的错误信息里不含值本身。
 */
export function validateValues(schema, values) {
    const errors = [];
    for (const field of schema.fields) {
        const value = values[field.key];
        if (field.type === 'switch')
            continue;
        const text = typeof value === 'string' ? value.trim() : value;
        if (field.required && isEmpty(text)) {
            errors.push({ key: field.key, message: `${field.label}不能为空` });
            continue;
        }
        if (isEmpty(text))
            continue;
        if (field.type === 'url' && !isHttpUrl(String(text))) {
            errors.push({ key: field.key, message: `${field.label}需要以 http:// 或 https:// 开头` });
        }
        if (field.type === 'number') {
            const num = Number(text);
            if (!Number.isFinite(num)) {
                errors.push({ key: field.key, message: `${field.label}需要是数字` });
            }
            else if (field.min !== undefined && num < field.min) {
                errors.push({ key: field.key, message: `${field.label}不能小于 ${field.min}` });
            }
            else if (field.max !== undefined && num > field.max) {
                errors.push({ key: field.key, message: `${field.label}不能大于 ${field.max}` });
            }
        }
        if (field.type === 'select' && field.options !== undefined) {
            const allowed = field.options.map((option) => option.value);
            if (!allowed.includes(String(text))) {
                errors.push({ key: field.key, message: `${field.label}不在可选范围内` });
            }
        }
    }
    return errors;
}
/**
 * 给 UI 用的渲染模型：字段顺序、当前值、错误都在一条里。
 *
 * 面板只管照着这个数组画控件，不用自己合并默认值或去对照错误。
 */
export function toFormModel(schema, values) {
    const errors = validateValues(schema, values);
    const errorMap = new Map(errors.map((error) => [error.key, error.message]));
    return schema.fields.map((field) => {
        const raw = values[field.key];
        const value = isEmpty(raw) ? field.defaultValue : raw;
        return {
            ...field,
            value,
            error: errorMap.get(field.key) ?? null
        };
    });
}
/** 这一项是否必须进加密仓库。 */
export function isSensitiveField(field) {
    return field.type === 'secret' || field.sensitive === true;
}
/** 需要加密的字段名，按 schema 顺序。 */
export function sensitiveKeys(schema) {
    return schema.fields.filter(isSensitiveField).map((field) => field.key);
}
/**
 * 把一份表单值拆成两半。
 *
 * 判断依据只来自 schema，调用方不需要自己认哪些算隐私。
 * 没填的字段不会出现在任何一半里——避免空串覆盖掉已存的值。
 */
export function splitForStorage(schema, values) {
    const secrets = {};
    const plain = {};
    for (const field of schema.fields) {
        const value = values[field.key];
        if (value === undefined || value === null)
            continue;
        if (isSensitiveField(field)) {
            if (typeof value === 'string' && value.trim().length > 0) {
                secrets[field.key] = value.trim();
            }
            continue;
        }
        plain[field.key] = value;
    }
    return { secrets, plain };
}
/**
 * 脱敏副本，给日志与错误信息用。
 *
 * 敏感项一律写成固定长度的星号串，长度也刻意不跟随原文，
 * 免得从日志里反推出密钥长度。非敏感项照常显示。
 */
export function redactValues(schema, values) {
    const result = {};
    for (const field of schema.fields) {
        const value = values[field.key];
        if (value === undefined || value === null)
            continue;
        result[field.key] = isSensitiveField(field) ? '********' : String(value);
    }
    return result;
}
/**
 * 按 schema 把敏感字段写进加密仓库。
 *
 * `clearKeys` 显式列出要清掉的字段——不传就不清，
 * 避免「用户只是没改这一项」被当成「要删掉」。
 */
export async function persistSecrets(writer, schema, values, clearKeys = []) {
    const split = splitForStorage(schema, values);
    const written = [];
    for (const [key, value] of Object.entries(split.secrets)) {
        await writer.set(schema.id, value, key);
        written.push(key);
    }
    const sensitive = new Set(sensitiveKeys(schema));
    const cleared = [];
    for (const key of clearKeys) {
        if (!sensitive.has(key))
            continue;
        await writer.clear(schema.id, key);
        cleared.push(key);
    }
    return { ...split, written, cleared };
}
function isEmpty(value) {
    if (value === undefined || value === null)
        return true;
    if (typeof value === 'string')
        return value.trim().length === 0;
    return false;
}
function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
}
