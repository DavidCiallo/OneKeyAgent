import type { EmailDriver } from "./interface";

export class NullDriver implements EmailDriver {
    async send(_params: { to: string; subject: string; html: string }): Promise<boolean> {
        return true;
    }
}
