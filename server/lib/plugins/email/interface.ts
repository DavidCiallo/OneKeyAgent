/** Email driver interface — pluggable email sending infrastructure */
export interface EmailDriver {
    send(params: { to: string; subject: string; html: string }): Promise<boolean>;
}
