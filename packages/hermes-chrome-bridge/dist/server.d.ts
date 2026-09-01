#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
export interface ChromeBridgeRequest {
    arguments: Record<string, unknown>;
    method: 'snapshot' | 'status' | 'tabs';
}
export interface ChromeBridgeRequestRouter {
    route(request: ChromeBridgeRequest): Promise<unknown>;
}
export declare function createChromeBridgeServer(router?: ChromeBridgeRequestRouter): Server;
export declare function runStdioServer(): Promise<void>;
