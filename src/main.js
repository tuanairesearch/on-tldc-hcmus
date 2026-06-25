import './style.css'
import docQuestions from './data/questions.json'
import dataQuestions from './data/questions-extra.json'

/* ----------------------------------------------------------------------------
 * Trắc nghiệm Tâm lý học đại cương — quiz app (vanilla JS)
 *
 * HAI BỘ CÂU HỎI TÁCH BIỆT (không bao giờ trộn vào nhau):
 *   'tailieu' — đề gốc trích từ PDF tài liệu  (questions.json)
 *   'soan'    — bộ tự soạn (mình + Claude) theo Chương 1–5 (questions-extra.json)
 *
 * Question types:
 *   single : choose one of a..e        answer: ["x"]
 *   combo  : statements 1..n + options a..d (number combos)  answer: ["x"]
 *   match  : cloze / Cột A–B, options a..f, one option per blank
 *            answer: [{blank, key}, ...]
 * ------------------------------------------------------------------------- */

const TYPE_LABEL = { single: 'Chọn 1 đáp án', combo: 'Tổ hợp', match: 'Ghép / Điền khuyết' }
const LS_KEY = 'tldc.settings.v1'
const LS_SCORE = 'tldc.scores.v1'
const LS_UNLOCK = 'tldc.unlock.v1'

// ⚠ MÃ BÍ MẬT để mở "đề gốc" (chỉ ẩn ở giao diện, KHÔNG phải bảo mật thật).
//    Đổi chuỗi dưới đây thành mã của riêng bạn.
const UNLOCK_CODE = 'btuan-goc'
// nguồn bị ẩn cho người dùng thường; chỉ hiện sau khi nhập đúng mã
const HIDDEN_SOURCES = ['tailieu']

// ---- chapter metadata derived from a question set --------------------------
function buildChapters(qs) {
  const chs = []
  for (const q of qs) {
    let c = chs.find((x) => x.id === q.chapter)
    if (!c) { c = { id: q.chapter, title: q.chapterTitle, count: 0 }; chs.push(c) }
    c.count++
  }
  return chs.sort((a, b) => a.id - b.id)
}

// ---- hai nguồn câu hỏi riêng biệt ------------------------------------------
const SOURCES = {
  tailieu: {
    id: 'tailieu',
    label: 'Đề gốc (tài liệu)',
    desc: 'Trích tự động từ PDF · chọn 1 / tổ hợp / ghép nối',
    questions: docQuestions,
    chapters: buildChapters(docQuestions),
  },
  soan: {
    id: 'soan',
    label: 'Bộ tự soạn (mình + Claude)',
    desc: 'Soạn theo Chương 1–5 · chọn 1 đáp án + giải thích',
    questions: dataQuestions,
    chapters: buildChapters(dataQuestions),
  },
}
const DEFAULT_SOURCE = 'tailieu'
const getSource = (id) => SOURCES[id] || SOURCES[DEFAULT_SOURCE]

// ---- mức độ (chỉ bộ tự soạn mới có) ----------------------------------------
const LEVELS = [
  { id: '0.15', label: 'Nhận biết', cls: 'lv15' },
  { id: '0.25', label: 'Vận dụng', cls: 'lv25' },
  { id: '0.35', label: 'Tình huống', cls: 'lv35' },
]
const LEVEL_LABEL = Object.fromEntries(LEVELS.map((l) => [l.id, l.label]))
const LEVEL_CLS = Object.fromEntries(LEVELS.map((l) => [l.id, l.cls]))

// ---- đề thi thử: 40 câu, điểm = mức độ, tổng đúng 10 -----------------------
const LEVEL_POINTS = { '0.15': 0.15, '0.25': 0.25, '0.35': 0.35 }
const EXAM_SIZE = 40
// 10×0.15 + 20×0.25 + 10×0.35 = 10đ (bộ có phân mức)
const EXAM_COMPOSITION = { '0.15': 10, '0.25': 20, '0.35': 10 }
const EXAM_FLAT_POINTS = 10 / EXAM_SIZE // 0.25đ/câu cho bộ không phân mức (đề gốc)

// danh sách các phần (chủ đề) của một chương, giữ đúng thứ tự xuất hiện
function sectionsOf(questions, chapterId) {
  const order = []
  const count = new Map()
  for (const q of questions) {
    if (q.chapter !== chapterId || !q.section) continue
    if (!count.has(q.section)) order.push(q.section)
    count.set(q.section, (count.get(q.section) || 0) + 1)
  }
  return order.map((name) => ({ name, count: count.get(name) }))
}

// ---- app state -------------------------------------------------------------
const app = document.querySelector('#app')
let state = { screen: 'home', session: null, source: DEFAULT_SOURCE }

const loadSettings = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
}
const saveSettings = (s) => localStorage.setItem(LS_KEY, JSON.stringify(s))
const loadScores = () => {
  try { return JSON.parse(localStorage.getItem(LS_SCORE)) || [] } catch { return [] }
}

// ---- khoá / mở "đề gốc" ----------------------------------------------------
const isUnlocked = () => { try { return localStorage.getItem(LS_UNLOCK) === '1' } catch { return false } }
const setUnlocked = (v) => {
  try { v ? localStorage.setItem(LS_UNLOCK, '1') : localStorage.removeItem(LS_UNLOCK) } catch { /* ignore */ }
}
// các bộ câu hỏi đang hiển thị (ẩn 'tailieu' khi chưa mở khoá)
const visibleSources = () =>
  Object.values(SOURCES).filter((s) => isUnlocked() || !HIDDEN_SOURCES.includes(s.id))
// hỏi mã & mở khoá; trả về true nếu trạng thái khoá thay đổi
const promptUnlock = () => {
  if (isUnlocked()) {
    if (confirm('Khoá lại đề gốc? Giao diện sẽ chỉ còn bộ tự soạn.')) { setUnlocked(false); return true }
    return false
  }
  const code = prompt('Nhập mã để mở đề gốc:')
  if (code == null) return false
  if (code.trim() === UNLOCK_CODE) { setUnlocked(true); return true }
  alert('Mã không đúng.')
  return false
}

// ---- utilities -------------------------------------------------------------
const shuffle = (arr) => {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// answer correctness ---------------------------------------------------------
function isCorrect(q, ans) {
  if (ans == null) return false
  if (q.type === 'match') {
    if (typeof ans !== 'object') return false
    return q.answer.every((a) => ans[a.blank] === a.key) &&
      Object.keys(ans).length === q.answer.length
  }
  return q.answer.includes(ans)
}
// 0..1 partial score (match gives partial credit per blank)
function score(q, ans) {
  if (ans == null) return 0
  if (q.type === 'match') {
    if (typeof ans !== 'object') return 0
    const ok = q.answer.filter((a) => ans[a.blank] === a.key).length
    return ok / q.answer.length
  }
  return q.answer.includes(ans) ? 1 : 0
}

// =====================================================================
// HOME
// =====================================================================
function renderHome() {
  const saved = loadSettings()
  const sources = visibleSources()
  // khi đang khoá mà nguồn hiện tại bị ẩn → quay về bộ tự soạn
  if (!sources.some((s) => s.id === state.source)) state.source = sources[0].id
  const showPicker = sources.length > 1
  const src = getSource(state.source)
  const sameSaved = saved.source === src.id
  const chapters = src.chapters
  const selected = new Set(
    sameSaved && saved.chapters && saved.chapters.length
      ? saved.chapters
      : chapters.map((c) => c.id),
  )
  const total = src.questions.length

  // mức độ: chỉ hiện khi bộ đang chọn có câu phân mức (bộ tự soạn)
  const lvCount = Object.fromEntries(LEVELS.map((l) => [l.id, src.questions.filter((q) => q.level === l.id).length]))
  const hasLevels = LEVELS.some((l) => lvCount[l.id] > 0)
  const hasSections = src.questions.some((q) => q.section)
  const selLevels = new Set(
    sameSaved && Array.isArray(saved.levels) && saved.levels.length
      ? saved.levels
      : LEVELS.map((l) => l.id),
  )
  const advOpen = saved.adv === true
  const advSummary = [hasLevels && 'mức độ', hasSections && 'phần', 'xáo trộn'].filter(Boolean).join(' · ')

  app.innerHTML = `
  <div class="wrap">
    <nav class="topnav">
      <span class="brand">📖 Tâm lý học đại cương</span>
      <button class="navlink" id="nav-about">Giới thiệu</button>
    </nav>
    <header class="hero">
      <h1>Trắc nghiệm Tâm lý học đại cương</h1>
      <p class="sub">${total} câu · ${chapters.length} chương · <b>${esc(src.label)}</b></p>
    </header>

    <section class="card">
      ${showPicker ? `
      <h2>Bộ câu hỏi</h2>
      <div class="chip-row src-row" id="sources">
        ${sources.map((s) => `
          <label class="srcpill ${s.id === src.id ? 'on' : ''}">
            <input type="radio" name="src" value="${s.id}" ${s.id === src.id ? 'checked' : ''}/>
            <span class="srcttl">${esc(s.label)}</span>
            <span class="srcmeta">${s.questions.length} câu · ${s.chapters.length} chương</span>
            <span class="srcdesc">${esc(s.desc)}</span>
          </label>`).join('')}
      </div>` : ''}

      <h2>Phạm vi · chương</h2>
      <div class="chip-row" id="chapters">
        <label class="chip chip-all">
          <input type="checkbox" id="chk-all" ${selected.size === chapters.length ? 'checked' : ''}/>
          <span>Tất cả</span>
        </label>
        ${chapters.map((c) => `
          <label class="chip">
            <input type="checkbox" class="chk-ch" value="${c.id}" ${selected.has(c.id) ? 'checked' : ''}/>
            <span><b>Chương ${c.id}.</b> ${esc(c.title)} <em>(${c.count})</em></span>
          </label>`).join('')}
      </div>

      <button type="button" class="adv-toggle ${advOpen ? 'open' : ''}" id="adv-toggle" aria-expanded="${advOpen}">
        <span class="adv-ic">⚙</span>
        <span class="adv-label">Tuỳ chọn nâng cao</span>
        <span class="adv-sum">${advSummary}</span>
        <span class="adv-arrow">▸</span>
      </button>

      <div class="adv ${advOpen ? 'open' : ''}" id="adv">
        ${hasLevels ? `
        <h2>Mức độ</h2>
        <div class="chip-row lv-row" id="levels">
          ${LEVELS.map((l) => `
            <label class="pill lvpill ${l.cls}">
              <input type="checkbox" class="chk-lv" value="${l.id}" ${selLevels.has(l.id) ? 'checked' : ''}/>
              <span>${l.id}đ · ${l.label} <em>(${lvCount[l.id]})</em></span>
            </label>`).join('')}
        </div>` : ''}

        ${hasSections ? `
        <h2>Phần (chủ đề)</h2>
        <div class="sec-box" id="sec-box"></div>` : ''}

        <h2>Tuỳ chọn khác</h2>
        <div class="chip-row">
          <label class="pill"><input type="checkbox" id="opt-shuffle" ${saved.shuffle !== false ? 'checked' : ''}/><span>Xáo trộn câu hỏi</span></label>
          <label class="pill"><input type="checkbox" id="opt-shuffleOpt" ${saved.shuffleOpt ? 'checked' : ''}/><span>Xáo trộn đáp án</span></label>
          <label class="pill"><input type="checkbox" id="opt-instant" ${saved.instant !== false ? 'checked' : ''}/><span>Chấm & giải thích ngay</span></label>
        </div>
      </div>

      <div class="actions">
        <button class="btn primary" id="start">Bắt đầu làm bài →</button>
        <span class="count-info" id="count-info"></span>
      </div>

      <div class="exam-cta">
        <button class="btn exam" id="exam">🎯 Tạo đề thi thử</button>
        <span class="exam-note">40 câu ngẫu nhiên · chấm thang <b>10đ</b><br>
          ${hasLevels ? '10×0.15đ + 20×0.25đ + 10×0.35đ' : '40 câu × 0.25đ'} · nguồn: <b>${esc(src.label)}</b></span>
      </div>
    </section>

    ${renderScoreboard()}
    <footer class="foot">
      ${showPicker
      ? 'Hai bộ câu hỏi tách biệt: <b>đề gốc</b> trích từ PDF tài liệu &amp; <b>bộ tự soạn</b> theo Chương 1–5.<br>'
      : 'Bộ câu hỏi tự soạn theo Chương 1–5.<br>'}
      Biên soạn bởi <b>Bùi Anh Tuấn</b> · <a href="https://tuanairesearch.com" target="_blank" rel="noopener">tuanairesearch.com</a> · phi lợi nhuận, cho mục đích học tập.
      <button class="lock-btn" id="lock-btn" title="${isUnlocked() ? 'Đang mở đề gốc — bấm để khoá' : 'Nhập mã'}">${isUnlocked() ? '🔓' : '🔒'}</button>
    </footer>
  </div>`

  // đổi bộ câu hỏi → đặt lại phạm vi về "tất cả" của bộ mới, vẽ lại
  app.querySelectorAll('input[name="src"]').forEach((r) =>
    r.addEventListener('change', () => {
      if (!r.checked) return
      state.source = r.value
      const cur = loadSettings()
      saveSettings({ ...cur, source: r.value, chapters: [] })
      renderHome()
    }))

  // mở tab Giới thiệu
  app.querySelector('#nav-about').addEventListener('click', () => { state.screen = 'about'; renderAbout() })

  // ổ khoá: nhập mã để mở / khoá lại đề gốc
  app.querySelector('#lock-btn').addEventListener('click', () => { if (promptUnlock()) renderHome() })

  // tạo đề thi thử từ bộ đang chọn (giữ phân biệt câu mình tạo / câu của file)
  app.querySelector('#exam').addEventListener('click', () => startExam(src.id))

  // gập / mở "Tuỳ chọn nâng cao"
  const advToggle = app.querySelector('#adv-toggle')
  const adv = app.querySelector('#adv')
  advToggle.addEventListener('click', () => {
    const open = !adv.classList.contains('open')
    adv.classList.toggle('open', open)
    advToggle.classList.toggle('open', open)
    advToggle.setAttribute('aria-expanded', String(open))
    saveSettings({ ...loadSettings(), adv: open })
  })

  // interactions
  const chkAll = app.querySelector('#chk-all')
  const chChecks = [...app.querySelectorAll('.chk-ch')]
  const lvChecks = [...app.querySelectorAll('.chk-lv')]
  const secBox = app.querySelector('#sec-box')
  const info = app.querySelector('#count-info')
  const selectedChapters = () => chChecks.filter((c) => c.checked).map((c) => +c.value)
  const selectedLevels = () => lvChecks.filter((c) => c.checked).map((c) => c.value)
  // lọc phần chỉ bật khi đúng 1 chương được chọn; null = không lọc theo phần
  const selectedSections = () => {
    if (!secBox) return null
    const checks = [...secBox.querySelectorAll('.chk-sec')]
    if (!checks.length) return null
    const on = checks.filter((c) => c.checked).map((c) => c.value)
    return on.length === checks.length ? null : on
  }

  // vẽ lại danh sách phần theo chương đang chọn
  const paintSections = () => {
    if (!secBox) return
    const chosen = selectedChapters()
    if (chosen.length !== 1) {
      secBox.innerHTML = `<div class="sec-hint">Chọn đúng <b>1 chương</b> ở mục trên để lọc theo từng phần.</div>`
      return
    }
    const secs = sectionsOf(src.questions, chosen[0])
    secBox.innerHTML = `
      <label class="chip chip-all sec-all">
        <input type="checkbox" id="chk-sec-all" checked/><span>Tất cả phần</span>
      </label>
      <div class="chip-row sec-row">
        ${secs.map((s) => `
          <label class="pill secpill">
            <input type="checkbox" class="chk-sec" value="${esc(s.name)}" checked/>
            <span>${esc(s.name)} <em>(${s.count})</em></span>
          </label>`).join('')}
      </div>`
    const secAll = secBox.querySelector('#chk-sec-all')
    const secChecks = [...secBox.querySelectorAll('.chk-sec')]
    secAll.addEventListener('change', () => { secChecks.forEach((c) => (c.checked = secAll.checked)); updateInfo() })
    secChecks.forEach((c) => c.addEventListener('change', () => {
      secAll.checked = secChecks.every((x) => x.checked); updateInfo()
    }))
  }

  const updateInfo = () => {
    const avail = filterPool(src.questions, selectedChapters(), selectedLevels(), selectedSections()).length
    info.textContent = `${avail} câu trong phạm vi đã chọn`
    chkAll.checked = chChecks.every((c) => c.checked)
  }
  chkAll.addEventListener('change', () => { chChecks.forEach((c) => (c.checked = chkAll.checked)); paintSections(); updateInfo() })
  chChecks.forEach((c) => c.addEventListener('change', () => { paintSections(); updateInfo() }))
  lvChecks.forEach((c) => c.addEventListener('change', updateInfo))
  paintSections()
  updateInfo()

  app.querySelector('#start').addEventListener('click', () => {
    const chosen = selectedChapters()
    if (!chosen.length) { info.textContent = 'Hãy chọn ít nhất một chương.'; return }
    const levels = selectedLevels()
    if (hasLevels && !levels.length) { info.textContent = 'Hãy chọn ít nhất một mức độ.'; return }
    const sections = selectedSections()
    if (sections && !sections.length) { info.textContent = 'Hãy chọn ít nhất một phần.'; return }
    const cfg = {
      source: src.id,
      chapters: chosen,
      levels,
      sections,
      count: 'all',
      shuffle: app.querySelector('#opt-shuffle').checked,
      shuffleOpt: app.querySelector('#opt-shuffleOpt').checked,
      instant: app.querySelector('#opt-instant').checked,
    }
    saveSettings(cfg)
    startSession(cfg)
  })
}

// =====================================================================
// GIỚI THIỆU (ABOUT)
// =====================================================================
function renderAbout() {
  const year = new Date().getFullYear()
  const unlocked = isUnlocked()
  const B = import.meta.env.BASE_URL // '/' khi deploy ở gốc tên miền
  const link = (file, text) => `<a href="${B}nguon/${file}" target="_blank" rel="noopener">${text}</a>`
  app.innerHTML = `
  <div class="wrap">
    <nav class="topnav">
      <button class="navlink" id="nav-home">← Về ôn tập</button>
      <span class="brand">Giới thiệu</span>
    </nav>

    <section class="card about">
      <div class="about-head">
        <div class="about-ava">BAT</div>
        <div>
          <div class="about-name">Bùi Anh Tuấn</div>
          <div class="about-role">Sinh viên khoa Toán – Tin học · Lớp 25TTH3 · MSSV 25110181</div>
        </div>
      </div>

      <h2>Về dự án</h2>
      <p>Web ôn tập trắc nghiệm <b>Tâm lý học đại cương</b> — biên soạn nội dung cùng AI (Claude Opus).</p>
      <p>Là một phần của hệ sinh thái
        <a href="https://tuanairesearch.com" target="_blank" rel="noopener">tuanairesearch.com</a>,
        truy cập tại <a href="https://tldc.tuanairesearch.com" target="_blank" rel="noopener">tldc.tuanairesearch.com</a>.</p>

      <h2>Nguồn tài liệu</h2>
      <p>Nội dung soạn dựa trên giáo trình <i>Tâm lý học đại cương</i> của
        <b>ThS. Trần Hương Thảo</b> <span class="muted"></span>.</p>

      <h2>Các trang quiz theo chương</h2>
      ${unlocked ? `<p>📄 ${link('de-goc-cau-hoi-trac-nghiem.pdf', 'Đề gốc (PDF) — 278 câu trắc nghiệm')}</p>` : ''}
      <ul class="src-list">
        <li><b>Chương 1:</b> ${link('chuong-1.html', '40 câu lý thuyết')} · ${link('chuong-1-tinh-huong.html', '10 tình huống bổ sung')}</li>
        <li><b>Chương 2:</b> ${link('chuong-2.html', 'Cơ sở tự nhiên & xã hội (100 câu)')}</li>
        <li><b>Chương 3:</b> ${link('chuong-3.html', 'Nhận thức lý tính & Trí nhớ (90 câu)')}</li>
        <li><b>Chương 4:</b> ${link('chuong-4.html', 'Ngôn ngữ và Giao tiếp (60 câu)')}</li>
        <li><b>Chương 5:</b> ${link('chuong-5-nhan-cach-y-chi.html', 'Nhân cách & Ý chí (100 câu)')} · ${link('chuong-5-xuc-cam-tinh-cam.html', 'Xúc cảm – Tình cảm (77 câu)')}</li>
      </ul>

      <h2>Bản quyền</h2>
      <p>Phi lợi nhuận · Dùng cho <b>mục đích học tập</b>.</p>

      <div class="about-links">
        <a class="btn primary" href="https://tuanairesearch.com" target="_blank" rel="noopener">🌐 tuanairesearch.com</a>
        <button class="btn ghost" id="about-back">← Quay lại ôn tập</button>
      </div>
    </section>

    <footer class="foot">© ${year} Bùi Anh Tuấn · tuanairesearch.com · phi lợi nhuận, cho mục đích học tập.
      <button class="lock-btn" id="lock-btn" title="${unlocked ? 'Đang mở đề gốc — bấm để khoá' : 'Nhập mã'}">${unlocked ? '🔓' : '🔒'}</button>
    </footer>
  </div>`

  const home = () => { state.screen = 'home'; renderHome() }
  app.querySelector('#nav-home').addEventListener('click', home)
  app.querySelector('#about-back').addEventListener('click', home)
  app.querySelector('#lock-btn').addEventListener('click', () => { if (promptUnlock()) renderAbout() })
}

function renderScoreboard() {
  const scores = loadScores().slice(-5).reverse()
  if (!scores.length) return ''
  return `
  <section class="card">
    <h2>Kết quả gần đây</h2>
    <div class="history">
      ${scores.map((s) => {
        const exam = s.exam && s.score10 != null
        const cls = exam ? (s.score10 >= 8 ? 'good' : s.score10 >= 5 ? 'mid' : 'bad')
          : (s.pct >= 80 ? 'good' : s.pct >= 50 ? 'mid' : 'bad')
        const val = exam ? `${s.score10}<small>/10</small>` : `${s.pct}%`
        return `
        <div class="hist-row">
          <span class="hist-pct ${cls}">${val}</span>
          <span>${s.correct}/${s.total} câu${exam ? ' · 🎯 thi thử' : ''}</span>
          <span class="muted">${new Date(s.at).toLocaleString('vi-VN')}</span>
        </div>`
      }).join('')}
    </div>
  </section>`
}

// =====================================================================
// SESSION
// =====================================================================
// lọc theo chương + mức độ. Chọn đủ cả 3 mức (hoặc bộ không có mức) = không lọc
// theo mức → câu không phân mức (Chương 1) vẫn được giữ.
function filterPool(questions, chapterIds, levels, sections) {
  const chSet = new Set(chapterIds)
  const filterByLevel = Array.isArray(levels) && levels.length && levels.length < LEVELS.length
  const lvSet = new Set(levels || [])
  const secSet = Array.isArray(sections) ? new Set(sections) : null
  return questions.filter((q) =>
    chSet.has(q.chapter) &&
    (!filterByLevel || lvSet.has(q.level)) &&
    (!secSet || secSet.has(q.section)))
}

function startSession(cfg) {
  let pool = filterPool(getSource(cfg.source).questions, cfg.chapters, cfg.levels, cfg.sections)
  if (cfg.shuffle) pool = shuffle(pool)
  else pool = pool.slice().sort((a, b) => a.id - b.id)
  if (cfg.count !== 'all') pool = pool.slice(0, cfg.count)

  // optionally shuffle options (only single/match keep mapping via key)
  const items = pool.map((q) => {
    let opts = q.options
    if (cfg.shuffleOpt && (q.type === 'single' || q.type === 'match')) opts = shuffle(q.options)
    return { q, opts }
  })

  state.session = { cfg, items, idx: 0, answers: {}, checked: {}, flags: {}, finished: false }
  state.screen = 'quiz'
  renderQuiz()
}

// bốc ngẫu nhiên 40 câu thành một đề hoàn chỉnh (10đ), GIỮ NGUYÊN nguồn đã chọn
function buildExamItems(sourceId) {
  const src = getSource(sourceId)
  const hasLv = src.questions.some((q) => q.level)
  let pool = []
  if (hasLv) {
    // bốc theo cơ cấu mức độ để cộng đúng 10đ
    for (const [lv, need] of Object.entries(EXAM_COMPOSITION)) {
      pool.push(...shuffle(src.questions.filter((q) => q.level === lv)).slice(0, need))
    }
    if (pool.length < EXAM_SIZE) { // dự phòng nếu một mức thiếu câu
      const used = new Set(pool.map((q) => q.id))
      pool.push(...shuffle(src.questions.filter((q) => !used.has(q.id))).slice(0, EXAM_SIZE - pool.length))
    }
  } else {
    pool = shuffle(src.questions).slice(0, EXAM_SIZE) // đề gốc: 40 câu bất kỳ, điểm đều nhau
  }
  pool = shuffle(pool)
  return pool.map((q) => ({ q, opts: q.options, points: q.level ? LEVEL_POINTS[q.level] : EXAM_FLAT_POINTS }))
}

function startExam(sourceId) {
  const items = buildExamItems(sourceId)
  state.session = {
    cfg: { source: sourceId, mode: 'exam', instant: false },
    items, idx: 0, answers: {}, checked: {}, flags: {}, finished: false,
  }
  state.screen = 'quiz'
  renderQuiz()
}

// =====================================================================
// QUIZ
// =====================================================================
function renderQuiz() {
  const s = state.session
  const it = s.items[s.idx]
  const { q, opts } = it
  const exam = s.cfg.mode === 'exam'
  const n = s.items.length
  const answered = Object.keys(s.answers).filter((k) => s.answers[k] != null).length
  const done = s.cfg.instant ? Object.keys(s.checked).length : answered

  app.innerHTML = `
  <div class="wrap quiz">
    <div class="topbar">
      <button class="btn ghost small" id="quit">← Thoát</button>
      <div class="progress"><div class="bar" style="width:${(done / n) * 100}%"></div></div>
      <div class="counter">Câu <b>${s.idx + 1}</b>/${n}</div>
    </div>

    <article class="card question">
      <div class="qmeta">
        ${exam ? `<span class="tag tag-exam">🎯 Thi thử</span>` : ''}
        <span class="tag tag-ch">Chương ${q.chapter}</span>
        ${q.level ? `<span class="tag tag-lv ${LEVEL_CLS[q.level]}">${q.level}đ · ${LEVEL_LABEL[q.level]}</span>` : ''}
        ${exam && !q.level ? `<span class="tag tag-pts">${it.points}đ</span>` : ''}
        <span class="tag tag-type">${TYPE_LABEL[q.type]}</span>
        <button class="flag ${s.flags[s.idx] ? 'on' : ''}" id="flag" title="Đánh dấu xem lại">★</button>
      </div>
      ${q.section ? `<div class="qsec"><span class="qsec-ic">▣</span> ${esc(q.section)}</div>` : ''}
      <div class="stem">${formatStem(q)}</div>
      ${q.type === 'combo' ? renderStatements(q) : ''}
      ${q.type === 'match' ? renderMatch(q, opts) : renderChoices(q, opts)}
      <div class="feedback" id="feedback"></div>
    </article>

    <div class="navbar">
      <button class="btn ghost" id="prev" ${s.idx === 0 ? 'disabled' : ''}>← Câu trước</button>
      <div class="grow"></div>
      ${s.cfg.instant && !s.checked[s.idx]
      ? `<button class="btn primary" id="check">Kiểm tra</button>`
      : s.idx < n - 1
        ? `<button class="btn primary" id="next">Câu sau →</button>`
        : `<button class="btn success" id="submit">Nộp bài ✓</button>`}
    </div>
    <div class="dotgrid">${renderDots()}</div>
  </div>`

  wireQuiz()
}

function formatStem(q) {
  // mark (1) (2) ... blanks for match questions
  let html = esc(q.stem)
  if (q.type === 'match') html = html.replace(/\((\d)\)|…?\(?(\d)\)?…/g, (m) => m) // keep as-is
  return html
}

function renderStatements(q) {
  return `<ul class="stmts">${q.statements.map((st) => `<li><span class="sn">${st.n}</span>${esc(st.text)}</li>`).join('')}</ul>`
}

function renderChoices(q, opts) {
  const s = state.session
  const chosen = s.answers[s.idx]
  const locked = s.cfg.instant && s.checked[s.idx]
  return `<div class="choices" data-type="${q.type}">
    ${opts.map((o) => {
    const label = q.type === 'combo' ? o.numbers.join(', ') : esc(o.text)
    let cls = 'choice'
    if (chosen === o.key) cls += ' selected'
    if (locked) {
      if (q.answer.includes(o.key)) cls += ' correct'
      else if (chosen === o.key) cls += ' wrong'
    }
    return `<button class="${cls}" data-key="${o.key}" ${locked ? 'disabled' : ''}>
        <span class="key">${o.key.toUpperCase()}</span><span class="txt">${label}</span>
      </button>`
  }).join('')}
  </div>`
}

function renderMatch(q, opts) {
  const s = state.session
  const cur = s.answers[s.idx] || {}
  const locked = s.cfg.instant && s.checked[s.idx]
  const blanks = q.answer.map((a) => a.blank)
  return `
  <div class="match">
    <div class="bank">
      <div class="bank-title">Các lựa chọn</div>
      ${opts.map((o) => `<div class="bankitem"><span class="key">${o.key.toUpperCase()}</span> ${esc(o.text)}</div>`).join('')}
    </div>
    <div class="blanks">
      ${blanks.map((b) => {
        const correctKey = q.answer.find((a) => a.blank === b).key
        let cls = 'blankrow'
        if (locked) cls += cur[b] === correctKey ? ' correct' : ' wrong'
        return `<div class="${cls}">
          <span class="blabel">Chỗ trống (${b})</span>
          <select class="bselect" data-blank="${b}" ${locked ? 'disabled' : ''}>
            <option value="">— chọn —</option>
            ${opts.map((o) => `<option value="${o.key}" ${cur[b] === o.key ? 'selected' : ''}>${o.key.toUpperCase()}. ${esc(o.text).slice(0, 60)}</option>`).join('')}
          </select>
          ${locked && cur[b] !== correctKey ? `<span class="fixhint">Đúng: ${correctKey.toUpperCase()}</span>` : ''}
        </div>`
      }).join('')}
    </div>
  </div>`
}

function renderDots() {
  const s = state.session
  return s.items.map((it, i) => {
    let cls = 'dot'
    if (i === s.idx) cls += ' active'
    const ans = s.answers[i]
    if (s.cfg.instant && s.checked[i]) cls += isCorrect(it.q, ans) ? ' c' : ' w'
    else if (ans != null && (typeof ans !== 'object' || Object.keys(ans).length)) cls += ' a'
    if (s.flags[i]) cls += ' f'
    return `<button class="${cls}" data-goto="${i}">${i + 1}</button>`
  }).join('')
}

function wireQuiz() {
  const s = state.session
  const { q } = s.items[s.idx]

  app.querySelector('#quit').addEventListener('click', () => {
    if (confirm('Thoát bài làm hiện tại? Tiến độ sẽ không được lưu.')) { state.screen = 'home'; renderHome() }
  })
  app.querySelector('#flag').addEventListener('click', () => { s.flags[s.idx] = !s.flags[s.idx]; renderQuiz() })

  app.querySelectorAll('.dot').forEach((d) =>
    d.addEventListener('click', () => { s.idx = +d.dataset.goto; renderQuiz() }))

  const prev = app.querySelector('#prev')
  if (prev) prev.addEventListener('click', () => { s.idx--; renderQuiz() })
  const next = app.querySelector('#next')
  if (next) next.addEventListener('click', () => { s.idx++; renderQuiz() })
  const submit = app.querySelector('#submit')
  if (submit) submit.addEventListener('click', finish)
  const check = app.querySelector('#check')
  if (check) check.addEventListener('click', () => {
    if (s.answers[s.idx] == null) { flash('Hãy chọn đáp án trước.'); return }
    s.checked[s.idx] = true; renderQuiz(); showFeedback()
  })

  if (q.type === 'match') {
    app.querySelectorAll('.bselect').forEach((sel) =>
      sel.addEventListener('change', () => {
        const cur = s.answers[s.idx] || {}
        if (sel.value) cur[sel.dataset.blank] = sel.value
        else delete cur[sel.dataset.blank]
        s.answers[s.idx] = cur
      }))
  } else {
    app.querySelectorAll('.choice').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (s.cfg.instant && s.checked[s.idx]) return
        s.answers[s.idx] = btn.dataset.key
        renderQuiz()
      }))
  }
  if (s.cfg.instant && s.checked[s.idx]) showFeedback()
}

function showFeedback() {
  const s = state.session
  const { q } = s.items[s.idx]
  const fb = app.querySelector('#feedback')
  if (!fb) return
  const ok = isCorrect(q, s.answers[s.idx])
  const ans = q.type === 'match'
    ? q.answer.map((a) => `(${a.blank})→${a.key.toUpperCase()}`).join('  ')
    : q.answer.map((k) => k.toUpperCase()).join(', ')
  fb.className = 'feedback show ' + (ok ? 'ok' : 'no')
  fb.innerHTML = `<b>${ok ? '✓ Chính xác!' : '✗ Chưa đúng.'}</b> Đáp án đúng: <span class="ans">${ans}</span>` +
    (q.explain ? `<div class="explain">${esc(q.explain)}</div>` : '')
}

function flash(msg) {
  const fb = app.querySelector('#feedback')
  if (fb) { fb.className = 'feedback show warn'; fb.textContent = msg }
}

// =====================================================================
// RESULT
// =====================================================================
function finish() {
  const s = state.session
  s.finished = true
  const correct = s.items.reduce((a, it, i) => a + (isCorrect(it.q, s.answers[i]) ? 1 : 0), 0)
  const total = s.items.length
  const scores = loadScores()

  if (s.cfg.mode === 'exam') {
    let pts = 0
    s.items.forEach((it, i) => { pts += score(it.q, s.answers[i]) * (it.points || 0) })
    const score10 = Math.round(pts * 100) / 100 // điểm trên thang 10
    scores.push({ at: Date.now(), correct, total, pct: Math.round(score10 * 10), exam: true, score10 })
    localStorage.setItem(LS_SCORE, JSON.stringify(scores.slice(-50)))
    state.screen = 'result'
    renderResult({ exam: true, score10, correct, total })
    return
  }

  let pts = 0
  s.items.forEach((it, i) => (pts += score(it.q, s.answers[i])))
  const pct = Math.round((pts / total) * 100)
  scores.push({ at: Date.now(), correct, total, pct })
  localStorage.setItem(LS_SCORE, JSON.stringify(scores.slice(-50)))
  state.screen = 'result'
  renderResult({ pts, correct, total, pct })
}

function renderResult(r) {
  const s = state.session

  if (r.exam) {
    const grade = r.score10 >= 8 ? 'good' : r.score10 >= 5 ? 'mid' : 'bad'
    const msg = r.score10 >= 8 ? 'Xuất sắc!' : r.score10 >= 5 ? 'Đạt — cố thêm nhé!' : 'Chưa đạt, ôn lại nhé!'
    const num = r.score10.toFixed(2).replace(/\.?0+$/, '') // 7.50 → 7.5 · 10.00 → 10
    app.innerHTML = `
    <div class="wrap">
      <section class="card result">
        <div class="ring ${grade}"><span>${num}<small>/10</small></span></div>
        <h1>${msg}</h1>
        <p class="sub">🎯 Đề thi thử · <b>${esc(getSource(s.cfg.source).label)}</b><br>
          Đúng <b>${r.correct}</b>/${r.total} câu · Điểm <b>${num}</b>/10</p>
        <div class="actions center">
          <button class="btn exam" id="retry">🎯 Tạo đề mới</button>
          <button class="btn ghost" id="review">Xem lại đáp án</button>
          <button class="btn ghost" id="home">Về trang chủ</button>
        </div>
      </section>
      <div id="review-list"></div>
    </div>`
    app.querySelector('#home').addEventListener('click', () => { state.screen = 'home'; renderHome() })
    app.querySelector('#retry').addEventListener('click', () => startExam(s.cfg.source))
    app.querySelector('#review').addEventListener('click', renderReview)
    return
  }

  const grade = r.pct >= 80 ? 'good' : r.pct >= 50 ? 'mid' : 'bad'
  const msg = r.pct >= 80 ? 'Xuất sắc!' : r.pct >= 50 ? 'Khá tốt, cố lên!' : 'Cần ôn lại nhé!'

  app.innerHTML = `
  <div class="wrap">
    <section class="card result">
      <div class="ring ${grade}"><span>${r.pct}<small>%</small></span></div>
      <h1>${msg}</h1>
      <p class="sub">Đúng <b>${r.correct}</b>/${r.total} câu · Điểm theo phần: ${r.pts.toFixed(1)}/${r.total}</p>
      <div class="actions center">
        <button class="btn primary" id="retry">Làm lại bộ này</button>
        <button class="btn ghost" id="review">Xem lại đáp án</button>
        <button class="btn ghost" id="home">Về trang chủ</button>
      </div>
    </section>
    <div id="review-list"></div>
  </div>`

  app.querySelector('#home').addEventListener('click', () => { state.screen = 'home'; renderHome() })
  app.querySelector('#retry').addEventListener('click', () => startSession(s.cfg))
  app.querySelector('#review').addEventListener('click', renderReview)
}

function renderReview() {
  const s = state.session
  const list = app.querySelector('#review-list')
  list.innerHTML = `<section class="card"><h2>Xem lại (${s.items.length} câu)</h2>
    ${s.items.map((it, i) => {
      const q = it.q
      const ans = s.answers[i]
      const ok = isCorrect(q, ans)
      let yours, right
      if (q.type === 'match') {
        const cur = ans || {}
        yours = q.answer.map((a) => `(${a.blank})→${(cur[a.blank] || '∅').toUpperCase()}`).join(' ')
        right = q.answer.map((a) => `(${a.blank})→${a.key.toUpperCase()}`).join(' ')
      } else {
        yours = ans ? ans.toUpperCase() : '∅'
        right = q.answer.map((k) => k.toUpperCase()).join(', ')
      }
      return `<div class="rev ${ok ? 'ok' : 'no'}">
        <div class="rev-h"><span class="rev-i">${i + 1}</span><span class="rev-st">${esc(q.stem)}</span></div>
        ${q.section ? `<div class="rev-sec">${q.level ? `<span class="rev-lv ${LEVEL_CLS[q.level]}">${q.level}đ</span>` : ''}▣ Chương ${q.chapter} · ${esc(q.section)}</div>` : ''}
        <div class="rev-a">Bạn: <b>${yours}</b> · Đúng: <b class="g">${right}</b></div>
      </div>`
    }).join('')}
  </section>`
  list.scrollIntoView({ behavior: 'smooth' })
}

// ---- keyboard shortcuts ----------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (state.screen !== 'quiz') return
  const s = state.session
  const { q } = s.items[s.idx]
  if (e.key === 'ArrowRight' && s.idx < s.items.length - 1) { s.idx++; renderQuiz() }
  else if (e.key === 'ArrowLeft' && s.idx > 0) { s.idx--; renderQuiz() }
  else if (e.key === 'Enter') {
    const btn = app.querySelector('#check') || app.querySelector('#next') || app.querySelector('#submit')
    if (btn) btn.click()
  } else if (/^[1-6]$/.test(e.key) && q.type !== 'match') {
    const choices = app.querySelectorAll('.choice')
    const b = choices[+e.key - 1]
    if (b && !b.disabled) b.click()
  }
})

// ---- boot ------------------------------------------------------------------
state.source = getSource(loadSettings().source).id
renderHome()
