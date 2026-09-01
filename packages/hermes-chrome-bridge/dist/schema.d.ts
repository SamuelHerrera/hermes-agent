export declare const CHROME_BRIDGE_TOOLS: readonly [{
    readonly description: "Report whether the local Hermes Chrome bridge is connected.";
    readonly inputSchema: {
        readonly additionalProperties: false;
        readonly properties: {};
        readonly type: "object";
    };
    readonly name: "chrome_bridge_status";
}, {
    readonly description: "List tabs exposed by the local Hermes Chrome bridge.";
    readonly inputSchema: {
        readonly additionalProperties: false;
        readonly properties: {};
        readonly type: "object";
    };
    readonly name: "chrome_bridge_tabs";
}, {
    readonly description: "Capture an accessibility snapshot from the active Chrome tab.";
    readonly inputSchema: {
        readonly additionalProperties: false;
        readonly properties: {};
        readonly type: "object";
    };
    readonly name: "chrome_bridge_snapshot";
}];
