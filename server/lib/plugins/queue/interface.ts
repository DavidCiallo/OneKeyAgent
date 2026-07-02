/** Queue driver interface — pluggable task queue infrastructure */
export interface QueueDriver {
    /** Submit a task to be executed. Returns true if accepted. */
    submit(queue: string, payload: any): Promise<boolean>;
}
