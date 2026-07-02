/** Repository driver interface — pluggable persistence backend */
export interface RepositoryDriver {
    find(collection: string, where?: Record<string, any>, config?: { limit?: number; offset?: number; since?: number }): Promise<Record<string, any>[]>;
    findEach(collection: string, where: Record<string, any>, callback: (row: Record<string, any>) => void, config?: { limit?: number; since?: number }): Promise<number>;
    sum(collection: string, field: string, where?: Record<string, any>, since?: number): Promise<number>;
    findOne(collection: string, where: Record<string, any>, reverse?: boolean): Promise<Record<string, any> | null>;
    findIgnoreDelete(collection: string, where: Record<string, any>): Promise<Record<string, any> | null>;
    findAllIgnoreDelete(collection: string): Promise<Record<string, any>[]>;
    findByIds(collection: string, ids: string[]): Promise<Record<string, any>[]>;
    findAllIgnoreDeleteBatch(collection: string, batchSize?: number): AsyncGenerator<Record<string, any>[], void, void>;
    insert(collection: string, entity: Record<string, any>): Promise<Record<string, any>>;
    update(collection: string, where: Record<string, any>, updateData: Record<string, any>, includeDeleted?: boolean): Promise<boolean>;
    delete(collection: string, where: Record<string, any>): Promise<boolean>;
    truncate(collection: string): Promise<void>;
    hardDelete(collection: string, where: Record<string, any>): Promise<boolean>;
    atomicPatch(collection: string, where: Record<string, any>, patch: (row: Record<string, any> | null) => Record<string, any> | null, includeDeleted?: boolean): Promise<boolean>;
    batchInsert(collection: string, entities: Record<string, any>[]): Promise<number>;
    count(collection: string, where?: Record<string, any>, since?: number): Promise<number>;
}
