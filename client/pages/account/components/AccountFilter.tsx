import { Input, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { isAdmin } from "../../../methods/auth";
import { AccountRouter } from "../../../api/instance";

type Props = {
    filterName: string;
    filterEmail: string;
    onNameChange: (v: string) => void;
    onEmailChange: (v: string) => void;
    onAdd: () => void;
};

async function handleExport() {
    const token = localStorage.getItem("access_token") || "";
    try {
        const res = await AccountRouter.export({ auth: token });
        if (res.success && res.data) {
            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `onekey-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            alert("Export failed: " + (res.message || "unknown error"));
        }
    } catch (e: any) {
        alert("Export failed: " + (e.message || e));
    }
}

async function handleExportUsage() {
    const token = localStorage.getItem("access_token") || "";
    try {
        const res = await AccountRouter.export_usage({ auth: token });
        if (res.success && res.data) {
            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `onekey-usage-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            alert("Export usage failed: " + (res.message || "unknown error"));
        }
    } catch (e: any) {
        alert("Export usage failed: " + (e.message || e));
    }
}

async function handleExportTasks() {
    const token = localStorage.getItem("access_token") || "";
    try {
        const res = await AccountRouter.export_tasks({ auth: token });
        if (res.success && res.data) {
            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `onekey-tasks-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            alert("Export tasks failed: " + (res.message || "unknown error"));
        }
    } catch (e: any) {
        alert("Export tasks failed: " + (e.message || e));
    }
}

async function handleImport() {
    const token = localStorage.getItem("access_token") || "";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const res = await AccountRouter.import({ auth: token, data });
            if (res.success) {
                const details = res.data?.imported
                    ? Object.entries(res.data.imported)
                        .filter(([, v]) => v > 0)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(", ")
                    : "";
                alert("Import completed!" + (details ? "\nImported: " + details : ""));
                window.location.reload();
            } else {
                alert("Import failed: " + (res.message || "unknown error"));
            }
        } catch (e: any) {
            alert("Import failed: " + (e.message || e));
        }
    };
    input.click();
}

export function AccountFilter({ filterName, filterEmail, onNameChange, onEmailChange, onAdd }: Props) {
    const locale = Locale("AccountPage");
    const common = Locale("Common");
    const admin = isAdmin();

    return (
        <div className="px-4 flex flex-row gap-3 justify-between items-end flex-wrap">
            <div className="flex flex-row gap-2">
                <Input
                    label={locale.Name}
                    placeholder={locale.NamePlaceholder}
                    value={filterName}
                    onChange={e => onNameChange(e.target.value)}
                    className="w-40"
                    size="sm"
                />
                <Input
                    label={locale.Email}
                    placeholder={locale.EmailPlaceholder}
                    value={filterEmail}
                    onChange={e => onEmailChange(e.target.value)}
                    className="w-64"
                    size="sm"
                />
            </div>
            <div className="flex flex-row gap-2">
                {admin && (
                    <>
                        <Button color="secondary" size="sm" variant="flat" onPress={handleExport}>
                            {locale.ExportData}
                        </Button>
                        <Button color="secondary" size="sm" variant="flat" onPress={handleExportUsage}>
                            {locale.ExportUsage}
                        </Button>
                        <Button color="secondary" size="sm" variant="flat" onPress={handleExportTasks}>
                            {locale.ExportTasks}
                        </Button>
                        <Button color="warning" size="sm" variant="flat" onPress={handleImport}>
                            {locale.ImportData}
                        </Button>
                        <Button color="primary" size="sm" onPress={onAdd}>
                            {common.ButtonAdd}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}