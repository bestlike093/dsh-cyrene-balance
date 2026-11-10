/**
 * 表现层三端口的 NOT_IMPLEMENTED 桩（S7-a）。
 *
 * 文档 10.1b：未实现的一律显式抛错，禁止静默返回空或默认值。
 * 任何针对这些桩的契约测试都应在构造上 FAIL —— 这个 FAIL 是「无人实现」的可见状态，
 * 不要为了让测试变绿而给它加默认返回。
 */
import { ErrorCode, PetError } from '@pet/shared';
function notImplemented(port, method) {
    throw new PetError(ErrorCode.NOT_IMPLEMENTED, `${port}.${method} 尚未实现`, {
        details: { port, method }
    });
}
/** 三端口共同的桩行为；子类只提供端口名与特有成员。 */
class PresentationPortStub {
    validate(_value) {
        return notImplemented(this.portName, 'validate');
    }
    async publish(_patch) {
        notImplemented(this.portName, 'publish');
    }
    async apply(_value) {
        notImplemented(this.portName, 'apply');
    }
    async register(_value) {
        notImplemented(this.portName, 'register');
    }
    async unregister(_id) {
        notImplemented(this.portName, 'unregister');
    }
    list() {
        return notImplemented(this.portName, 'list');
    }
    current() {
        return notImplemented(this.portName, 'current');
    }
    async broadcast() {
        notImplemented(this.portName, 'broadcast');
    }
    describeTokens() {
        return notImplemented(this.portName, 'describeTokens');
    }
}
export class NotImplementedThemePort extends PresentationPortStub {
    portName = 'IThemePortV1';
}
export class NotImplementedStylePort extends PresentationPortStub {
    portName = 'IStylePortV1';
}
export class NotImplementedFontPort extends PresentationPortStub {
    portName = 'IFontPortV1';
    resolve(_family, _weight) {
        return notImplemented(this.portName, 'resolve');
    }
}
