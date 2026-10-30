# Expo Crawler

Crawler lấy danh sách exhibitor từ website triển lãm, đẩy về tab **Danh sách hãng tiềm năng** của module Phát triển hãng.

Với mỗi nguồn (URL trang danh sách exhibitor), crawler:

1. Tải trang danh sách. Nếu bản HTML tĩnh có ít link (trang tải dữ liệu bằng JavaScript), mở lại bằng Chromium, cuộn xuống và bấm "Load more" tới khi hết. Có phân trang thì đi tiếp theo link "Next".
2. Tự dò link trang chi tiết từng hãng: gom link cùng domain theo mẫu đường dẫn (vd `/exhibitors-list/exhibitor/*`) và chọn nhóm đông nhất. Dò sai thì khai báo `link_selector`.
3. Mở trang chi tiết, lấy tên hãng, gian hàng, mô tả trên trang triển lãm, nhóm sản phẩm, quốc gia, website, email, LinkedIn, logo. Đọc cả JSON-LD nếu trang có khai báo.
4. Vào website hãng, đọc meta description trang chủ và các đoạn văn trang About (bỏ menu, footer, cookie banner) làm **giới thiệu tổng quan**.
5. Gợi ý mảng sản phẩm (A05, A06, C09, UAV, Thiết bị an ninh…) theo từ khóa. Người dùng sửa lại trên web.
6. Loại trùng theo domain website, nhớ các trang đã crawl (`state/`) để lần sau chỉ lấy hãng mới.

Crawler tôn trọng `robots.txt`, giãn cách 1,5 giây giữa 2 request tới cùng host và thử lại khi gặp lỗi 429/5xx.

## Cài đặt

```bash
cd crawler
pip install -r requirements.txt
python -m playwright install chromium    # hoặc đặt CHROMIUM_PATH tới Chromium có sẵn
```

## Dùng

```bash
# Kiểm tra một URL trước khi thêm nguồn: số link dò được, 5 link đầu, bóc tách thử hãng đầu tiên
python -m expo_crawler probe --url https://www.internationalcyberexpo.com/exhibitors-list

# Crawl một nguồn trong sources.yaml (thử 10 hãng trước)
python -m expo_crawler run --source international-cyber-expo --limit 10

# Crawl một URL bất kỳ không cần khai báo
python -m expo_crawler run --url https://example-expo.com/exhibitors --name "Example Expo" --default-mang A06

# Crawl mọi nguồn định kỳ và đẩy lên web
EXPO_PUSH_URL=https://erp.aiptgroup.com/api/potential-vendors/import EXPO_PUSH_TOKEN=... \
python -m expo_crawler run --push
```

Kết quả ghi ở `output/<id-nguồn>.json`. Tùy chọn hay dùng:

| Tùy chọn | Ý nghĩa |
|---|---|
| `--limit N` | Chỉ lấy N hãng, dùng để thử |
| `--no-website` | Không vào website hãng (nhanh hơn, không có giới thiệu tổng quan) |
| `--render always` | Luôn mở bằng trình duyệt |
| `--full` | Crawl lại cả hãng đã lấy ở lần trước |
| `--link-selector "a[href*='/exhibitor/']"` | Chỉ định link trang chi tiết khi tự dò sai |

Lịch chạy: đặt cron trên server, ví dụ mỗi sáng thứ Hai lúc 6h:

```cron
0 6 * * 1  cd /opt/expo-crawler && python -m expo_crawler run --push >> logs/crawl.log 2>&1
```

## Thêm nguồn

Form **Thêm nguồn** trên web ghi vào bảng nguồn; khi chưa tích hợp thì thêm tay vào `sources.yaml`:

```yaml
sources:
  - id: international-cyber-expo
    name: International Cyber Expo
    url: https://www.internationalcyberexpo.com/exhibitors-list
    place: London, Anh
    schedule: weekly          # once | daily | weekly
    default_mang: A05         # dùng khi không đoán được mảng
    crawl_website: true
    render: auto              # auto | always | never
    link_selector: null       # CSS chọn link trang chi tiết
    card_selector: null       # trang không có trang chi tiết: mỗi thẻ là một hãng
    fields:                   # selector riêng khi tự bóc tách sai
      name: h1
      booth: .stand-number
      description: .exhibitor-description
      website: a.website
      country: .country
      categories: .tags li
```

Quy trình đề xuất khi thêm nguồn mới: chạy `probe`, xem `links_found` và mẫu bóc tách. Đúng thì lưu. Sai thì thêm `link_selector` hoặc `fields`, chạy `probe` lại.

## Hợp đồng API đẩy dữ liệu

`POST {EXPO_PUSH_URL}`, header `Authorization: Bearer {EXPO_PUSH_TOKEN}`, gửi theo lô 50 hãng:

```json
{
  "source": {"id": "international-cyber-expo", "name": "International Cyber Expo", "url": "https://…/exhibitors-list",
             "place": "London, Anh", "when": "", "schedule": "weekly"},
  "items": [{
    "name": "Acme Cyber Defence Ltd",
    "website": "https://acme.example/", "domain": "acme.example",
    "country": "Anh", "booth": "C12",
    "categories": ["Threat Intelligence", "Managed SOC"],
    "expo_description": "Mô tả trên trang triển lãm…",
    "overview": {"summary": "meta description trang chủ", "text": "đoạn giới thiệu trang About…",
                 "about_url": "https://acme.example/about-us/", "site": "https://acme.example/"},
    "email": "sales@acme.example", "linkedin": "https://www.linkedin.com/company/acme", "logo": "https://…/logo.png",
    "mang_suggest": "A05", "mang_keywords": ["soc", "threat intelligence"],
    "detail_url": "https://…/exhibitor/acme", "source_id": "international-cyber-expo",
    "source_name": "International Cyber Expo", "source_url": "https://…/exhibitors-list",
    "crawled_at": "2026-10-30T06:00:00+00:00"
  }]
}
```

Phía web cần: loại trùng theo `domain` với Danh sách tiềm năng, Hãng phát triển và Quản lý NCC (trùng thì bỏ qua hoặc gắn nhãn "Đã có"), tạo bản ghi trạng thái "Mới", trả về `{"created": n, "duplicates": m}`.

## Test

```bash
python -m pytest -q
```

Test dựng một trang triển lãm giả lập trên localhost (danh sách tải bằng JavaScript, nút "Load more", hãng trùng domain, phân trang tĩnh, website hãng có trang About và cookie banner) rồi chạy crawler thật với requests và Chromium.

## Giới hạn

- Trang yêu cầu đăng nhập, có CAPTCHA hoặc chặn bot thì không lấy được. Một số triển lãm dùng nền tảng riêng (Swapcard, Map Your Show…) tải dữ liệu qua API nội bộ: khi đó dùng `render: always`, hoặc viết adapter riêng gọi API của nền tảng.
- Giới thiệu tổng quan lấy từ trang About bằng heuristic. Website chỉ có ảnh hoặc toàn JavaScript thì phần này có thể trống.
- Mảng sản phẩm là gợi ý theo từ khóa tiếng Anh, chỉnh danh sách trong `expo_crawler/classify.py`.
