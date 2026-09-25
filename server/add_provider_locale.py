"""Add the provider routing-limit locale keys to every locale file.

Run: python server/add_provider_locale.py
"""

import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "client", "locales")

# Key -> per-language text. cn/en are the source of truth; the rest follow.
KEYS = {
    "MaxContext": {
        "cn": "上下文上限", "en": "Max context",
        "es": "Contexto máximo", "ja": "コンテキスト上限",
        "pt-BR": "Contexto máximo", "ru": "Лимит контекста",
        "th": "ขีดจำกัดบริบท", "vi": "Giới hạn ngữ cảnh",
    },
    "MaxContextHint": {
        "cn": "0 = 不限制。请求超出此值时跳过该供应商。",
        "en": "0 = no limit. Requests above this skip this provider.",
        "es": "0 = sin límite. Las solicitudes mayores lo omiten.",
        "ja": "0 = 無制限。これを超えるリクエストはスキップされます。",
        "pt-BR": "0 = sem limite. Requisições maiores o ignoram.",
        "ru": "0 = без ограничений. Большие запросы пропускают его.",
        "th": "0 = ไม่จำกัด คำขอที่ใหญ่กว่าจะข้ามผู้ให้บริการนี้",
        "vi": "0 = không giới hạn. Yêu cầu lớn hơn sẽ bỏ qua.",
    },
    "DailyQuota": {
        "cn": "每日配额", "en": "Daily quota",
        "es": "Cuota diaria", "ja": "1日の割り当て",
        "pt-BR": "Cota diária", "ru": "Дневная квота",
        "th": "โควต้ารายวัน", "vi": "Hạn mức hàng ngày",
    },
    "DailyQuotaHint": {
        "cn": "0 = 不限制。每日请求次数，仅存于内存，重启后重置。",
        "en": "0 = no limit. Requests per day, in memory only — resets on restart.",
        "es": "0 = sin límite. Solicitudes por día, solo en memoria.",
        "ja": "0 = 無制限。1日のリクエスト数（メモリ上のみ、再起動でリセット）。",
        "pt-BR": "0 = sem limite. Requisições por dia, apenas em memória.",
        "ru": "0 = без ограничений. Запросов в день, только в памяти.",
        "th": "0 = ไม่จำกัด จำนวนคำขอต่อวัน เก็บในหน่วยความจำเท่านั้น",
        "vi": "0 = không giới hạn. Số yêu cầu mỗi ngày, chỉ trong bộ nhớ.",
    },
    "Parked": {
        "cn": "已暂停", "en": "Parked",
        "es": "Pausado", "ja": "停止中",
        "pt-BR": "Pausado", "ru": "Приостановлен",
        "th": "หยุดชั่วคราว", "vi": "Tạm dừng",
    },
    "QuotaSpent": {
        "cn": "配额用尽", "en": "Quota spent",
        "es": "Cuota agotada", "ja": "割り当て超過",
        "pt-BR": "Cota esgotada", "ru": "Квота исчерпана",
        "th": "โควต้าหมด", "vi": "Hết hạn mức",
    },
    "FailStreakHint": {
        "cn": "连续失败次数，达到 5 次将暂停该供应商 300 秒。",
        "en": "Consecutive failures; 5 parks this provider for 300s.",
        "es": "Fallos consecutivos; 5 lo pausa durante 300 s.",
        "ja": "連続失敗数。5回で300秒間停止します。",
        "pt-BR": "Falhas consecutivas; 5 o pausa por 300s.",
        "ru": "Подряд неудач; 5 приостанавливает на 300 с.",
        "th": "ล้มเหลวต่อเนื่อง 5 ครั้งจะหยุด 300 วินาที",
        "vi": "Số lần lỗi liên tiếp; 5 lần sẽ tạm dừng 300 giây.",
    },
    "Context": {
        "cn": "上下文", "en": "Context",
        "es": "Contexto", "ja": "コンテキスト",
        "pt-BR": "Contexto", "ru": "Контекст",
        "th": "บริบท", "vi": "Ngữ cảnh",
    },
    "Quota": {
        "cn": "配额", "en": "Quota",
        "es": "Cuota", "ja": "割り当て",
        "pt-BR": "Cota", "ru": "Квота",
        "th": "โควต้า", "vi": "Hạn mức",
    },
}


def main():
    for name in sorted(os.listdir(LOCALES)):
        if not name.endswith(".json"):
            continue
        lang = name[:-5]
        path = os.path.join(LOCALES, name)
        with io.open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        page = data.get("ProviderPage")
        if page is None:
            print(f"{name}: no ProviderPage, skipped")
            continue
        added = []
        for key, texts in KEYS.items():
            if key in page:
                continue
            text = texts.get(lang) or texts["en"]
            page[key] = text
            added.append(key)
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
            f.write("\n")
        print(f"{name}: +{len(added)} keys")


if __name__ == "__main__":
    main()
