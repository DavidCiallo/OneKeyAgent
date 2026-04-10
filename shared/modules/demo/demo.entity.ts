import { BaseEntity } from "../../lib/default/base.entity";

export interface DemoEntity extends BaseEntity {
    name: string;
}

export class DemoDTO {
    public id: string;
    public name: string;
    public create_time: number;

    constructor(origin: DemoEntity) {
        this.id = origin.id;
        this.name = origin.name;
        this.create_time = origin.create_time;
    }
}
