import { AuditDetailRequest, AuditDetailResponse, AuditListRequest, AuditListResponse, AuditTpsRequest, AuditTpsResponse } from "./audit.interface";

export const auditRoutes = {
    base: "/api",
    prefix: "/audit",
    list: { path: "/list", request: {} as AuditListRequest, response: {} as AuditListResponse },
    detail: { path: "/detail", request: {} as AuditDetailRequest, response: {} as AuditDetailResponse },
    tps: { path: "/tps", request: {} as AuditTpsRequest, response: {} as AuditTpsResponse },
} as const;
