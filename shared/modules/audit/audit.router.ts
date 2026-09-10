import { AuditListRequest, AuditListResponse } from "./audit.interface";

export const auditRoutes = {
    base: "/api",
    prefix: "/audit",
    list: { path: "/list", request: {} as AuditListRequest, response: {} as AuditListResponse },
} as const;
