import { Pagination } from "@heroui/react";

type Props = {
    page: number;
    total: number;
    onChange: (p: number) => void;
};

export function ProviderPagination({ page, total, onChange }: Props) {
    const totalPages = Math.ceil(total / 10) || 1;
    return (
        <div className="flex justify-center">
            <Pagination total={totalPages} page={page} onChange={onChange} showControls />
        </div>
    );
}
