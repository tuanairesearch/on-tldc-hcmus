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
// loại câu hỏi để lọc (đề gốc trộn nhiều loại; bộ tự soạn chỉ có 'single')
const TYPES = [
  { id: 'single', label: 'Chọn 1 đáp án', short: 'Trắc nghiệm' },
  { id: 'combo', label: 'Tổ hợp', short: 'Tổ hợp' },
  { id: 'match', label: 'Ghép / Điền khuyết', short: 'Ghép nối' },
]
const LS_KEY = 'tldc.settings.v1'
const LS_SCORE = 'tldc.scores.v1'
const LS_UNLOCK = 'tldc.unlock.v1'
const LS_SAVED = 'tldc.saved.v1' // câu "chưa thuộc" người dùng tự lưu (bền qua các phiên)

// ⚠ MÃ BÍ MẬT để mở "đề gốc" (chỉ ẩn ở giao diện, KHÔNG phải bảo mật thật).
//    Đổi chuỗi dưới đây thành mã của riêng bạn.
const UNLOCK_CODE = 'tuan-dep-trai'
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
// đề thi thử giới hạn thời gian; hết giờ sẽ tự nộp bài
const EXAM_MINUTES = 45
const EXAM_SECONDS = EXAM_MINUTES * 60

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
// CÂU ĐÃ LƯU ("chưa thuộc") — bền qua các phiên, tách theo từng bộ
// =====================================================================
// khoá lưu gộp nguồn + id vì id trùng nhau giữa hai bộ (đều bắt đầu từ 1)
const savedKey = (source, q) => `${source}:${q.id}`
const loadSaved = () => {
  try { return new Set(JSON.parse(localStorage.getItem(LS_SAVED)) || []) } catch { return new Set() }
}
const persistSaved = (set) => {
  try { localStorage.setItem(LS_SAVED, JSON.stringify([...set])) } catch { /* ignore */ }
}
const isSaved = (source, q) => loadSaved().has(savedKey(source, q))
// bật/tắt lưu 1 câu, trả về trạng thái mới (true = đã lưu)
const toggleSaved = (source, q) => {
  const set = loadSaved()
  const k = savedKey(source, q)
  set.has(k) ? set.delete(k) : set.add(k)
  persistSaved(set)
  return set.has(k)
}
// các câu đã lưu của một bộ, giữ đúng thứ tự trong bộ
const savedQuestionsFor = (sourceId) => {
  const set = loadSaved()
  return getSource(sourceId).questions.filter((q) => set.has(savedKey(sourceId, q)))
}

// =====================================================================
// ĐỒNG HỒ — đếm giờ (luyện tập) / đếm ngược 45' (thi, hết giờ tự nộp)
// =====================================================================
let timerId = null
const fmtTime = (sec) => {
  sec = Math.max(0, Math.floor(sec))
  const m = Math.floor(sec / 60), r = sec % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}
// số giây đã trôi qua của phiên hiện tại
const elapsedSec = () => {
  const s = state.session
  return s && s.startAt ? Math.floor((Date.now() - s.startAt) / 1000) : 0
}
// chuỗi hiển thị trên đồng hồ: đếm ngược khi thi, đếm lên khi luyện tập
const clockText = () => {
  const s = state.session
  if (!s) return ''
  return s.cfg.mode === 'exam' ? fmtTime(EXAM_SECONDS - elapsedSec()) : fmtTime(elapsedSec())
}
const stopTimer = () => { if (timerId) { clearInterval(timerId); timerId = null } }
const startTimer = () => {
  stopTimer()
  timerId = setInterval(() => {
    const s = state.session
    if (!s || state.screen !== 'quiz') { stopTimer(); return }
    const el = document.querySelector('#timer')
    if (!el) return // sẽ vẽ lại ở lần render kế tiếp
    el.textContent = clockText()
    if (s.cfg.mode === 'exam') {
      const remain = EXAM_SECONDS - elapsedSec()
      el.classList.toggle('warn', remain <= 300 && remain > 60)
      el.classList.toggle('danger', remain <= 60)
      if (remain <= 0) { stopTimer(); finish(true) } // hết giờ → tự nộp
    }
  }, 1000)
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

  // loại câu hỏi: chỉ hiện khi bộ đang chọn có nhiều hơn 1 loại (đề gốc)
  const typeCount = Object.fromEntries(TYPES.map((t) => [t.id, src.questions.filter((q) => q.type === t.id).length]))
  const typesPresent = TYPES.filter((t) => typeCount[t.id] > 0)
  const hasTypes = typesPresent.length > 1
  const selTypes = new Set(
    sameSaved && Array.isArray(saved.types) && saved.types.length
      ? saved.types
      : typesPresent.map((t) => t.id),
  )

  const advOpen = saved.adv === true
  const advSummary = [hasTypes && 'loại câu', hasLevels && 'mức độ', hasSections && 'phần', 'xáo trộn'].filter(Boolean).join(' · ')

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
        ${hasTypes ? `
        <h2>Loại câu hỏi</h2>
        <div class="chip-row ty-row" id="types">
          ${typesPresent.map((t) => `
            <label class="pill typill">
              <input type="checkbox" class="chk-ty" value="${t.id}" ${selTypes.has(t.id) ? 'checked' : ''}/>
              <span>${t.label} <em>(${typeCount[t.id]})</em></span>
            </label>`).join('')}
        </div>
        <p class="ty-hint">Bỏ chọn để loại bớt — vd chỉ giữ <b>Chọn 1 đáp án</b> để làm/thi thuần trắc nghiệm.</p>` : ''}

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
        <span class="exam-note">40 câu ngẫu nhiên · chấm thang <b>10đ</b> · ⏱ giới hạn <b>${EXAM_MINUTES} phút</b><br>
          ${hasLevels ? '10×0.15đ + 20×0.25đ + 10×0.35đ' : '40 câu × 0.25đ'} · nguồn: <b>${esc(src.label)}</b> · <em>ẩn chương &amp; phần</em>${hasTypes ? `<span id="exam-types-note"></span>` : ''}</span>
      </div>
    </section>

    ${renderSavedCard(src.id)}
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
  app.querySelector('#exam').addEventListener('click', () => {
    const types = hasTypes ? selectedTypes() : null
    if (hasTypes && !types.length) { info.textContent = 'Hãy chọn ít nhất một loại câu hỏi.'; return }
    saveSettings({ ...loadSettings(), source: src.id, types: types || [] })
    startExam(src.id, types)
  })

  // ôn tập các câu đã lưu ("chưa thuộc") của bộ đang chọn
  const reviewSaved = app.querySelector('#review-saved')
  if (reviewSaved) reviewSaved.addEventListener('click', () => startSaved(src.id))

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
  const tyChecks = [...app.querySelectorAll('.chk-ty')]
  const secBox = app.querySelector('#sec-box')
  const info = app.querySelector('#count-info')
  const examTypesNote = app.querySelector('#exam-types-note')
  const selectedChapters = () => chChecks.filter((c) => c.checked).map((c) => +c.value)
  const selectedLevels = () => lvChecks.filter((c) => c.checked).map((c) => c.value)
  const selectedTypes = () => tyChecks.filter((c) => c.checked).map((c) => c.value)
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
    const avail = filterPool(src.questions, selectedChapters(), selectedLevels(), selectedSections(), selectedTypes()).length
    info.textContent = `${avail} câu trong phạm vi đã chọn`
    chkAll.checked = chChecks.every((c) => c.checked)
    if (examTypesNote) {
      const t = selectedTypes()
      examTypesNote.innerHTML = t.length && t.length < typesPresent.length
        ? ` · chỉ <b>${t.map((id) => TYPE_LABEL[id]).join(', ')}</b>`
        : ''
    }
  }
  chkAll.addEventListener('change', () => { chChecks.forEach((c) => (c.checked = chkAll.checked)); paintSections(); updateInfo() })
  chChecks.forEach((c) => c.addEventListener('change', () => { paintSections(); updateInfo() }))
  lvChecks.forEach((c) => c.addEventListener('change', updateInfo))
  tyChecks.forEach((c) => c.addEventListener('change', updateInfo))
  paintSections()
  updateInfo()

  app.querySelector('#start').addEventListener('click', () => {
    const chosen = selectedChapters()
    if (!chosen.length) { info.textContent = 'Hãy chọn ít nhất một chương.'; return }
    const levels = selectedLevels()
    if (hasLevels && !levels.length) { info.textContent = 'Hãy chọn ít nhất một mức độ.'; return }
    const sections = selectedSections()
    if (sections && !sections.length) { info.textContent = 'Hãy chọn ít nhất một phần.'; return }
    const types = hasTypes ? selectedTypes() : []
    if (hasTypes && !types.length) { info.textContent = 'Hãy chọn ít nhất một loại câu hỏi.'; return }
    const cfg = {
      source: src.id,
      chapters: chosen,
      levels,
      sections,
      types,
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

      <h2>Các trang quiz theo chương</h2>
      ${unlocked ? `<p>📄 ${link('de-goc-cau-hoi-trac-nghiem.pdf', 'Đề gốc (PDF) — 278 câu trắc nghiệm')}</p>` : ''}
      <ul class="src-list">
        <li><b>Chương 1:</b> ${link('chuong-1.html', '40 câu lý thuyết')} · ${link('chuong-1-tinh-huong.html', '10 tình huống bổ sung')}</li>
        <li><b>Chương 2:</b> ${link('chuong-2.html', 'Cơ sở tự nhiên & xã hội (100 câu)')}</li>
        <li><b>Chương 3:</b> ${link('chuong-3-cam-giac-tri-giac.html', 'Cảm giác & Tri giác (90 câu)')} · ${link('chuong-3.html', 'Nhận thức lý tính & Trí nhớ (90 câu)')}</li>
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

// thẻ "Câu đã lưu" ở trang chủ — ôn tập riêng các câu chưa thuộc của bộ đang chọn
function renderSavedCard(sourceId) {
  const n = savedQuestionsFor(sourceId).length
  return `
  <section class="card saved-card">
    <h2>🔖 Câu đã lưu</h2>
    ${n
      ? `<div class="saved-row">
          <span class="saved-count"><b>${n}</b> câu chưa thuộc trong bộ này</span>
          <button class="btn primary" id="review-saved">Ôn tập câu đã lưu →</button>
        </div>`
      : `<p class="saved-empty">Chưa lưu câu nào. Khi làm bài, bấm <b>🔖</b> ở câu bạn thấy <b>chưa thuộc</b> để lưu lại và ôn riêng tại đây.</p>`}
  </section>`
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
          <span>${s.correct}/${s.total} câu${exam ? ' · 🎯 thi thử' : ''}${s.timeSec != null ? ` · ⏱ ${fmtTime(s.timeSec)}` : ''}</span>
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
function filterPool(questions, chapterIds, levels, sections, types) {
  const chSet = new Set(chapterIds)
  const filterByLevel = Array.isArray(levels) && levels.length && levels.length < LEVELS.length
  const lvSet = new Set(levels || [])
  const secSet = Array.isArray(sections) ? new Set(sections) : null
  const typeSet = Array.isArray(types) && types.length ? new Set(types) : null
  return questions.filter((q) =>
    chSet.has(q.chapter) &&
    (!filterByLevel || lvSet.has(q.level)) &&
    (!secSet || secSet.has(q.section)) &&
    (!typeSet || typeSet.has(q.type)))
}

function startSession(cfg) {
  let pool = filterPool(getSource(cfg.source).questions, cfg.chapters, cfg.levels, cfg.sections, cfg.types)
  if (cfg.shuffle) pool = shuffle(pool)
  else pool = pool.slice().sort((a, b) => a.id - b.id)
  if (cfg.count !== 'all') pool = pool.slice(0, cfg.count)

  // optionally shuffle options (only single/match keep mapping via key)
  const items = pool.map((q) => {
    let opts = q.options
    if (cfg.shuffleOpt && (q.type === 'single' || q.type === 'match')) opts = shuffle(q.options)
    return { q, opts }
  })

  state.session = { cfg, items, idx: 0, answers: {}, checked: {}, flags: {}, finished: false, startAt: Date.now() }
  state.screen = 'quiz'
  startTimer()
  renderQuiz()
}

// phiên tùy chỉnh từ một danh sách câu có sẵn (làm lại câu sai · ôn câu đã lưu)
function startCustomSession(items, { source, label, instant = true }) {
  if (!items.length) return
  state.session = {
    cfg: { source, instant, custom: true, label },
    items, idx: 0, answers: {}, checked: {}, flags: {}, finished: false, startAt: Date.now(),
  }
  state.screen = 'quiz'
  startTimer()
  renderQuiz()
}

// làm lại các câu vừa làm sai của phiên hiện tại (luyện tập, chấm ngay)
function startRedoWrong() {
  const s = state.session
  const wrong = s.items.filter((it, i) => !isCorrect(it.q, s.answers[i]))
  startCustomSession(
    wrong.map((it) => ({ q: it.q, opts: it.q.options })),
    { source: s.cfg.source, label: 'Làm lại câu sai' },
  )
}

// ôn tập các câu đã lưu ("chưa thuộc") của một bộ (luyện tập, chấm ngay)
function startSaved(sourceId) {
  const qs = savedQuestionsFor(sourceId)
  startCustomSession(
    shuffle(qs).map((q) => ({ q, opts: q.options })),
    { source: sourceId, label: 'Câu đã lưu' },
  )
}

// bốc ngẫu nhiên 40 câu thành một đề hoàn chỉnh (10đ), GIỮ NGUYÊN nguồn đã chọn
// types: mảng loại câu được phép (vd ['single'] = chỉ trắc nghiệm chọn 1); rỗng = mọi loại
function buildExamItems(sourceId, types) {
  const src = getSource(sourceId)
  const typeSet = Array.isArray(types) && types.length ? new Set(types) : null
  const base = typeSet ? src.questions.filter((q) => typeSet.has(q.type)) : src.questions
  const hasLv = base.some((q) => q.level)
  let pool = []
  if (hasLv) {
    // bốc theo cơ cấu mức độ để cộng đúng 10đ
    for (const [lv, need] of Object.entries(EXAM_COMPOSITION)) {
      pool.push(...shuffle(base.filter((q) => q.level === lv)).slice(0, need))
    }
    if (pool.length < EXAM_SIZE) { // dự phòng nếu một mức thiếu câu
      const used = new Set(pool.map((q) => q.id))
      pool.push(...shuffle(base.filter((q) => !used.has(q.id))).slice(0, EXAM_SIZE - pool.length))
    }
  } else {
    pool = shuffle(base).slice(0, EXAM_SIZE) // đề gốc: 40 câu bất kỳ, điểm đều nhau
  }
  pool = shuffle(pool)
  return pool.map((q) => ({ q, opts: q.options, points: q.level ? LEVEL_POINTS[q.level] : EXAM_FLAT_POINTS }))
}

function startExam(sourceId, types) {
  const items = buildExamItems(sourceId, types)
  state.session = {
    cfg: { source: sourceId, mode: 'exam', instant: false, types },
    items, idx: 0, answers: {}, checked: {}, flags: {}, finished: false, startAt: Date.now(),
  }
  state.screen = 'quiz'
  startTimer()
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
  const saved = isSaved(s.cfg.source, q)
  const remain = EXAM_SECONDS - elapsedSec()
  const timerCls = exam ? (remain <= 60 ? 'danger' : remain <= 300 ? 'warn' : '') : ''

  app.innerHTML = `
  <div class="wrap quiz">
    <div class="topbar">
      <button class="btn ghost small" id="quit">← Thoát</button>
      <div class="progress"><div class="bar" style="width:${(done / n) * 100}%"></div></div>
      <div class="timer ${exam ? 'exam' : ''} ${timerCls}" id="timer"
        title="${exam ? `Thời gian còn lại · giới hạn ${EXAM_MINUTES} phút` : 'Thời gian đã làm'}">${clockText()}</div>
      <div class="counter">Câu <b>${s.idx + 1}</b>/${n}</div>
    </div>

    <article class="card question">
      <div class="qmeta">
        ${exam ? `<span class="tag tag-exam">🎯 Thi thử</span>` : ''}
        ${!exam ? `<span class="tag tag-ch">Chương ${q.chapter}</span>` : ''}
        ${!exam && q.level ? `<span class="tag tag-lv ${LEVEL_CLS[q.level]}">${q.level}đ · ${LEVEL_LABEL[q.level]}</span>` : ''}
        ${s.cfg.custom ? `<span class="tag tag-type">${esc(s.cfg.label)}</span>` : ''}
        <span class="tag tag-type">${TYPE_LABEL[q.type]}</span>
        <button class="save ${saved ? 'on' : ''}" id="save" title="${saved ? 'Bỏ lưu câu này' : 'Lưu câu chưa thuộc để ôn lại'}">🔖</button>
        <button class="flag ${s.flags[s.idx] ? 'on' : ''}" id="flag" title="Đánh dấu xem lại trong phiên">★</button>
      </div>
      ${!exam && q.section ? `<div class="qsec"><span class="qsec-ic">▣</span> ${esc(q.section)}</div>` : ''}
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
    if (confirm('Thoát bài làm hiện tại? Tiến độ sẽ không được lưu.')) { stopTimer(); state.screen = 'home'; renderHome() }
  })
  app.querySelector('#flag').addEventListener('click', () => { s.flags[s.idx] = !s.flags[s.idx]; renderQuiz() })
  app.querySelector('#save').addEventListener('click', () => { toggleSaved(s.cfg.source, q); renderQuiz() })

  app.querySelectorAll('.dot').forEach((d) =>
    d.addEventListener('click', () => { s.idx = +d.dataset.goto; renderQuiz() }))

  const prev = app.querySelector('#prev')
  if (prev) prev.addEventListener('click', () => { s.idx--; renderQuiz() })
  const next = app.querySelector('#next')
  if (next) next.addEventListener('click', () => { s.idx++; renderQuiz() })
  const submit = app.querySelector('#submit')
  if (submit) submit.addEventListener('click', () => finish())
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
function finish(timedOut = false) {
  const s = state.session
  stopTimer()
  s.finished = true
  s.timeSec = elapsedSec()
  s.timedOut = timedOut
  const correct = s.items.reduce((a, it, i) => a + (isCorrect(it.q, s.answers[i]) ? 1 : 0), 0)
  const total = s.items.length
  const scores = loadScores()

  if (s.cfg.mode === 'exam') {
    let pts = 0
    s.items.forEach((it, i) => { pts += score(it.q, s.answers[i]) * (it.points || 0) })
    const score10 = Math.round(pts * 100) / 100 // điểm trên thang 10
    scores.push({ at: Date.now(), correct, total, pct: Math.round(score10 * 10), exam: true, score10, timeSec: s.timeSec })
    localStorage.setItem(LS_SCORE, JSON.stringify(scores.slice(-50)))
    state.screen = 'result'
    renderResult({ exam: true, score10, correct, total, timeSec: s.timeSec, timedOut })
    return
  }

  let pts = 0
  s.items.forEach((it, i) => (pts += score(it.q, s.answers[i])))
  const pct = Math.round((pts / total) * 100)
  // phiên luyện tập tùy chỉnh (làm lại câu sai · câu đã lưu) không ghi vào lịch sử
  if (!s.cfg.custom) {
    scores.push({ at: Date.now(), correct, total, pct, timeSec: s.timeSec })
    localStorage.setItem(LS_SCORE, JSON.stringify(scores.slice(-50)))
  }
  state.screen = 'result'
  renderResult({ pts, correct, total, pct, timeSec: s.timeSec })
}

function renderResult(r) {
  const s = state.session
  const wrong = s.items.filter((it, i) => !isCorrect(it.q, s.answers[i])).length
  const timeStr = r.timeSec != null ? fmtTime(r.timeSec) : null
  const redoBtn = wrong ? `<button class="btn primary" id="redo">🔁 Làm lại ${wrong} câu sai</button>` : ''
  const wireCommon = () => {
    app.querySelector('#home').addEventListener('click', () => { state.screen = 'home'; renderHome() })
    app.querySelector('#review').addEventListener('click', renderReview)
    const redo = app.querySelector('#redo')
    if (redo) redo.addEventListener('click', startRedoWrong)
  }

  if (r.exam) {
    const grade = r.score10 >= 8 ? 'good' : r.score10 >= 5 ? 'mid' : 'bad'
    const msg = r.timedOut ? '⏰ Hết giờ!'
      : r.score10 >= 8 ? 'Xuất sắc!' : r.score10 >= 5 ? 'Đạt — cố thêm nhé!' : 'Chưa đạt, ôn lại nhé!'
    const num = r.score10.toFixed(2).replace(/\.?0+$/, '') // 7.50 → 7.5 · 10.00 → 10
    app.innerHTML = `
    <div class="wrap">
      <section class="card result">
        <div class="ring ${grade}"><span>${num}<small>/10</small></span></div>
        <h1>${msg}</h1>
        <p class="sub">🎯 Đề thi thử · <b>${esc(getSource(s.cfg.source).label)}</b><br>
          Đúng <b>${r.correct}</b>/${r.total} câu · Điểm <b>${num}</b>/10${timeStr ? ` · ⏱ <b>${timeStr}</b>` : ''}${r.timedOut ? ' · <b class="rd">tự nộp do hết giờ</b>' : ''}</p>
        <div class="actions center">
          ${redoBtn}
          <button class="btn exam" id="retry">🎯 Tạo đề mới</button>
          <button class="btn ghost" id="review">Xem lại đáp án</button>
          <button class="btn ghost" id="home">Về trang chủ</button>
        </div>
      </section>
      <div id="review-list"></div>
    </div>`
    app.querySelector('#retry').addEventListener('click', () => startExam(s.cfg.source, s.cfg.types))
    wireCommon()
    return
  }

  const grade = r.pct >= 80 ? 'good' : r.pct >= 50 ? 'mid' : 'bad'
  const msg = r.pct >= 80 ? 'Xuất sắc!' : r.pct >= 50 ? 'Khá tốt, cố lên!' : 'Cần ôn lại nhé!'
  const custom = s.cfg.custom

  app.innerHTML = `
  <div class="wrap">
    <section class="card result">
      <div class="ring ${grade}"><span>${r.pct}<small>%</small></span></div>
      <h1>${msg}</h1>
      <p class="sub">${custom ? `${esc(s.cfg.label)} · ` : ''}Đúng <b>${r.correct}</b>/${r.total} câu · Điểm theo phần: ${r.pts.toFixed(1)}/${r.total}${timeStr ? ` · ⏱ <b>${timeStr}</b>` : ''}</p>
      <div class="actions center">
        ${redoBtn}
        <button class="btn primary" id="retry">${custom ? 'Làm lại nhóm này' : 'Làm lại bộ này'}</button>
        <button class="btn ghost" id="review">Xem lại đáp án</button>
        <button class="btn ghost" id="home">Về trang chủ</button>
      </div>
    </section>
    <div id="review-list"></div>
  </div>`

  app.querySelector('#retry').addEventListener('click', () =>
    custom ? startCustomSession(s.items.map((it) => ({ q: it.q, opts: it.q.options })), s.cfg) : startSession(s.cfg))
  wireCommon()
}

function renderReview() {
  const s = state.session
  const list = app.querySelector('#review-list')
  list.innerHTML = `<section class="card"><h2>Xem lại (${s.items.length} câu)</h2>
    <p class="rev-hint">🔖 Bấm dấu trang để lưu câu <b>chưa thuộc</b> — ôn lại riêng ở trang chủ.</p>
    ${s.items.map((it, i) => {
      const q = it.q
      const ans = s.answers[i]
      const ok = isCorrect(q, ans)
      const sv = isSaved(s.cfg.source, q)
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
        <div class="rev-h">
          <span class="rev-i">${i + 1}</span>
          <span class="rev-st">${esc(q.stem)}</span>
          <button class="save rev-save ${sv ? 'on' : ''}" data-i="${i}" title="${sv ? 'Bỏ lưu câu này' : 'Lưu câu chưa thuộc'}">🔖</button>
        </div>
        <div class="rev-sec">${q.level ? `<span class="rev-lv ${LEVEL_CLS[q.level]}">${q.level}đ</span>` : ''}▣ Chương ${q.chapter}${q.section ? ` · ${esc(q.section)}` : ''}</div>
        <div class="rev-a">Bạn: <b>${yours}</b> · Đúng: <b class="g">${right}</b></div>
        ${q.explain ? `<div class="rev-ex">${esc(q.explain)}</div>` : ''}
      </div>`
    }).join('')}
  </section>`
  list.querySelectorAll('.rev-save').forEach((btn) => btn.addEventListener('click', () => {
    const on = toggleSaved(s.cfg.source, s.items[+btn.dataset.i].q)
    btn.classList.toggle('on', on)
    btn.title = on ? 'Bỏ lưu câu này' : 'Lưu câu chưa thuộc'
  }))
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
