# KOTO ERP

> **Know One, Teach One** — Nền tảng quản lý chương trình đào tạo nghề khách sạn & nhà hàng dành cho KOTO Vietnam.

KOTO là tổ chức phi lợi nhuận tại Hà Nội chuyên đào tạo kỹ năng nghề cho thanh thiếu niên có hoàn cảnh khó khăn từ năm 2000. Hệ thống ERP này hỗ trợ đội ngũ vận hành theo dõi toàn bộ hành trình của học viên — từ ngày nhập học đến khi tốt nghiệp và gia nhập mạng lưới alumni.

---

## Mục lục

1. [Phân quyền & Đăng nhập](#1-phân-quyền--đăng-nhập)
2. [Dashboard](#2-dashboard)
3. [Quản lý Học viên](#3-quản-lý-học-viên)
4. [Hệ thống Matching](#4-hệ-thống-matching)
5. [Quản lý Alumni](#5-quản-lý-alumni)
6. [Alumni Portal](#6-alumni-portal)
7. [Quản lý Nội dung](#7-quản-lý-nội-dung)
8. [Cài đặt Đào tạo](#8-cài-đặt-đào-tạo)
9. [Dữ liệu mẫu](#9-dữ-liệu-mẫu)
10. [Công nghệ](#10-công-nghệ)

---

## 1. Phân quyền & Đăng nhập

Demo mode — không cần mật khẩu. Chọn vai trò khi đăng nhập:

| Vai trò | Quyền hạn |
|---|---|
| **Admin** | Toàn quyền: quản lý học viên, alumni, chương trình đào tạo, nội dung, chuyển học viên lên alumni |
| **Teacher** | Chấm điểm kỹ năng, xem hồ sơ học viên, submit review sau matching |
| **Alumni** | Xem Alumni Portal, hồ sơ cá nhân, hồ sơ học viên đang có mentoring request hoặc đang được match |

Alumni đăng nhập vào **Alumni Portal** như trang chủ — không truy cập được quản lý học viên toàn bộ. Thông tin liên lạc của học viên (số điện thoại, email, ngày sinh) bị ẩn cho đến khi admin xác nhận kết nối.

---

## 2. Dashboard

Trang tổng quan dành cho Admin và Teacher.

### KPI Cards
| Chỉ số | Nội dung |
|---|---|
| Active Trainees | Học viên đang theo học / tổng đã tốt nghiệp |
| Alumni Network | Tổng alumni / số sẵn sàng mentoring |
| Total Matches | Tổng matching / đang active / đã hoàn thành |
| Avg Skill Lift | Điểm kỹ năng trung bình tăng sau matching |

### Biểu đồ
- **Matches per Month** — Bar chart theo 8 tháng gần nhất, phân loại placement vs mentoring
- **Trainees by Intake** — Area chart xu hướng tuyển sinh theo kỳ
- **Match Breakdown** — Progress bars tỷ lệ các trạng thái matching

### Panels hành động
- **Needs Attention** — Học viên có kỹ năng dưới ngưỡng; nhấn để mở hồ sơ
- **Review Reminders** — Matching sắp đến hoặc quá hạn review, phân biệt màu overdue / upcoming
- **Notification Bell 🔔** — Badge đếm tổng cảnh báo, dropdown điều hướng thẳng đến hồ sơ học viên liên quan

---

## 3. Quản lý Học viên

### Danh sách

- Bảng đầy đủ: tên, kỳ học, vị trí, tiến độ kỹ năng, điểm TB, trạng thái
- **Hover tooltip**: di chuột vào dòng để xem tóm tắt — MBTI, kỹ năng, điểm TB, trạng thái matching, personality traits
- Lọc theo trạng thái (Active / Graduated / On Leave / Withdrawn) và vị trí đào tạo
- Tìm kiếm theo tên hoặc kỳ học
- Badge "Matched" nếu học viên đang có matching active

### Hồ sơ học viên — 5 tab

#### Overview
Thông tin cá nhân. Với vai trò Alumni, các trường nhạy cảm (điện thoại, email, ngày sinh, liên hệ khẩn cấp) được ẩn kèm thông báo liên hệ admin để kết nối.

#### Skills
- Toàn bộ kỹ năng theo nhóm của vị trí đào tạo
- Thanh điểm màu: xanh ≥ 80 / vàng ≥ 65 / đỏ < 65; nhãn "Below pass" nếu chưa đạt
- Giảng viên nhấn **Grade / Edit** để chấm điểm qua slider + ghi chú
- **Before/After toggle**: khi có matching hoàn thành, hiển thị song song điểm trước–sau; delta màu xanh nếu cải thiện
- Banner tốt nghiệp tự động khi toàn bộ kỹ năng đạt ngưỡng

#### Personality
- MBTI selector: 16 loại, phân nhóm Analyst / Diplomat / Sentinel / Explorer với màu theo nhóm
- Trait pills: chọn các tính cách đặc trưng (Empathetic, Leadership Potential, Creative…)
- Ghi chú personality phục vụ thuật toán matching

#### Matches
- Lịch sử matching: thông tin alumni, loại, trạng thái, ngày match, compatibility score
- Placement: tên công ty, vị trí, email HR, preview email đánh giá
- Kết quả skill improvement nếu đã hoàn thành
- **Submit Review**: giảng viên điền điểm after-match qua modal slider → tự động đánh dấu completed

#### Career
- **Định hướng nghề nghiệp**: mục tiêu ngắn và dài hạn của học viên
- **Lớp đào tạo đã tham gia**: danh sách các workshop, chứng chỉ, khoá học bổ sung trong quá trình học KOTO

### Thêm & Chuyển học viên
- Form thêm mới: ảnh, thông tin cá nhân, vị trí đào tạo, MBTI với hover preview
- Admin có thể chuyển học viên tốt nghiệp thành alumni với form prefill sẵn

---

## 4. Hệ thống Matching

### Tạo Match

Nhấn **Match** trên hồ sơ học viên → Modal 2 bước:

**Bước 1 — Chọn Alumni**

Danh sách alumni xếp hạng theo **Compatibility Score** (0–100):

| Tiêu chí | Điểm | Mô tả |
|---|---|---|
| Position match | 40 | Alumni được đào tạo đúng vị trí học viên |
| MBTI compatibility | 20 | Bảng tương hợp 16×16 kiểu MBTI |
| Mentoring availability | 20 | Alumni đang sẵn sàng nhận mentee |
| Location | 10 | Cùng thành phố (Hà Nội) |
| Prior match history | 10 | Bonus nếu alumni đã có matching thành công trước đó |

**Bước 2 — Cấu hình**

| | Mentoring | Placement |
|---|---|---|
| Mục đích | Hỗ trợ kỹ năng trong trường | Thực tập / việc làm thực tế |
| Review | Giảng viên submit điểm sau | Gửi form đánh giá tới employer HR |
| Tracking | Skill snapshot trước/sau | Skill snapshot + phản hồi employer |

Placement: nhập tên công ty, vị trí, email HR; hệ thống tạo preview email đánh giá tự động. Review due date tự tính 3 tháng từ ngày match.

### Đo lường hiệu quả
- Mỗi match lưu `skillSnapshotBefore` khi tạo và `skillSnapshotAfter` khi review hoàn thành
- Dashboard tính Avg Skill Lift và Skill Review Rate tự động
- Tab Skills của học viên hiển thị delta từng kỹ năng (trước → sau matching)

---

## 5. Quản lý Alumni

### Danh sách & Hồ sơ chi tiết

- Card grid: ảnh, vị trí hiện tại, công ty, địa điểm, badge MBTI màu theo nhóm
- Nhấn card → trang **Alumni Detail** đầy đủ

### Trang Alumni Detail

**Stats strip**: số học viên đã mentor · số vị trí đã làm việc · số giải thưởng · số chứng chỉ

**Bằng cấp, Chứng chỉ & Giải thưởng** — phân loại và hiển thị theo màu:
- 🏆 Giải thưởng từ employer, hiệp hội ngành
- 🎓 Chứng chỉ nghề quốc tế (SCA, HACCP/Highfield, WSET, Cornell eCornell, CIA, AHLEI…)
- ⭐ Ghi nhận từ KOTO và cộng đồng

**Quá trình làm việc** — timeline dạng cột mốc, vị trí hiện tại được đánh dấu

**Tính cách** — MBTI type với màu nhóm, tagline, personality notes

### Thêm Alumni
Thêm thủ công hoặc nhận tự động từ luồng "Transfer from Trainee".

---

## 6. Alumni Portal

Trang chủ dành riêng cho vai trò Alumni sau khi đăng nhập. Thiết kế theo hướng **self-service** — alumni chủ động tìm hiểu và đăng ký hỗ trợ thay vì chờ admin phân công.

### My Matches
Nếu alumni đang có học viên được match, hiển thị danh sách nhanh ở đầu trang với nút điều hướng thẳng đến hồ sơ học viên đó.

### 1. Mentoring Requests
- Feed các học viên đang cần mentor — thông tin **ẩn danh** (không có tên, số điện thoại, email)
- Hiển thị: vị trí cần mentor, kỳ học, MBTI, mô tả brief, danh sách skill gaps
- Nút **"Tôi muốn hỗ trợ"** — alumni tự đăng ký quan tâm; admin thấy danh sách và quyết định kết nối
- Sau khi đăng ký: nút **"Xem hồ sơ"** xuất hiện để xem chi tiết học viên (giới hạn, không có liên lạc)

### 2. Gói hỗ trợ
Các cơ hội đóng góp và nhận hỗ trợ đang mở:
- Học bổng kỹ năng nâng cao
- Sự kiện networking alumni
- Workshop giảng viên khách mời
- Quỹ khẩn cấp học viên
- Tài trợ đồng phục & dụng cụ

### 3. Cập nhật từ KOTO
Tin tức, thành tựu, chương trình và sự kiện từ tổ chức — có thể mở rộng để đọc thêm.

### 4. Vinh danh Alumni
Top alumni được ghi nhận theo từng hạng mục:
- 🏆 Top Mentor — số lượng và chất lượng mentoring
- 🚀 Placement Hero — tỷ lệ đặt học viên thành công
- 🌱 Community Builder — đóng góp cộng đồng
- ⭐ Rising Star — tân binh nổi bật

---

## 7. Quản lý Nội dung

Dành cho Admin và Teacher quản lý bài đăng trên website KOTO và mạng xã hội.

- Lọc theo trạng thái: **Draft / Scheduled / Published**
- Tìm kiếm, lọc theo danh mục (Story, News, Event, Alumni…)
- Editor toàn màn hình: viết bài + sidebar cài đặt platform, ngày đăng
- Quick Templates có sẵn kèm **bài tri ân alumni** theo tinh thần Know One Teach One

---

## 8. Cài đặt Đào tạo

*(Chỉ Admin)*

Quản lý vị trí đào tạo và danh sách kỹ năng tương ứng:

| Vị trí | Kỹ năng | Ngưỡng tốt nghiệp |
|---|---|---|
| Front of House | 7 | 70/100 |
| Kitchen & Culinary | 7 | 75/100 |
| Barista & Beverage | 7 | 70/100 |
| Events & Catering | 6 | 70/100 |

Thêm / sửa / xoá vị trí và kỹ năng. Mỗi kỹ năng có tên, mô tả, nhóm category và điểm tối đa.

---

## 9. Dữ liệu mẫu

| Loại | Số lượng |
|---|---|
| Học viên | 34 (các kỳ từ 2023A đến 2025A) |
| Cựu học viên | 10 (kỳ từ 2018A đến 2021B) |
| Matching records | 21 (trải từ 2023 đến 9/2026) |
| Mentoring requests | 5 (ẩn danh trong Alumni Portal) |
| Gói hỗ trợ | 5 |
| Bài đăng nội dung | 4 |

Mỗi học viên có: kỹ năng đã chấm điểm, MBTI, personality traits, định hướng nghề nghiệp, danh sách lớp đào tạo đã tham gia.

Mỗi alumni có: tiểu sử, quá trình làm việc, chứng chỉ & giải thưởng, lĩnh vực mentor, số học viên đã hỗ trợ.

---

## 10. Công nghệ

| Thành phần | Chi tiết |
|---|---|
| Framework | React 19 + TypeScript 5.7 |
| Build tool | Vite 8 |
| Styling | Tailwind CSS v4 |
| Charts | Recharts 3.10 |
| Fonts | Plus Jakarta Sans · DM Serif Display |
| State | React `useState` — client-side only, không có backend |
| Routing | State-based (không dùng react-router) |

**Lưu ý triển khai thực tế**: toàn bộ dữ liệu hiện là mock data. Để đưa vào sản xuất cần bổ sung authentication, database (Supabase/PostgreSQL), email API cho placement review form, và file upload cho ảnh học viên.

---

*KOTO Vietnam — "Know One, Teach One" — Hà Nội, từ năm 2000*
