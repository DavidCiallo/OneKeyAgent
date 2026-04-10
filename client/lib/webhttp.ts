export class HttpClientService {
    private static instance: HttpClientService;
    private constructor() {
        // private
    }
    public static getInstance(): HttpClientService {
        if (!HttpClientService.instance) {
            HttpClientService.instance = new HttpClientService();
        }
        return HttpClientService.instance;
    }

    public async post(url: string, body: any) {
        const data = fetch(url, {
            method: "post",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json", Token: localStorage.getItem("access_token") || "" },
        }).then((r) => r.json());
        return data;
    }
}
