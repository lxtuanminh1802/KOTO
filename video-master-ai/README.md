# Video Master AI

Hệ thống giám định video chứng cứ: tiếp nhận video có kiểm tra toàn vẹn (SHA-256), phân tích người và phương tiện bằng AI, tìm kiếm theo mô tả hoặc ảnh khuôn mặt, danh sách theo dõi có cảnh báo sớm, cắt đoạn, khoanh vùng, gắn thẻ, bản đồ camera, tăng cường ảnh, xuất báo cáo PDF và gói chứng cứ. Mọi thao tác được ghi vào nhật ký kiểm toán có chuỗi băm.

Mã nguồn bám theo ba tài liệu đầu vào: prototype HTML (giao diện "Clear evidence"), URD v1 (88 UR, 20 NFR, ma trận phân quyền, Data Dictionary) và `workflows.md` (WF-01 đến WF-10).

## Kiến trúc

```
trình duyệt ──► web (nginx + bản build React) ──► api (FastAPI) ──► MySQL 8.4
                         │  /api, /api/ws               │
                         │                              └── volume evidence (/data)
                         └──────────────────────────► worker (hàng đợi phân tích) ──┘
```

Backend là Python 3.12 với FastAPI, SQLAlchemy 2 và PyMySQL. Worker là cùng mã nguồn, chạy `python -m app.worker`. Nó lấy việc từ bảng `analysis_jobs` bằng `SELECT … FOR UPDATE SKIP LOCKED`, nên chạy nhiều worker song song không bị trùng việc. Tiến độ, cảnh báo và thông báo đi qua bảng `events`, API đọc bảng này và đẩy xuống trình duyệt qua WebSocket. Nhờ vậy không cần Redis hay message broker.

Frontend là React 19, Vite 8 và Tailwind CSS v4. Màu và khoảng cách lấy từ design token của prototype, có chế độ tối và tiếng Anh. Dữ liệu dùng @tanstack/react-query, trạng thái giao diện dùng zustand, bản đồ dùng Leaflet.

Xử lý video dùng ffmpeg và ffprobe. Bản gốc được khóa chỉ đọc ngay sau khi tiếp nhận. Mọi thứ phát sinh (bản phát VP9 cho trình duyệt, khung hình, đoạn cắt, video tăng cường) là tệp riêng có mã băm riêng. Bản gốc không bao giờ bị ghi đè.

### Cấu trúc thư mục

```
video-master-ai/
  docker-compose.yml, .env.example
  backend/
    app/
      main.py            khởi tạo FastAPI, gắn router, vòng relay WebSocket
      config.py          toàn bộ cấu hình, biến môi trường tiền tố VMA_
      models.py          bảng MySQL theo Data Dictionary
      permissions.py     ma trận phân quyền (sheet "Phân quyền")
      api/               REST theo nhóm chức năng (auth, cases, uploads, videos, media, search, zones, tags, watch, cameras, images, exports, notifications, assistant, admin, realtime)
      services/          nghiệp vụ: intake, analysis, watch, audit, reporting, nlq, integrity, media…
      engine/            động cơ AI: simulated (mặc định), cv (OpenCV), features (vector đặc trưng)
      demo/generate.py   dựng 3 đoạn CCTV mẫu có đáp án
      seed.py            nạp dữ liệu mẫu
      worker.py          tiến trình phân tích nền + kiểm tra toàn vẹn định kỳ
    tests/               pytest
  frontend/
    src/views/           các tab chính (Vụ án, Footage, Tìm kiếm, Thẻ, Bản đồ, Image Lab)
    src/dialogs/         hộp thoại (tải lên, cắt, báo cáo, gói chứng cứ…)
    src/components/      header, sidebar, trợ lý, overlay, bộ UI dùng chung
    src/lib/             api, i18n, store, realtime, upload có thể tiếp tục
```

## Chạy bằng Docker Compose

```bash
cd video-master-ai
cp .env.example .env        # đổi VMA_JWT_SECRET và mật khẩu MySQL
docker compose up -d --build
```

Mở http://localhost:8080. Lần chạy đầu, API dựng ba video CCTV mẫu và nạp hai vụ án, mất khoảng một phút. Theo dõi bằng `docker compose logs -f api`. Muốn tăng số worker phân tích: `docker compose up -d --scale worker=3`.

## Chạy môi trường phát triển

Yêu cầu: Python 3.12+, Node 22+, ffmpeg và ffprobe trong PATH, MySQL 8 (hoặc `docker run -d --name vma-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=vma -e MYSQL_USER=vma -e MYSQL_PASSWORD=vma -p 3306:3306 mysql:8.4`).

```bash
# backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
echo 'VMA_DATABASE_URL=mysql+pymysql://vma:vma@127.0.0.1:3306/vma?charset=utf8mb4' > .env
python -m app.seed                                   # tạo bảng + dữ liệu mẫu (--reset để làm lại)
VMA_WORKER_EMBEDDED=true uvicorn app.main:app --port 8000   # worker chạy chung tiến trình cho tiện

# frontend (terminal khác)
cd frontend
npm install
npm run dev                                          # http://localhost:5173, proxy /api sang :8000
```

Khi chạy thật nên tách worker: `python -m app.worker` và bỏ `VMA_WORKER_EMBEDDED`.

### Kiểm thử

```bash
cd backend
pip install pytest
pytest -q                                             # SQLite trong bộ nhớ
VMA_TEST_DATABASE_URL=mysql+pymysql://vma:vma@127.0.0.1:3306/vma_test pytest -q   # chạy trên MySQL
```

Bộ test bao phủ so khớp biển số (kể cả ký tự đại diện), phân tích câu mô tả tiếng Việt có dấu và không dấu, ma trận phân quyền và việc khóa ghi khi vụ án đã đóng, chuỗi băm nhật ký (phát hiện sửa và xóa dòng), cấp mã EV không tái sử dụng, thuật toán điểm trong vùng (ray casting) và vector khuôn mặt.

## Tài khoản mẫu

Mật khẩu chung `VideoMaster@2026`, mã PIN mở khóa màn hình `123456`. Ở chế độ demo (`VMA_DEMO_MODE=true`), mã OTP `000000` luôn được chấp nhận.

| Tài khoản | Vai trò | Ghi chú |
|---|---|---|
| tranhai | Điều tra viên | Phụ trách vụ VA-117 |
| phamthuha | Điều tra viên | Phụ trách vụ VA-121 |
| nguyenvanduc | Giám định viên | |
| leminh | Chỉ huy | Duy nhất được đóng vụ án |
| viewer | Người xem | Chỉ đọc |
| admin | Quản trị | Thấy siêu dữ liệu, không xem được video |

Dữ liệu mẫu: vụ VA-117 có video đã phân tích xong. Vụ VA-121 có một video để ở hàng đợi, khi worker chạy sẽ thấy tiến độ trực tiếp và một cảnh báo sớm biển số `29A-123.45` bật lên giữa chừng. Danh sách theo dõi có sẵn `29A-123.45`, mẫu `51F-888.*` và một khuôn mặt.

## Cấu hình chính

Mọi khóa nằm ở `backend/app/config.py`, đặt qua biến môi trường tiền tố `VMA_` hoặc tệp `.env`.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `VMA_DATABASE_URL` | mysql local | Chuỗi kết nối SQLAlchemy |
| `VMA_DATA_DIR` | `backend/data` | Kho chứng cứ, tệp phát sinh, tệp xuất |
| `VMA_JWT_SECRET` | | Bắt buộc đổi khi triển khai |
| `VMA_DEMO_MODE` | `true` | OTP 000000, hiện tài khoản mẫu ở màn đăng nhập |
| `VMA_AI_ENGINE` | `simulated` | `simulated` hoặc `opencv` |
| `VMA_WORKER_CONCURRENCY` | 2 | Số video phân tích đồng thời mỗi worker |
| `VMA_CLIP_MODE` | `copy` | `copy` cắt theo keyframe, `reencode` cắt chính xác khung |
| `VMA_FACE_SEARCH_THRESHOLD` / `VMA_FACE_ALERT_THRESHOLD` | 60 / 85 | Ngưỡng tương đồng khuôn mặt (Q03) |
| `VMA_INTEGRITY_CHECK_HOURS` | 168 | Chu kỳ băm lại bản gốc |
| `VMA_MAPTILER_KEY` | rỗng | Có khóa thì dùng nền MapTiler, không có thì dùng bản đồ sơ đồ ngoại tuyến |
| `VMA_MAX_UPLOAD_BYTES` | 4 GB | Giới hạn mỗi tệp |

## Về động cơ AI

URD không chốt mô hình hay phần cứng GPU (Q07), nên phần AI được tách sau giao diện `engine/base.py`. Phần còn lại của hệ thống chỉ thấy danh sách track: khung bao theo thời gian, thuộc tính, biển số, vector khuôn mặt.

`simulated` là động cơ mặc định. Với ba video mẫu, nó đọc tệp đáp án sinh cùng video nên kết quả khớp đúng hình. Với video người dùng tải lên, nó sinh track giả lập có nhịp độ thời gian theo công thức ước tính của URD. Mục đích là để toàn bộ quy trình (tiến độ, cảnh báo sớm, tìm kiếm, re-ID, báo cáo) chạy được ngay trên máy không có GPU.

`opencv` chạy trên hình thật: tách nền MOG2, bám đối tượng theo IoU, phân người và xe theo tỉ lệ khung, lấy màu chủ đạo, dò khuôn mặt bằng Haar cascade. Nó cho khung bao thật trên camera cố định nhưng không đọc biển số và độ chính xác thấp hơn mô hình học sâu nhiều.

Khi đơn vị chốt mô hình (YOLO cho phát hiện, ByteTrack để bám, ArcFace cho khuôn mặt, một mô hình OCR biển số Việt Nam), chỉ cần viết thêm một lớp trong `engine/` và một hàm `embed()` mới trong `engine/features.py`. API, cơ sở dữ liệu và giao diện giữ nguyên.

## Truy vết yêu cầu

| Nhóm UR | Nơi triển khai |
|---|---|
| UR-AUTH (đăng nhập, OTP, khóa phiên, PIN) | `api/auth.py`, `security.py`, `frontend/src/views/Login.tsx`, `components/Overlays.tsx` |
| UR-CASE (vụ án, đóng vụ) | `api/cases.py`, `permissions.py` (WRITE_ACTIONS) |
| UR-EVD (tiếp nhận, SHA-256, mã EV, tải lên tiếp tục được, xóa mềm) | `api/uploads.py`, `services/intake.py`, `frontend/src/lib/upload.ts`, `dialogs/UploadDialog.tsx` |
| UR-ANA (phân tích, chế độ, FPS, phân tích lại, re-ID) | `services/analysis.py`, `engine/`, `worker.py` |
| UR-VID, UR-CLIP (trình phát, cắt đoạn, chụp khung) | `api/media.py`, `api/videos.py`, `views/FootageView.tsx` |
| UR-SRCH (mô tả tự nhiên, biển số, khuôn mặt) | `api/search.py`, `services/nlq.py`, `views/SearchView.tsx` |
| UR-WATCH (danh sách theo dõi, cảnh báo sớm) | `api/watch.py`, `services/watch.py`, `lib/realtime.ts` |
| UR-ZONE, UR-TAG | `api/zones.py`, `api/tags.py`, `views/TagsView.tsx` |
| UR-MAP (camera, lộ trình) | `api/cameras.py`, `views/MapView.tsx` |
| UR-ENH, Image Lab | `api/images.py`, `services/media.py` (enhance), `views/ImageLabView.tsx` |
| UR-RPT, gói chứng cứ | `services/reporting.py`, `api/exports.py`, `dialogs/Exports.tsx` |
| UR-AI (trợ lý) | `api/assistant.py`, `components/Assistant.tsx` |
| UR-AUD, NFR-INT (nhật ký chuỗi băm, kiểm tra toàn vẹn) | `services/audit.py`, `services/integrity.py`, `api/admin.py` |

## Câu hỏi mở và cách đang xử lý

Các câu Q01 đến Q13 trong URD chưa có trả lời. Để không chặn tiến độ, tôi chọn phương án dưới đây và để mỗi lựa chọn ở chỗ dễ đổi. Nhờ BA xác nhận hoặc sửa.

**Q01 Xác thực.** Dùng tài khoản riêng, mật khẩu bcrypt và OTP TOTP (Google Authenticator). Chưa tích hợp SSO hay PKI. Phần xác thực gói gọn trong `api/auth.py` nên thêm SSO sau không ảnh hưởng chỗ khác.

**Q02 Danh sách theo dõi.** Dùng chung toàn đơn vị. Cảnh báo gửi người tải video lên, điều tra viên phụ trách vụ và chỉ huy (`watch_recipients` trong `services/events.py`).

**Q03 Ngưỡng khuôn mặt.** Tìm kiếm 60%, cảnh báo 85%, đặt qua cấu hình.

**Q04 Nhãn chế độ.** Giữ nguyên nhãn như prototype.

**Q05 Lưu trữ và hủy.** Gỡ chứng cứ là xóa mềm, bắt buộc nhập lý do và ghi nhật ký. Tệp gốc vẫn nằm trong kho. Chưa có chức năng hủy vĩnh viễn vì chưa có chính sách.

**Q06 Phân tích lại.** Mỗi lần phân tích tăng số phiên bản. Kết quả cũ giữ trong CSDL, giao diện và tìm kiếm chỉ dùng phiên bản mới nhất. Vùng khoanh được tính lại theo phiên bản mới. Thẻ gắn với một đối tượng cụ thể nên vẫn trỏ về kết quả của phiên bản mà người dùng đã gắn.

**Q07 GPU và worker.** Chưa có số liệu. Ước tính thời gian dùng công thức trong URD, số worker chỉnh bằng `--scale worker=N` và `VMA_WORKER_CONCURRENCY`.

**Q08 Đoạn cắt.** Tạo tệp thật ngay khi cắt, mặc định cắt theo keyframe không mã hóa lại (lệch tối đa khoảng 1 giây). Đổi `VMA_CLIP_MODE=reencode` nếu cần chính xác từng khung.

**Q09 Re-ID.** Chỉ ghép đối tượng trong cùng một vụ án.

**Q10 Lệch giờ camera.** Nhập tay độ lệch cho từng camera (`clock_offset_sec`). Chưa đọc OSD hay đối chiếu NTP.

**Q11 Bản đồ.** Có khóa MapTiler thì dùng nền MapTiler. Không có hoặc mạng nội bộ không ra được Internet thì tự chuyển sang bản đồ sơ đồ ngoại tuyến. Chuyển sang máy chủ bản đồ nội bộ chỉ cần đổi URL tile trong `views/MapView.tsx`.

**Q12 Mẫu báo cáo.** Tự thiết kế bố cục PDF (thông tin vụ, danh mục chứng cứ kèm mã băm, đối tượng, ảnh, chữ ký, số trang). Có mẫu chính thức thì sửa `services/reporting.py`.

**Q13 Trợ lý AI.** Hiện là trợ lý theo luật: nhận diện ý định từ câu hỏi và gọi đúng chức năng (tìm kiếm, mở video, tóm tắt vụ). Không gửi dữ liệu ra ngoài. Khi có mô hình ngôn ngữ chạy tại chỗ thì thay phần hiểu câu trong `api/assistant.py`.

## Lưu ý khi triển khai thật

Tắt `VMA_DEMO_MODE`, đặt `VMA_JWT_SECRET` dài và ngẫu nhiên, đặt `VMA_SEED_DEMO=false`. Chạy sau HTTPS. Khóa chỉ đọc trên hệ tệp chỉ là lớp bảo vệ tối thiểu cho bản gốc. Môi trường thật nên đặt kho chứng cứ trên lưu trữ có object lock (WORM) và sao lưu MySQL kèm volume chứng cứ cùng thời điểm để giữ khớp mã băm.
