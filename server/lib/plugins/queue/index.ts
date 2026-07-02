import type { QueueDriver } from "./interface";
import { NullQueueDriver } from "./null";

export class Queue {
    private static _instance: QueueDriver;

    static instance(): QueueDriver {
        if (!this._instance) {
            // Always use NullQueueDriver for now (inline execution)
            this._instance = new NullQueueDriver();
        }
        return this._instance;
    }
}
