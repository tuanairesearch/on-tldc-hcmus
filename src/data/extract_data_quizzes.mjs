/* ---------------------------------------------------------------------------
 * Trích xuất bộ câu hỏi TỰ SOẠN (mình + Claude) từ các file HTML trong Data/
 * → src/data/questions-extra.json
 *
 * Bộ này TÁCH RIÊNG với questions.json (đề gốc trích từ PDF tài liệu).
 * Mỗi file HTML chứa một mảng JS literal (QS / QS2 / QUESTIONS / DATA) với
 * tên trường khác nhau; script chuẩn hoá tất cả về một dạng "single".
 * ------------------------------------------------------------------------- */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'Data')

// file → (chương trong BỘ TỰ SOẠN, tiêu đề chương)
const FILES = [
  { rel: 'Chương 1/quiz_chuong_1_tam_ly_dai_cuong.html',        chapter: 1, title: 'Tâm lý học là một khoa học' },
  { rel: 'Chương 1/quiz_tinh_huong_bo_sung_chuong_1.html',      chapter: 1, title: 'Tâm lý học là một khoa học' },
  { rel: 'Chương 2/Quiz_Chuong_2_kho_hon.html',                 chapter: 2, title: 'Cơ sở tự nhiên & xã hội của tâm lý' },
  { rel: 'Chương 3/Chương 3 mới bổ sung phần đầu.html',         chapter: 3, title: 'Hoạt động nhận thức & Trí nhớ' },
  { rel: 'Chương 3/Quiz_NhanThucLyTinh_TriNho_90cau.html',      chapter: 3, title: 'Hoạt động nhận thức & Trí nhớ' },
  { rel: 'Chương 4/On_tap_Chuong_4_Ngon_ngu_va_Giao_tiep.html', chapter: 4, title: 'Ngôn ngữ và Giao tiếp' },
  { rel: 'Chương 5/Quiz_Chuong5_Nhancach_Ychi.html',            chapter: 5, title: 'Nhân cách, Ý chí, Xúc cảm – Tình cảm' },
  { rel: 'Chương 5/Quiz_Chuong5_XucCam_TinhCam_SaiLechHanhVi.html', chapter: 5, title: 'Nhân cách, Ý chí, Xúc cảm – Tình cảm' },
]

// Chương 1 (2 file gốc không ghi sẵn độ khó) → phân loại thủ công theo THỨ TỰ câu
// trong từng file. 15 = Nhận biết · 25 = Vận dụng · 35 = Tình huống.
const CH1_LEVELS = {
  'Chương 1/quiz_chuong_1_tam_ly_dai_cuong.html': [
    15, 15, 15, 15, 15, 15, 15, 15, 25, 25, // 1–10  lược sử/khái niệm
    15, 15, 15, 15, 15, 25, 35, 15, 15, 15, // 11–20 đối tượng/bản chất/chức năng
    15, 15, 15, 15, 15, 15, 25, 25, 15, 25, // 21–30 phân loại (định nghĩa + nhận diện)
    15, 15, 15, 25, 25, 35, 35, 35, 35, 35, // 31–40 phân loại + 5 tình huống cuối
  ],
  // toàn bộ là bài tập tình huống
  'Chương 1/quiz_tinh_huong_bo_sung_chuong_1.html': [35, 35, 35, 35, 35, 35, 35, 35, 35, 35],
}

// quét literal cân bằng ngoặc (mảng [ ] hoặc object { }), nhận biết chuỗi '...' "..." `...`
function sliceBalanced(src, openIdx, open, close) {
  let depth = 0, str = null, esc = false
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (str) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === str) str = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { str = ch; continue }
    if (ch === open) depth++
    else if (ch === close) { depth--; if (depth === 0) return src.slice(openIdx, i + 1) }
  }
  throw new Error('Không tìm thấy ngoặc đóng ' + close)
}

function arraysFrom(src) {
  const out = []
  const re = /const\s+\w+\s*=\s*\[/g
  let m
  while ((m = re.exec(src))) {
    const openIdx = src.indexOf('[', m.index)
    const text = sliceBalanced(src, openIdx, '[', ']')
    let arr
    try { arr = new Function('return (' + text + ')')() } catch { continue }
    if (Array.isArray(arr) && arr.length) out.push(arr)
  }
  return out
}

// bảng SECTIONS ánh xạ mã phần → tên đầy đủ (giá trị có thể là chuỗi hoặc {name,grp})
function sectionMap(src) {
  const m = /const\s+SECTIONS\s*=\s*\{/.exec(src)
  if (!m) return {}
  const openIdx = src.indexOf('{', m.index)
  let obj
  try { obj = new Function('return (' + sliceBalanced(src, openIdx, '{', '}') + ')')() } catch { return {} }
  const out = {}
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' ? v : (v && v.name) || k
  return out
}
// tên phần: title (Ch4) → tra mã trong SECTIONS → s (đã là tên) → p
function resolveSection(raw, secs) {
  if (raw.title) return String(raw.title).trim()
  if (raw.s != null && secs[raw.s]) return secs[raw.s]
  if (raw.s != null) return String(raw.s).trim()
  if (raw.p != null) return String(raw.p).trim()
  return ''
}

const LETTERS = 'abcdefghij'
const pickStem  = (o) => o.q
const pickIndex = (o) => (o.c ?? o.a)
const pickExpl  = (o) => o.e ?? o.f ?? o.fb ?? ''
// mức độ: d="0.15"/"0.25"/"0.35" (Ch2,3) hoặc t=15/25/35 / t="0.15" (Ch4,5); Ch1 không có
function pickLevel(o) {
  let v = o.d ?? o.t
  if (v == null || v === '') return null
  v = parseFloat(String(v))
  if (!isFinite(v) || v === 0) return null
  if (v >= 1) v = v / 100          // 15 → 0.15
  return v.toFixed(2)              // "0.15" | "0.25" | "0.35"
}

function normalize(raw, ctx) {
  const stem = pickStem(raw)
  const idx = pickIndex(raw)
  if (stem == null || idx == null || !Array.isArray(raw.o)) return null
  return {
    id: ctx.next(),
    chapter: ctx.chapter,
    chapterTitle: ctx.title,
    source: 'soan',
    section: resolveSection(raw, ctx.secs),
    level: pickLevel(raw),
    type: 'single',
    stem: String(stem).trim(),
    options: raw.o.map((text, i) => ({ key: LETTERS[i], text: String(text).trim() })),
    answer: [LETTERS[idx]],
    explain: String(pickExpl(raw)).trim(),
  }
}

// gom mọi object câu hỏi: phẳng {q,...} hoặc lồng {title, questions:[...]}
function* questionObjects(arr) {
  for (const el of arr) {
    if (el && Array.isArray(el.questions)) {
      for (const q of el.questions) yield { ...q, title: el.title }
    } else if (el && el.q != null) {
      yield el
    }
  }
}

let id = 0
const ctxNext = () => ++id
const all = []
const report = []

for (const f of FILES) {
  const src = fs.readFileSync(path.join(DATA_DIR, f.rel), 'utf8')
  const arrays = arraysFrom(src)
  const secs = sectionMap(src)
  const override = CH1_LEVELS[f.rel]
  let count = 0, fi = 0
  for (const arr of arrays) {
    for (const raw of questionObjects(arr)) {
      const q = normalize(raw, { chapter: f.chapter, title: f.title, secs, next: ctxNext })
      if (q) {
        // gán độ khó cho Chương 1 (file gốc không có) theo thứ tự câu
        if (q.level == null && override && override[fi] != null) q.level = (override[fi] / 100).toFixed(2)
        all.push(q); count++
      }
      fi++
    }
  }
  if (override && fi !== override.length) console.log(`  ⚠ ${f.rel}: ${fi} câu nhưng bảng độ khó có ${override.length} mục — kiểm tra lại!`)
  report.push({ file: f.rel, chapter: f.chapter, count })
}

fs.writeFileSync(path.join(__dirname, 'questions-extra.json'), JSON.stringify(all, null, 2), 'utf8')

// ---- báo cáo kiểm tra --------------------------------------------------------
const byCh = new Map()
for (const q of all) byCh.set(q.chapter, (byCh.get(q.chapter) || 0) + 1)
console.log('Đã ghi questions-extra.json —', all.length, 'câu (bộ TỰ SOẠN)\n')
for (const r of report) console.log(`  ${r.count.toString().padStart(3)} câu  ${r.file}`)
console.log('\nTheo chương:')
for (const [c, n] of [...byCh].sort((a, b) => a[0] - b[0])) console.log(`  Chương ${c}: ${n} câu`)

const LV = { '0.15': 'Nhận biết', '0.25': 'Vận dụng', '0.35': 'Tình huống' }
const byLv = new Map()
for (const q of all) byLv.set(q.level, (byLv.get(q.level) || 0) + 1)
console.log('\nTheo mức độ:')
for (const k of ['0.15', '0.25', '0.35', null]) {
  if (byLv.has(k)) console.log(`  ${k ? k + 'đ · ' + LV[k] : '(không phân mức – Chương 1)'}: ${byLv.get(k)} câu`)
}

console.log('\nCác phần (mục chi tiết) theo chương:')
const seen = new Map() // chapter -> Map(section -> count)
for (const q of all) {
  if (!seen.has(q.chapter)) seen.set(q.chapter, new Map())
  const s = q.section || '(không tên)'
  seen.get(q.chapter).set(s, (seen.get(q.chapter).get(s) || 0) + 1)
}
for (const [c, secs] of [...seen].sort((a, b) => a[0] - b[0])) {
  console.log(`  Chương ${c}:`)
  for (const [s, n] of secs) console.log(`      • ${s} (${n})`)
}
const noSec = all.filter((q) => !q.section).length
console.log('\ncâu thiếu tên phần:', noSec)

// kiểm tra tính hợp lệ
let bad = 0
for (const q of all) {
  const keys = q.options.map((o) => o.key)
  if (!q.answer.every((k) => keys.includes(k))) { bad++; if (bad <= 5) console.log('  ⚠ đáp án lệch:', q.id, q.stem.slice(0, 50)) }
  if (q.options.length < 2) { bad++; if (bad <= 5) console.log('  ⚠ thiếu lựa chọn:', q.id) }
}
console.log('\nproblems:', bad)
