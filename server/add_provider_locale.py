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
    "DailyQuota": {
        "cn": "每日配额", "en": "Daily quota",
        "es": "Cuota diaria", "ja": "1日の割り当て",
        "pt-BR": "Cota diária", "ru": "Дневная квота",
        "th": "โควต้ารายวัน", "vi": "Hạn mức hàng ngày",
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
    "ActiveFrom": {
        "cn": "生效起", "en": "Active from",
        "es": "Activo desde", "ja": "開始時刻",
        "pt-BR": "Ativo a partir de", "ru": "Активен с",
        "th": "เริ่มใช้งาน", "vi": "Hiệu lực từ",
    },
    "ActiveTo": {
        "cn": "生效止", "en": "Active to",
        "es": "Activo hasta", "ja": "終了時刻",
        "pt-BR": "Ativo até", "ru": "Активен до",
        "th": "สิ้นสุดการใช้งาน", "vi": "Hiệu lực đến",
    },
    "OutsideWindow": {
        "cn": "当前不在生效时段，请求会跳过该供应商。",
        "en": "Outside its active window; requests skip this provider.",
        "es": "Fuera de su franja activa; las peticiones lo omiten.",
        "ja": "現在は有効時間外のため、リクエストではスキップされます。",
        "pt-BR": "Fora da janela ativa; as requisições o ignoram.",
        "ru": "Вне активного окна; запросы его пропускают.",
        "th": "อยู่นอกช่วงเวลาที่ใช้งาน คำขอจะข้ามผู้ให้บริการรายนี้",
        "vi": "Ngoài khung giờ hoạt động; yêu cầu sẽ bỏ qua nhà cung cấp này.",
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
        added, updated = [], []
        for key, texts in KEYS.items():
            text = texts.get(lang) or texts["en"]
            if key in page:
                if page[key] != text:
                    page[key] = text
                    updated.append(key)
                continue
            page[key] = text
            added.append(key)
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
            f.write("\n")
        note = f"+{len(added)} keys" if not updated else f"~{len(updated)} updated"
        print(f"{name}: {note}")


if __name__ == "__main__":
    main()
