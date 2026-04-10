import { Header } from "../../components/header/Header";
import { useEffect, useState } from "react";
import { DemoDTO } from "../../../shared/modules/demo/demo.entity";
import { DemoRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { AccountDTO, AccountListRequest } from "../../../shared/modules/account/account.interface";
import { AccountRouter } from "../../api/instance";

const DemoPage = () => {
    const [DemoList, setDemoList] = useState<DemoDTO[]>([]);

    useEffect(() => {
        (async () => {
            const token = localStorage.getItem("access_token");
            const { success, data } = await DemoRouter.list({ page: 1, auth: token });
            if (success && data) {
                setDemoList(data.list);
            }
        })();
    }, []);

    return (
        <div className="max-w-screen">
            <Header name={Locale("Menu").Demo} />
            <div className="p-4">{JSON.stringify(DemoList)}</div>
        </div>
    );
};

export default DemoPage;
