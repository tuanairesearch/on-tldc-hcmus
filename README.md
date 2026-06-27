# Trắc nghiệm Tâm lý học đại cương

> Biên soạn bởi **Bùi Anh Tuấn** — SV khoa Toán – Tin học, 25TTH3, MSSV 25110181.
> Một phần của hệ sinh thái [tuanairesearch.com](https://tuanairesearch.com)
> (`tldc.tuanairesearch.com`). Nội dung soạn cùng AI (Claude Opus), dựa trên giáo trình
> *Tâm lý học đại cương* **Phi lợi nhuận, cho mục đích học tập.**

Ứng dụng web ôn tập trắc nghiệm với **2 bộ câu hỏi tách biệt** (chọn ngay trên trang chủ,
**không bao giờ trộn vào nhau**):

| Bộ | Nguồn | Số câu | Dạng |
|----|-------|--------|------|
| **Đề gốc (tài liệu)** | Trích tự động từ file PDF | 278 | chọn 1 / tổ hợp / ghép nối |
| **Bộ tự soạn (mình + Claude)** | Soạn tay theo Chương 1–5 dựa trên tài liệu | 567 | chọn 1 đáp án + giải thích, có **mức độ** |

Bộ tự soạn chia **3 mức độ** (lọc được trên trang chủ, hiện badge màu trong từng câu):
**0.15đ · Nhận biết** (213) · **0.25đ · Vận dụng** (212) · **0.35đ · Tình huống** (142).
Riêng Chương 1 (file gốc không ghi độ khó) được phân loại thủ công trong
`extract_data_quizzes.mjs` (bảng `CH1_LEVELS`).

Mỗi chương lại chia thành các **phần / chủ đề** chi tiết (ví dụ Chương 3: *Cảm giác ·
Tri giác · Tư duy · Tưởng tượng · Trí nhớ*). Tên phần hiện trên từng câu và ở phần xem
lại; có thể **lọc theo phần** khi chọn đúng 1 chương trên trang chủ.

## Chạy ứng dụng

```bash
npm install
npm run dev      # mở http://localhost:5173
```

Build bản tĩnh: `npm run build` → thư mục `dist/`. Xem thử: `npm run preview`.

## Tính năng

- **3 dạng câu hỏi** đúng theo đề gốc:
  - *Chọn 1 đáp án* (a–d)
  - *Tổ hợp* (liệt kê ý 1–5, chọn tổ hợp a/b/c/d)
  - *Ghép / Điền khuyết* (chọn phương án a–f cho từng chỗ trống)
- Chọn **phạm vi theo chương**, **mức độ**, **phần/chủ đề**, **xáo trộn** câu/đáp án.
- **🎯 Đề thi thử**: bốc ngẫu nhiên **40 câu** thành một đề hoàn chỉnh, chấm **thang 10đ**.
  Bộ tự soạn dùng cơ cấu mức độ (10×0.15 + 20×0.25 + 10×0.35 = 10đ); đề gốc dùng
  40 câu × 0.25đ. Đề thi thử **theo đúng nguồn đang chọn** (phân biệt câu mình tạo / câu của file).
- **Chấm & giải thích ngay** từng câu, hoặc chấm cuối bài.
- Thanh tiến độ, lưới câu hỏi để nhảy nhanh, đánh dấu ★ câu cần xem lại.
- Phím tắt: `1–6` chọn đáp án, `←/→` chuyển câu, `Enter` kiểm tra / câu sau.
- Màn hình kết quả + xem lại đáp án; lưu lịch sử điểm bằng `localStorage`.

## Dữ liệu

| File | Vai trò |
|------|---------|
| `src/data/cau-hoi-...pdf` | **Đề gốc** (font cũ TCVN3) |
| `src/data/questions.json` | Bộ **đề gốc** đã chuẩn hoá (278 câu) |
| `src/data/extract_questions.py` | Script trích xuất PDF → `questions.json` |
| `src/data/Data/Chương 1–5/*.html` | Bộ **tự soạn** gốc (mỗi file một quiz HTML) |
| `src/data/questions-extra.json` | Bộ **tự soạn** đã gộp & chuẩn hoá (567 câu) |
| `src/data/extract_data_quizzes.mjs` | Script gộp các quiz HTML → `questions-extra.json` |
| `src/data/build_public_sources.mjs` | Đưa PDF + 8 trang quiz HTML ra `public/nguon/` để truy cập trực tiếp |
| `public/nguon/*` | Nguồn công khai: PDF đề gốc + trang quiz từng chương (link ở tab Giới thiệu) |

> Hai bộ là hai nguồn riêng. App load song song và cho chọn từng bộ, giữ tách biệt
> hoàn toàn — số câu, danh sách chương, kết quả đều theo bộ đang chọn.

Soạn lại bộ tự soạn / cập nhật nguồn công khai sau khi sửa file HTML trong `Data/`:

```bash
node src/data/extract_data_quizzes.mjs    # gộp lại bộ tự soạn (problems: 0 là khớp hết)
node src/data/build_public_sources.mjs    # cập nhật public/nguon/ (PDF + 8 trang quiz)
```

### Trích xuất lại dữ liệu (tuỳ chọn)

PDF dùng layout 2 cột phức tạp nên script đọc theo **toạ độ** từng dòng (PyMuPDF):

```bash
pip install PyMuPDF
cd src/data && python extract_questions.py
```

Script tự nhận diện chương, 3 dạng câu hỏi, gộp các hộp lựa chọn bị tách cột, xử lý
các trường hợp đặc biệt (đáp án thiếu dấu chấm, nhãn "Câu N" lệch vị trí…) và in báo
cáo kiểm tra (`problems: 0` nghĩa là mọi đáp án đều khớp với danh sách lựa chọn).
