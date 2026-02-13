"use strict";
/**
 * Transport Layer — DirectTransport only (no proxy mode)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectTransport = exports.Transport = void 0;
class Transport {
}
exports.Transport = Transport;
class DirectTransport extends Transport {
    server;
    constructor(extensionServer) {
        super();
        this.server = extensionServer;
    }
    async sendCommand(method, params, timeout) {
        return await this.server.sendCmd(method, params, timeout);
    }
    async close() {
        // Server cleanup handled by Backend
    }
}
exports.DirectTransport = DirectTransport;
//# sourceMappingURL=transport.js.map