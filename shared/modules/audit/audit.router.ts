import { AuditDetailRequest, AuditDetailResponse, AuditFileLogRequest, AuditFileLogResponse, AuditFileLogSetRequest, AuditListRequest, AuditListResponse, AuditTpsRequest, AuditTpsResponse } from "./audit.interface";

export const auditRoutes = {
    base: "/api",
    prefix: "/audit",
    list: { path: "/list", request: {} as AuditListRequest, response: {} as AuditListResponse },
    detail: { path: "/detail", request: {} as AuditDetailRequest, response: {} as AuditDetailResponse },
    tps: { path: "/tps", request: {} as AuditTpsRequest, response: {} as AuditTpsResponse },
    fileLog: { path: "/fileLog", request: {} as AuditFileLogRequest, response: {} as AuditFileLogResponse },
    setFileLog: { path: "/fileLog/set", request: {} as AuditFileLogSetRequest, response: {} as AuditFileLogResponse },
} as const;
