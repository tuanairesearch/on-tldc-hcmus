# -*- coding: utf-8 -*-
"""Final coordinate-aware parser -> questions.json

Handles the three question types and all the layout quirks found in the PDF:
  * single  : a/b/c/d, correct marked with '*'
  * combo   : numbered statements + "Phương án đúng: a:1,2,3 ..." (correct '*')
  * match   : cloze (1)(2)(3) or "Cột A / Cột B", options a..f possibly laid out
              in a separate right-hand box with 1-2 sub-columns, two-up lines
              ("a. X    d. Y"), missing dots ("e Tư chất") and a few questions
              whose "Câu N" label floats *after* the body.
"""
import fitz, re, io, json

PDF = 'cau-hoi-trac-nghiem-tam-ly-hoc-dai-cuong-vieclamvui_2.pdf'
OUT = 'questions.json'

doc = fitz.open(PDF)

LINES = []
for pno in range(doc.page_count):
    for blk in doc[pno].get_text('dict').get('blocks', []):
        if blk.get('type', 0) != 0:
            continue
        for ln in blk.get('lines', []):
            spans = ln.get('spans', [])
            txt = ''.join(s['text'] for s in spans)
            if not txt.strip():
                continue
            LINES.append({'page': pno, 'y0': ln['bbox'][1],
                          'x0': min(s['bbox'][0] for s in spans), 'text': txt})
LINES.sort(key=lambda d: (d['page'], round(d['y0'], 1), d['x0']))

chap_re = re.compile(r'^\s*Ch[uư]ơng\s+(\d+)')
cau_re = re.compile(r'^\s*C[âa]u\s+(\d+)\s*[.:]?\s*(.*)$')
bare10_re = re.compile(r'^\s*10\.\s*(.*)$')
pa_re = re.compile(r'Phương\s*án\s*đúng', re.IGNORECASE)
combo_seg_re = re.compile(r'(\*?)\s*([a-d])\s*(\*?)\s*[:.]\s*([0-9][0-9,\s]*)')
ans_re = re.compile(r'(\d)\s*[-–]\s*([a-f])')
ans_line_re = re.compile(r'^\s*\d\s*[-–]\s*[a-f]\b')
# option start: "a." / "a)" / "a Word" (missing dot)
optstart_re = re.compile(r'^\s*([a-f])\s*[.)]\s*(.*)$|^\s*([a-f])\s+([A-ZÀ-ỸĐ].*)$')
single_opt_re = re.compile(r'^\s*(\*?)\s*([a-e])\s*\*?\s*[.)]\s*(.*)$')
st_re = re.compile(r'^\s*(\d+)\s*[.)]\s*(.*)$')

def clean(s):
    return re.sub(r'\s+', ' ', s).strip()

def clean_opt(s):
    """Strip leaked PA-prompt fragments / ellipses from option text."""
    s = re.sub(r'\d\s*[-–]\s*…[\s….,;]*$', '', s)   # trailing "3 - ……"
    s = re.sub(r'…+', ' ', s)                           # stray ellipses
    s = re.sub(r'\bC[ộô]t\s*[AB]\b', ' ', s)           # leaked column labels
    return re.sub(r'\s+', ' ', s).strip(' .;-')

def opt_match(text):
    m = optstart_re.match(text)
    if not m:
        return None
    if m.group(1):
        return m.group(1).lower(), m.group(2)
    return m.group(3).lower(), m.group(4)

def split_two_up(text):
    """Split 'a. X    d. Y' into ['a. X', 'd. Y'] on big gaps before a letter."""
    parts = re.split(r'\s{2,}(?=[a-f]\s*[.)])', text)
    return parts if len(parts) > 1 else [text]

# ---- locate chapters & question starts -------------------------------------
chap_track, cur_chap = [], (1, '')
qstarts = []
for i, l in enumerate(LINES):
    cm = chap_re.match(l['text'])
    if cm:
        title = ''
        for j in range(i + 1, min(i + 4, len(LINES))):
            if LINES[j]['text'].strip() and not chap_re.match(LINES[j]['text']):
                title = LINES[j]['text'].strip(); break
        cur_chap = (int(cm.group(1)), title)
    chap_track.append(cur_chap)
    m = cau_re.match(l['text'])
    if m:
        qstarts.append((i, int(m.group(1))))
    elif bare10_re.match(l['text']):
        qstarts.append((i, 10))

# ---- build raw segments -----------------------------------------------------
segs = []
for qi, (start, qnum) in enumerate(qstarts):
    end = qstarts[qi + 1][0] if qi + 1 < len(qstarts) else len(LINES)
    seg = [dict(s) for s in LINES[start:end]]
    fm = cau_re.match(LINES[start]['text']) or bare10_re.match(LINES[start]['text'])
    seg[0]['text'] = (fm.group(2) if fm.re is cau_re else fm.group(1)) if fm else seg[0]['text']
    segs.append({'qnum': qnum, 'chap': chap_track[start], 'lines': seg})

# ---- fix "label after body": move overflow from previous segment -----------
for i in range(1, len(segs)):
    lines = segs[i]['lines']
    body = [s for s in lines[1:]
            if not pa_re.search(s['text']) and not ans_line_re.match(s['text'])]
    has_ans = any(ans_line_re.match(s['text']) for s in lines)
    if has_ans and len(body) == 0:           # degenerate: only marker+PA+answer
        prev = segs[i - 1]['lines']
        a_idx = [j for j, s in enumerate(prev) if ans_line_re.match(s['text'])]
        if a_idx:
            cut = a_idx[0] + 1
            overflow = prev[cut:]
            if overflow:
                merged = [lines[0]] + overflow + lines[1:]
                merged.sort(key=lambda s: (s['page'], round(s['y0'], 1), s['x0']))
                segs[i]['lines'] = merged
                segs[i - 1]['lines'] = prev[:cut]

# ---- option-box column parser ----------------------------------------------
def parse_option_box(region):
    """region: [{x0,y0,text}] -> ordered [{key,text}] merged across columns."""
    # expand two-up lines into pieces; estimate x for later pieces
    items = []
    for r in region:
        pieces = split_two_up(r['text'])
        for k, p in enumerate(pieces):
            items.append({'x0': r['x0'] + k * 200, 'y0': r['y0'], 'text': p})
    if not items:
        return []
    xs = sorted(set(round(it['x0']) for it in items))
    cols = []
    for x in xs:
        if cols and x - cols[-1][-1] <= 45:
            cols[-1].append(x)
        else:
            cols.append([x])
    centers = [sum(c) / len(c) for c in cols]
    buckets = [[] for _ in cols]
    for it in items:
        ci = min(range(len(centers)), key=lambda i: abs(centers[i] - it['x0']))
        buckets[ci].append(it)
    options = {}
    for b in sorted(buckets, key=lambda b: min(i['x0'] for i in b)):
        b.sort(key=lambda i: i['y0'])
        cur = None
        for it in b:
            om = opt_match(it['text'])
            if om:
                cur = om[0]
                options.setdefault(cur, []).append(om[1])
            elif cur is not None:
                options[cur].append(it['text'])
    return [{'key': k, 'text': clean_opt(' '.join(options[k]))} for k in 'abcdef' if k in options]

results = []
stats = {'single': 0, 'combo': 0, 'match': 0}

for S in segs:
    qnum = S['qnum']; chap_no, chap_title = S['chap']; seg = S['lines']
    texts = [s['text'] for s in seg]
    has_ans = any(ans_line_re.match(t) for t in texts)
    has_pa = any(pa_re.search(t) for t in texts)
    pa_combo = has_pa and combo_seg_re.search(' '.join(t for t in texts if pa_re.search(t)))
    qtype = 'match' if has_ans else ('combo' if pa_combo else ('match' if has_pa else 'single'))

    entry = {'id': qnum, 'chapter': chap_no, 'chapterTitle': chap_title, 'type': qtype}

    if qtype == 'single':
        stem, opts, cur = [], [], None
        for t in texts:
            m = single_opt_re.match(t)
            if m and m.group(2).lower() in 'abcde':
                if cur:
                    opts.append(cur)
                txt = re.sub(r'^\s*\*?\s*[a-eA-E]\s*[.)]\s*', '', m.group(3))
                cur = {'key': m.group(2).lower(), 'text': txt, 'correct': '*' in t}
            elif cur is None:
                stem.append(t)
            else:
                cur['text'] += ' ' + t
        if cur:
            opts.append(cur)
        merged, order = {}, []
        for o in opts:
            if o['key'] not in merged:
                merged[o['key']] = o; order.append(o['key'])
            else:
                merged[o['key']]['text'] += ' ' + o['text']
                merged[o['key']]['correct'] |= o['correct']
        entry['stem'] = clean(' '.join(stem))
        entry['options'] = [{'key': k, 'text': clean(merged[k]['text'])} for k in order]
        entry['answer'] = [k for k in order if merged[k]['correct']]

    elif qtype == 'combo':
        pa_idx = next(i for i, t in enumerate(texts) if pa_re.search(t))
        pa_text = texts[pa_idx]; j = pa_idx + 1
        while j < len(texts) and combo_seg_re.search(texts[j]):
            pa_text += ' ' + texts[j]; j += 1
        intro, stmts, cur = [], [], None
        for t in texts[:pa_idx]:
            m = st_re.match(t)
            if m:
                if cur:
                    stmts.append(cur)
                cur = {'n': int(m.group(1)), 'text': m.group(2)}
            elif cur is None:
                intro.append(t)
            else:
                cur['text'] += ' ' + t
        if cur:
            stmts.append(cur)
        options, answer = [], []
        for s1, letter, s2, nums in combo_seg_re.findall(pa_text):
            options.append({'key': letter, 'numbers': [int(x) for x in re.findall(r'\d+', nums)]})
            if s1 == '*' or s2 == '*':
                answer.append(letter)
        entry['stem'] = clean(' '.join(intro))
        entry['statements'] = [{'n': s['n'], 'text': clean(s['text'])} for s in stmts]
        entry['options'] = options
        entry['answer'] = answer

    else:  # match
        ans_line = [t for t in texts if ans_line_re.match(t)]
        ans_pairs = ans_re.findall(ans_line[-1]) if ans_line else []
        body = [s for s in seg if not pa_re.search(s['text']) and not ans_line_re.match(s['text'])]
        # option-pattern lines (consider two-up split)
        opt_lines = []
        for s in body:
            for p in split_two_up(s['text']):
                if opt_match(p):
                    opt_lines.append(s); break
        opt_xs = [s['x0'] for s in opt_lines]
        if opt_xs:
            min_ox, max_ox = min(opt_xs), max(opt_xs)
            oy = [s['y0'] for s in opt_lines]
            interleaved = any(min(oy) < s['y0'] < max(oy) and s['x0'] < min_ox - 20
                              for s in body if s not in opt_lines)
            right_box = max_ox >= 200 or interleaved
        else:
            right_box = False
        if right_box:
            split = min_ox - 10
            region = [s for s in body if s['x0'] >= split]
            stem = [s['text'] for s in body if s['x0'] < split]
            opts = parse_option_box(region)
        else:
            stem, opts, cur = [], [], None
            for s in body:
                om = opt_match(s['text'])
                if om:
                    if cur:
                        opts.append(cur)
                    cur = {'key': om[0], 'text': om[1]}
                elif cur is None:
                    stem.append(s['text'])
                else:
                    cur['text'] += ' ' + s['text']
            if cur:
                opts.append(cur)
            seen, uniq = set(), []
            for o in opts:
                if o['key'] not in seen:
                    seen.add(o['key']); uniq.append({'key': o['key'], 'text': clean(o['text'])})
            opts = uniq
        entry['stem'] = clean(' '.join(stem))
        entry['options'] = opts
        entry['answer'] = [{'blank': int(b), 'key': k.lower()} for b, k in ans_pairs]

    stats[qtype] += 1
    results.append(entry)

results.sort(key=lambda e: e['id'])

# ---- validation ------------------------------------------------------------
problems = []
for e in results:
    t = e['type']
    if t == 'single':
        if len(e['answer']) != 1:
            problems.append((e['id'], t, 'answers=%d' % len(e['answer'])))
        elif len(e['options']) < 2:
            problems.append((e['id'], t, 'opts=%d' % len(e['options'])))
    elif t == 'combo':
        if len(e['answer']) != 1 or len(e['options']) < 2 or not e.get('statements'):
            problems.append((e['id'], t, 'ans=%d opts=%d stmts=%d' %
                             (len(e['answer']), len(e['options']), len(e.get('statements', [])))))
    else:
        keys = {o['key'] for o in e['options']}
        if not e['answer']:
            problems.append((e['id'], t, 'no answer'))
        elif len(e['options']) < 2:
            problems.append((e['id'], t, 'opts=%d' % len(e['options'])))
        else:
            miss = [a['key'] for a in e['answer'] if a['key'] not in keys]
            if miss:
                problems.append((e['id'], t, 'missing %s have %s' % (miss, sorted(keys))))

print('stats:', stats, 'total:', len(results))
print('problems:', len(problems))
for p in problems:
    print('  Q%-3d [%s] %s' % p)
json.dump(results, io.open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('wrote', OUT)
