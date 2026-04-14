import { Header } from "../../components/header/Header";
import { useEffect, useState } from "react";
import { DemoDTO } from "../../../shared/modules/demo/demo.entity";
import { DemoRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { AccountDTO, AccountListRequest } from "../../../shared/modules/account/account.interface";

const DemoPage = () => {
    const [DemoList, setDemoList] = useState<DemoDTO[]>([]);

    useEffect(() => {

    }, []);

    return (
        <div className="max-w-screen">
            <Header name={Locale("Menu").Demo} />
            <div className="p-4">{JSON.stringify(DemoList)}</div>
        </div>
    );
};

export default DemoPage;
