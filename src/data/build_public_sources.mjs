/* ---------------------------------------------------------------------------
 * Đưa NGUỒN GỐC ra public/nguon/ để mở trực tiếp trên web (link ở tab Giới thiệu):
 *   - File PDF đề gốc
 *   - 7 trang HTML quiz theo chương (Chương 1 là fragment → bọc thành trang đầy đủ)
 *
 * Chạy lại khi nguồn thay đổi:  node src/data/build_public_sources.mjs
 * ------------------------------------------------------------------------- */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'Data')
const OUT_DIR = path.join(__dirname, '..', '..', 'public', 'nguon')

const PDF_SRC = path.join(__dirname, 'cau-hoi-trac-nghiem-tam-ly-hoc-dai-cuong-vieclamvui_2.pdf')
const PDF_OUT = 'de-goc-cau-hoi-trac-nghiem.pdf'

// nguồn HTML → tên file xuất ra public/nguon/
const HTML = [
  { rel: 'Chương 1/quiz_chuong_1_tam_ly_dai_cuong.html',           out: 'chuong-1.html',                title: 'Chương 1 — Tâm lý học là một khoa học (40 câu)' },
  { rel: 'Chương 1/quiz_tinh_huong_bo_sung_chuong_1.html',         out: 'chuong-1-tinh-huong.html',     title: 'Chương 1 — 10 tình huống bổ sung' },
  { rel: 'Chương 2/Quiz_Chuong_2_kho_hon.html',                    out: 'chuong-2.html',                title: 'Chương 2 — Cơ sở tự nhiên & xã hội (100 câu)' },
  { rel: 'Chương 3/Quiz_NhanThucLyTinh_TriNho_90cau.html',         out: 'chuong-3.html',                title: 'Chương 3 — Nhận thức lý tính & Trí nhớ (90 câu)' },
  { rel: 'Chương 4/On_tap_Chuong_4_Ngon_ngu_va_Giao_tiep.html',    out: 'chuong-4.html',                title: 'Chương 4 — Ngôn ngữ và Giao tiếp (60 câu)' },
  { rel: 'Chương 5/Quiz_Chuong5_Nhancach_Ychi.html',               out: 'chuong-5-nhan-cach-y-chi.html', title: 'Chương 5 — Nhân cách & Ý chí (100 câu)' },
  { rel: 'Chương 5/Quiz_Chuong5_XucCam_TinhCam_SaiLechHanhVi.html', out: 'chuong-5-xuc-cam-tinh-cam.html', title: 'Chương 5 — Xúc cảm, Tình cảm, Sai lệch hành vi (77 câu)' },
]

// bọc fragment (Chương 1) thành trang HTML đầy đủ, cấp các biến thiết kế còn thiếu
const wrap = (fragment, title) => `<!doctype html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600&family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --font-sans:"Be Vietnam Pro",system-ui,sans-serif;
    --color-text-primary:#16203B; --color-text-secondary:#5C6679;
    --color-text-info:#1F7A8C; --color-text-success:#2F8F5B; --color-text-danger:#C0453B;
    --color-background-secondary:#F2F4F7; --color-background-info:#E6F2F4;
    --color-background-success:#E8F5EE; --color-background-danger:#FBEBE9;
    --color-border-success:#A9DCC0; --color-border-danger:#E6BBB5;
    --border-radius-md:10px;
  }
  *{box-sizing:border-box}
  body{font-family:var(--font-sans);background:#EEF1F4;color:var(--color-text-primary);margin:0;padding:26px 16px 60px;line-height:1.55}
  #quiz-root{max-width:680px;margin:0 auto;background:#fff;border:1px solid #E2E6EC;border-radius:16px;padding:24px 22px;box-shadow:0 8px 28px rgba(20,30,55,.07)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
  button{font:inherit;font-weight:600;cursor:pointer;border:1.5px solid #E2E6EC;background:#fff;color:var(--color-text-primary);border-radius:var(--border-radius-md);padding:10px 15px;transition:border-color .15s,background .15s}
  button:hover{border-color:var(--color-text-info)}
  h1.page-title{max-width:680px;margin:0 auto 14px;font-family:"Lora",Georgia,serif;font-weight:600;font-size:1.3rem;color:#16203B}
</style>
</head>
<body>
<h1 class="page-title">${title}</h1>
${fragment}
</body>
</html>
`

fs.mkdirSync(OUT_DIR, { recursive: true })

// PDF
if (fs.existsSync(PDF_SRC)) { fs.copyFileSync(PDF_SRC, path.join(OUT_DIR, PDF_OUT)); console.log('✓ PDF →', PDF_OUT) }
else console.log('⚠ Không thấy PDF:', PDF_SRC)

// HTML
for (const h of HTML) {
  const raw = fs.readFileSync(path.join(DATA_DIR, h.rel), 'utf8')
  const isFull = /^\s*<!doctype|^\s*<html/i.test(raw)
  const html = isFull ? raw : wrap(raw, h.title)
  fs.writeFileSync(path.join(OUT_DIR, h.out), html, 'utf8')
  console.log(`✓ ${isFull ? 'copy ' : 'bọc  '} ${h.out}`)
}

console.log('\nĐã ghi vào public/nguon/ —', HTML.length, 'trang HTML + 1 PDF.')
