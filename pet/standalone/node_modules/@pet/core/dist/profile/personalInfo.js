/**
 * 个人信息。
 *
 * 真名、邮箱、电话、住址这些一旦落到普通配置文件里，
 * 就等于散落在磁盘上。这一层把它们整组送进加密仓库，
 * 明文配置里一个字段都不留。
 *
 * 和 `net/serviceSchema` 共用 `SecretWriter`，但目录固定为 `profile`，
 * 不和外部服务的 key 混在一起。
 *
 * 对应能力：`io.file.write` 之外的所有「需要知道你是谁」的调用。
 */
/**
 * 全部字段都算隐私，没有例外。
 *
 * `idNumber` 单独列出来是因为它最敏感：一旦泄露，
 * 能做的事情比手机号多得多。默认不填。
 */
export const PERSONAL_FIELDS = [
    {
        key: 'realName',
        label: '真名',
        required: false,
        description: '填了之后桌宠在正式场合会这样称呼你。只存在本机加密仓库。'
    },
    {
        key: 'email',
        label: '邮箱',
        required: false,
        description: '收验证码、收自己发的邮件时用。',
        placeholder: 'name@example.com'
    },
    {
        key: 'phone',
        label: '电话',
        required: false,
        description: '只用于账号相关的一次性场景，不会被拿去做别的事。',
        placeholder: '11 位手机号'
    },
    {
        key: 'address',
        label: '收件地址',
        required: false,
        description: '填了就默认寄到这里。含门牌号，按最高一档处理。'
    },
    {
        key: 'birthday',
        label: '生日',
        required: false,
        description: '用来算日子，比如提前一天提醒你。',
        placeholder: 'YYYY-MM-DD'
    },
    {
        key: 'idNumber',
        label: '证件号码',
        required: false,
        description: '能不填就不填。真要填时也只进加密仓库，界面永远只回显掩码。'
    }
];
const FIELD_KEYS = new Set(PERSONAL_FIELDS.map((field) => field.key));
/**
 * 拆分个人信息。
 *
 * 返回的 `plain` 恒为空，调用方不用再判断哪些能写进配置文件——
 * 一律不许写。
 */
export function splitPersonal(values) {
    const secrets = {};
    for (const field of PERSONAL_FIELDS) {
        const value = values[field.key];
        if (typeof value !== 'string')
            continue;
        const trimmed = value.trim();
        if (trimmed.length === 0)
            continue;
        secrets[field.key] = trimmed;
    }
    return { secrets, plain: {} };
}
/**
 * 日志与错误信息用的脱敏副本。
 *
 * 邮箱和电话保留一点点结构，方便用户确认「填的是不是这一条」，
 * 其余一律整段打码。
 */
export function redactPersonal(values) {
    const result = {};
    for (const field of PERSONAL_FIELDS) {
        const value = values[field.key];
        if (typeof value !== 'string')
            continue;
        const trimmed = value.trim();
        if (trimmed.length === 0)
            continue;
        result[field.key] = maskByKind(field.key, trimmed);
    }
    return result;
}
function maskByKind(key, value) {
    if (key === 'email') {
        const at = value.indexOf('@');
        if (at <= 0)
            return '********';
        const head = value.slice(0, 1);
        const domain = value.slice(at);
        return `${head}***${domain}`;
    }
    if (key === 'phone' && value.length >= 7) {
        return `${value.slice(0, 3)}****${value.slice(-4)}`;
    }
    return '********';
}
/** 加密仓库里这一组数据用的目录名。 */
export const PERSONAL_SCOPE = 'profile';
/**
 * 写入加密仓库。
 *
 * `clearKeys` 显式列出要删掉的字段，不传就什么都不删。
 */
export async function persistPersonal(writer, values, clearKeys = []) {
    const split = splitPersonal(values);
    const written = [];
    for (const [key, value] of Object.entries(split.secrets)) {
        await writer.set(PERSONAL_SCOPE, value, key);
        written.push(key);
    }
    const cleared = [];
    for (const key of clearKeys) {
        if (!FIELD_KEYS.has(key))
            continue;
        await writer.clear(PERSONAL_SCOPE, key);
        cleared.push(key);
    }
    return { ...split, written, cleared };
}
/** 校验：邮箱和电话做最基本的形状检查，不追求覆盖所有写法。 */
export function validatePersonal(values) {
    const errors = [];
    const email = values.email;
    if (typeof email === 'string' && email.trim().length > 0) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            errors.push('邮箱格式看起来不太对');
        }
    }
    const phone = values.phone;
    if (typeof phone === 'string' && phone.trim().length > 0) {
        if (!/^\d{6,15}$/.test(phone.trim().replace(/[\s-]/g, ''))) {
            errors.push('电话只填数字，6 到 15 位');
        }
    }
    const birthday = values.birthday;
    if (typeof birthday === 'string' && birthday.trim().length > 0) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday.trim())) {
            errors.push('生日按 YYYY-MM-DD 填');
        }
    }
    return errors;
}
