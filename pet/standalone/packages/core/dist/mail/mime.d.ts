/**
 * 邮件内容的编码与解码。
 *
 * 只做「怎么把一封信拼成字节」和「怎么从字节里读回首部」，
 * 不管 SMTP 怎么连——那是宿主的事。
 *
 * 对应能力：`io.mail.send`、`io.mail.read`。
 */
export interface MailAddress {
    readonly address: string;
    readonly name?: string;
}
export interface MailAttachment {
    readonly filename: string;
    readonly contentType?: string;
    readonly data: Uint8Array;
}
export interface OutgoingMail {
    readonly from: MailAddress;
    readonly to: readonly MailAddress[];
    readonly cc?: readonly MailAddress[];
    readonly bcc?: readonly MailAddress[];
    readonly subject: string;
    readonly text?: string;
    readonly html?: string;
    readonly attachments?: readonly MailAttachment[];
    /** 生成时间，默认当前时间。测试可传入固定值。 */
    readonly date?: Date;
    /** 额外头，比如 `Reply-To`。 */
    readonly headers?: Readonly<Record<string, string>>;
}
export interface ParsedMail {
    readonly subject: string;
    readonly from: MailAddress | null;
    readonly to: readonly MailAddress[];
    readonly date: string | null;
    /** 所有头，键小写。重复头用数组。 */
    readonly headers: Readonly<Record<string, readonly string[]>>;
    /** 纯文本正文。取不到时为空串。 */
    readonly text: string;
    readonly html: string | null;
    readonly attachments: readonly ParsedAttachment[];
}
export interface ParsedAttachment {
    readonly filename: string;
    readonly contentType: string;
    readonly bytes: number;
}
/**
 * 拼一封信。
 *
 * 结构：
 * - 纯文本 → 直接是正文
 * - 纯文本 + HTML → multipart/alternative
 * - 有附件 → 外面再套 multipart/mixed
 */
export declare function buildMessage(mail: OutgoingMail): string;
/**
 * RFC 2047 编码：非 ASCII 走 base64。
 *
 * 纯 ASCII 原样返回，避免把普通英文主题也编码成看不懂的样子。
 */
export declare function encodeHeader(text: string): string;
export declare function formatAddress(address: MailAddress): string;
/**
 * 解析一封邮件。
 *
 * 目标是「读得懂内容」，不追求完整的 MIME 树。
 * 遇到嵌套 multipart 时递归，取第一个 text/plain 与 text/html。
 */
export declare function parseMessage(raw: string): ParsedMail;
/** 展开折行头，键统一小写，值保持原样。 */
export declare function parseHeaders(headText: string): Record<string, readonly string[]>;
/** 解 RFC 2047 编码。不支持时原样返回。 */
export declare function decodeHeader(value: string): string;
/** 每 76 字符折一行，符合 MIME 习惯。 */
export declare function wrapBase64(text: string, width?: number): string;
