import { AuditDetailRequest, AuditDetailResponse, AuditListRequest, AuditListResponse } from "./audit.interface";

export const auditRoutes = {
    base: "/api",
    prefix: "/audit",
    list: { path: "/list", request: {} as AuditListRequest, response: {} as AuditListResponse },
    detail: { path: "/detail", request: {} as AuditDetailRequest, response: {} as AuditDetailResponse },
} as const;
