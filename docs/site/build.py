import html
import re
from datetime import date
from pathlib import Path

HERE = Path(__file__).parent
DOCS = HERE.parent
OUT = HERE / "dist"
SRC = (DOCS / "design-doc.md").read_text(encoding="utf-8")

# LaTeX blocks in document order, rendered as plain formulas.
FORMULAS = [
    "w<sub>e</sub> = 基礎機率<sub>e</sub> × ∏ 條件倍率",
    "讀書效率 = (1 + 0.1 × 加派代幣) × S × 咖啡因係數 × 其他標籤係數",
    "S = max(0.3, 1 − 0.07 × 睡眠債)",
    "考試分數 = 累積學業進度 × S<sub>考試當天</sub>",
    "咖啡因睡眠係數 = 1 − 0.4 × min(1, 就寢殘留 ÷ 100)",
    "P = 0.3 × (1 + 免疫怨氣 ÷ 100) × m<sub>高壓</sub> × m<sub>睡眠債</sub>",
]

SEVERITY = {"日常": "sev-low", "中等": "sev-mid", "嚴重": "sev-high", "危機": "sev-crit"}


def inline(text):
    text = html.escape(text, quote=False)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        r'<a href="\2" target="_blank" rel="noopener">\1</a>',
        text,
    )
    return text


def cell(text):
    m = re.match(r"^(日常|中等|嚴重|危機)(.*)$", text)
    if m and m.group(2) in ("", "（正向）", "，可升級"):
        extra = m.group(2).strip("（），")
        note = f'<span class="chip-note">{extra}</span>' if extra else ""
        return f'<span class="chip {SEVERITY[m.group(1)]}">{m.group(1)}</span>{note}'
    return inline(text)


def flow_svg():
    W, H, rowA, rowB, c1, c2, c3, dy = 200, 72, 150, 360, 130, 380, 630, 250

    def box(cx, cy, name, l1, l2, main=False):
        cls = "box main" if main else "box"
        top = cy - H / 2
        return (
            f'<g><rect class="{cls}" x="{cx - W / 2}" y="{top}" width="{W}" height="{H}" rx="8"/>'
            f'<text class="t-name" x="{cx}" y="{top + 24}">{name}</text>'
            f'<text class="t-line" x="{cx}" y="{top + 44}">{l1}</text>'
            f'<text class="t-line" x="{cx}" y="{top + 60}">{l2}</text></g>'
        )

    paths = [
        f"M{c1 + W / 2} {rowA}H{c2 - W / 2}",
        f"M{c2 + W / 2} {rowA}H{c3 - W / 2}",
        f"M{c3} {rowA - H / 2}V86H{c1}V{rowA - H / 2}",
        f"M{c2} {rowA + H / 2}V{dy - 36}",
        f"M{c2 + 90} {dy}H580V{rowA + H / 2}",
        f"M{c2} {dy + 36}V{rowB - H / 2}",
        f"M{c2 - W / 2} {rowB}H{c1 + W / 2}",
        f"M{c1} {rowB - H / 2}V{rowA + H / 2}",
        f"M680 {rowA + H / 2}V{rowB - H / 2}",
    ]
    edges = "".join(f'<path d="{p}" marker-end="url(#arrow)"/>' for p in paths)
    return f"""<svg class="diagram" viewBox="0 64 760 340" role="img" aria-label="每天三個階段循環 10 天，倒閉就帶著知識重來">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arrowhead"/></marker></defs>
<g class="edges">{edges}</g>
{box(c1, rowA, "早上：規劃", "晨會聽各部門回報", "選日程卡與三餐")}
{box(c2, rowA, "白天：即時經營", "處理暫停式調度危機", "處理突發事件卡", main=True)}
{box(c3, rowA, "晚上：睡眠結算", "夜班清潔隊修復部門", "結算怨氣與狀態標籤")}
<g><polygon class="box" points="{c2 - 90},{dy} {c2},{dy - 36} {c2 + 90},{dy} {c2},{dy + 36}"/><text class="t-name" x="{c2}" y="{dy + 5}">觸發倒閉條件？</text></g>
{box(c2, rowB, "倒閉調查報告", "追溯事故的因果經過", "解鎖對應手冊頁面")}
{box(c1, rowB, "跨局進度", "保留手冊頁面與福利", "可選擇從期中考重來")}
{box(c3, rowB, "第 10 天期末考", "成績與健康報告決定結局", "過關解鎖下一位宿主")}
<text class="t-edge" x="{c2}" y="78" text-anchor="middle">隔天</text>
<text class="t-edge" x="{c2 + 100}" y="{dy - 8}">否</text>
<text class="t-edge" x="{c2 + 10}" y="{dy + 58}">是：第二次送急診才倒閉</text>
<text class="t-edge" x="{c1 + 10}" y="{dy + 4}">新的一局</text>
<text class="t-edge" x="672" y="{dy + 50}" text-anchor="end">第 10 天結束</text>
</svg>"""


def timeline_svg():
    rows = [
        ("企劃定稿與原型", "2026-10-05", "2026-10-18"),
        ("期中提案", "2026-10-19", "2026-10-19"),
        ("核心系統開發", "2026-10-20", "2026-11-08"),
        ("Alpha 版可玩", "2026-11-08", "2026-11-08"),
        ("內容量產", "2026-11-09", "2026-11-29"),
        ("期末測驗週", "2026-11-23", "2026-11-23"),
        ("平衡與除錯", "2026-11-30", "2026-12-06"),
        ("成果發表", "2026-12-07", "2026-12-07"),
    ]
    d = lambda s: date.fromisoformat(s).toordinal()
    lo, hi = d(rows[0][1]), d(rows[-1][2])
    X = lambda s: 200 + (d(s) - lo) / (hi - lo) * 432
    md = lambda s: f"{int(s[5:7])}/{int(s[8:])}"
    parts = []
    for k in range(0, hi - lo + 1, 7):
        day = date.fromordinal(lo + k).isoformat()
        x = X(day)
        parts.append(f'<line class="grid" x1="{x:.1f}" x2="{x:.1f}" y1="88" y2="350"/>')
        parts.append(f'<text class="t-tick" x="{x:.1f}" y="78" text-anchor="middle">{md(day)}</text>')
    parts.append('<line class="axis" x1="200" x2="632" y1="88" y2="88"/>')
    for i, (name, start, end) in enumerate(rows):
        y = 114 + 32 * i
        last = i == len(rows) - 1
        cls = "accent" if last else ""
        parts.append(f'<line class="grid" x1="200" x2="{X(start):.1f}" y1="{y}" y2="{y}"/>')
        if start == end:
            x = X(start)
            parts.append(f'<path class="mark {cls}" d="M{x:.1f} {y - 8}l8 8l-8 8l-8 -8z"/>')
            label = md(start)
        else:
            parts.append(
                f'<rect class="span" x="{X(start):.1f}" y="{y - 7}" width="{X(end) - X(start):.1f}" height="14" rx="7"/>'
            )
            label = f"{md(start)} 到 {md(end)}"
        weight = ' font-weight="700"' if last else ""
        parts.append(f'<text class="t-date"{weight} x="{X(end) + 14:.1f}" y="{y + 4}">{label}</text>')
        parts.append(f'<text class="t-row"{weight} x="24" y="{y + 4}">{name}</text>')
    body = "".join(parts)
    return f'<svg class="diagram" viewBox="0 60 760 300" role="img" aria-label="建議時程：10/19 提案、11/8 Alpha、12/7 發表">{body}</svg>'


def figure(svg, caption):
    return f'<figure class="fig"><div class="fig-scroll">{svg}</div><figcaption>{caption}</figcaption></figure>'


def memo(text):
    parts = re.split(r"\*\*([^*]+)\*\*：", text)
    rows = []
    for i in range(1, len(parts), 2):
        rows.append(f"<dt>{html.escape(parts[i])}</dt><dd>{inline(parts[i + 1].strip())}</dd>")
    return (
        '<aside class="memo"><div class="memo-head"><span>倒閉調查報告</span><span>範例</span></div>'
        f'<dl>{"".join(rows)}</dl></aside>'
    )


def convert(md):
    lines = md.splitlines()
    out, toc = [], []
    i, h2n, h3n, formula_i, skip = 0, 0, 0, 0, False
    while i < len(lines):
        line = lines[i]
        if line.startswith("# ") or re.match(r"^(\w{3} \d+, \d{4}|\d{4}-\d{2}-\d{2}) ·", line):
            i += 1
            continue
        if line.startswith("## "):
            title = line[3:].strip()
            skip = title == "目錄"
            if skip:
                i += 1
                continue
            h2n += 1
            h3n = 0
            sid = f"s{h2n}"
            toc.append((2, sid, title, h2n))
            out.append(f'<h2 id="{sid}"><span class="num">{h2n:02d}</span>{inline(title)}</h2>')
            i += 1
            continue
        if skip:
            i += 1
            continue
        if line.startswith("### "):
            h3n += 1
            sid = f"s{h2n}-{h3n}"
            title = line[4:].strip()
            toc.append((3, sid, title, h3n))
            out.append(f'<h3 id="{sid}">{inline(title)}</h3>')
            i += 1
            continue
        if line.startswith("&#91;embedded content:"):
            if "核心循環" in line:
                out.append(figure(flow_svg(), "核心循環：一天三個階段，觸發倒閉條件時第一次住院、第二次倒閉"))
            else:
                out.append(figure(timeline_svg(), "建議時程：Alpha 版須在 11/8 前可玩，才有三週量產內容"))
            i += 1
            continue
        if line.startswith("```"):
            lang = line[3:].strip()
            body = []
            i += 1
            while not lines[i].startswith("```"):
                body.append(lines[i])
                i += 1
            i += 1
            if lang in ("latex", "math"):
                out.append(f'<div class="formula">{FORMULAS[formula_i]}</div>')
                formula_i += 1
            elif lang == "mermaid":
                # The design doc's two Mermaid diagrams are redrawn as hand-built SVG for the reading site.
                if body and body[0].strip() == "gantt":
                    out.append(figure(timeline_svg(), "建議時程：Alpha 版須在 11/8 前可玩，才有三週量產內容"))
                else:
                    out.append(figure(flow_svg(), "核心循環：一天三個階段，觸發倒閉條件時第一次住院、第二次倒閉"))
            else:
                code = html.escape("\n".join(body))
                out.append(f'<div class="code-wrap"><pre><code>{code}</code></pre></div>')
            continue
        if line.startswith("|"):
            block = []
            while i < len(lines) and lines[i].startswith("|"):
                block.append([c.strip() for c in lines[i].strip("|").split("|")])
                i += 1
            head, rows = block[0], block[2:]
            th = "".join(f"<th>{inline(c)}</th>" for c in head)
            trs = "".join("<tr>" + "".join(f"<td>{cell(c)}</td>" for c in r) + "</tr>" for r in rows)
            out.append(f'<div class="table-wrap"><table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>')
            continue
        if line.startswith("- ["):
            items = []
            while i < len(lines) and lines[i].startswith("- ["):
                done = lines[i][3] == "x"
                text = inline(lines[i][6:])
                items.append(f'<li class="{"done" if done else ""}"><span class="box-check" aria-hidden="true"></span>{text}</li>')
                i += 1
            out.append(f'<ul class="tasks">{"".join(items)}</ul>')
            continue
        if re.match(r"^\d+\. ", line):
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i]):
                items.append(f"<li>{inline(re.sub(r'^\d+\. ', '', lines[i]))}</li>")
                i += 1
            out.append(f"<ol>{''.join(items)}</ol>")
            continue
        if line.startswith("> "):
            out.append(memo(line[2:]))
            i += 1
            continue
        if line.strip():
            out.append(f"<p>{inline(line.strip())}</p>")
        i += 1
    return "\n".join(out), toc


def toc_html(toc):
    parts, open_sub = [], False
    for level, sid, title, n in toc:
        if level == 2:
            if open_sub:
                parts.append("</ol></li>")
                open_sub = False
            elif parts:
                parts.append("</li>")
            parts.append(f'<li><a href="#{sid}" data-target="{sid}"><span class="num">{n:02d}</span>{html.escape(title)}</a>')
        else:
            if not open_sub:
                parts.append('<ol class="sub">')
                open_sub = True
            parts.append(f'<li><a href="#{sid}" data-target="{sid}">{html.escape(title)}</a></li>')
    parts.append("</ol></li>" if open_sub else "</li>")
    return "".join(parts)


import markdown
from markdown.extensions.toc import slugify_unicode

SPEC_DIR = DOCS / "specs"
PAGES = [
    ("index.html", "遊戲設計文件（本文）", None),
    ("content-spec.html", "附錄：內容規格", "content-spec.md"),
    ("ux-spec.html", "附錄：玩家體驗流程與文案規格", "ux-spec.md"),
    ("factcheck.html", "附錄：衛教查證表", "factcheck.md"),
]
NOTE_MAIN = "本頁由 docs/design-doc.md 轉成，方便用側邊目錄跳讀。原文件更新後需重新產生本頁；內容以該檔案為準。"
NOTE_APPENDIX = "本附錄為 2026-10-05 初稿，尚待組員審閱。附錄與設計文件本文不一致時，以本文為準。"


def tex_to_text(tex):
    s = tex
    s = re.sub(r"\\(?:Big|big|left|right)\s*([()\[\]|.])", lambda m: "" if m.group(1) == "." else m.group(1), s)
    s = re.sub(r"\\operatorname\{([^}]*)\}", r"\1", s)
    s = re.sub(r"\\(?:text|mathrm|textrm)\{([^{}]*)\}", r"\1", s)
    s = s.replace(r"\begin{cases}", "{ ").replace(r"\end{cases}", " }")
    s = re.sub(r"\\\\(\[[^\]]*\])?", "；", s)
    s = s.replace("&", "，當 ")
    for _ in range(4):
        s = re.sub(r"\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}", r"(\1) ÷ (\2)", s)
    s = s.replace(r"\Delta", "Δ")
    s = re.sub(r"_\{([^}]*)\}", r"<sub>\1</sub>", s)
    s = re.sub(r"_([A-Za-z0-9]+)", r"<sub>\1</sub>", s)
    s = re.sub(r"\^\{([^}]*)\}", r"<sup>\1</sup>", s)
    s = re.sub(r"\^([A-Za-z0-9\u4e00-\u9fff]+)", r"<sup>\1</sup>", s)
    repl = {r"\times": "×", r"\cdot": "·", r"\prod": "∏", r"\sum": "∑", r"\min": "min", r"\max": "max",
            r"\le": "≤", r"\ge": "≥", r"\quad": " ", r"\,": " ", r"\!": "", r"\ ": " ", "\\\\": "<br>"}
    for k, v in repl.items():
        s = s.replace(k, v)
    s = s.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", s).strip()


def render_appendix(md_text):
    lines = md_text.splitlines()
    title = lines[0][2:].strip() if lines and lines[0].startswith("# ") else ""
    body_md = "\n".join(lines[1:])
    md = markdown.Markdown(
        extensions=["tables", "fenced_code", "sane_lists", "toc"],
        extension_configs={"toc": {"slugify": slugify_unicode, "toc_depth": "2-3"}},
    )
    html_body = md.convert(body_md)
    html_body = re.sub(
        r'<pre><code class="language-mermaid">(.*?)</code></pre>',
        lambda m: f'<pre class="mermaid">{m.group(1)}</pre>', html_body, flags=re.S)
    html_body = re.sub(
        r'<pre><code class="language-latex">(.*?)</code></pre>',
        lambda m: f'<div class="formula tex">{tex_to_text(html.unescape(m.group(1)))}</div>', html_body, flags=re.S)
    html_body = re.sub(r"(<pre><code.*?</code></pre>)", r'<div class="code-wrap">\1</div>', html_body, flags=re.S)
    html_body = re.sub(r"(<table>.*?</table>)", r'<div class="table-wrap">\1</div>', html_body, flags=re.S)
    html_body = re.sub(r'<a href="(https?://[^"]+)"', r'<a href="\1" target="_blank" rel="noopener"', html_body)
    toc = []
    n2 = 0
    for tok in md.toc_tokens:
        if tok["level"] != 2:
            continue
        n2 += 1
        toc.append((2, tok["id"], html.unescape(tok["name"]), n2))
        for k, child in enumerate(tok["children"], 1):
            if child["level"] == 3:
                toc.append((3, child["id"], html.unescape(child["name"]), k))
    return title, html_body, toc


def pages_html(current):
    items = []
    for fname, label, _ in PAGES:
        cls = ' class="here" aria-current="page"' if fname == current else ""
        # The published artifact serves the main page at its root, not at /index.html.
        href = "./" if fname == "index.html" else fname
        items.append(f'<li><a href="{href}"{cls}>{html.escape(label)}</a></li>')
    return "".join(items)


def link_appendix_files(body):
    for fname, label, src in PAGES:
        if src:
            body = body.replace(f"<td>{src}</td>", f'<td><a href="{fname}">{src}</a></td>')
    return body


template = (HERE / "template.html").read_text(encoding="utf-8")
SKELETON_HEAD = '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'


def fill(title, eyebrow, h1, note, toc, body, current):
    return (template.replace("{{TITLE}}", html.escape(title)).replace("{{EYEBROW}}", eyebrow)
            .replace("{{H1}}", html.escape(h1)).replace("{{NOTE}}", note)
            .replace("{{TOC}}", toc_html(toc)).replace("{{PAGES}}", pages_html(current))
            .replace("{{BODY}}", body))


body, toc = convert(SRC)
main_page = fill("人體股份有限公司 設計文件", "人體股份有限公司 · 企劃部", "遊戲設計文件", NOTE_MAIN, toc,
                 link_appendix_files(body), "index.html")
OUT.mkdir(exist_ok=True)
(OUT / "index.html").write_text(main_page, encoding="utf-8")
print("index.html sections:", sum(1 for t in toc if t[0] == 2), "bytes:", len(main_page.encode()))

for fname, label, src in PAGES[1:]:
    title, abody, atoc = render_appendix((SPEC_DIR / src).read_text(encoding="utf-8"))
    h1 = label.replace("附錄：", "")
    page = fill(f"人體股份有限公司 {h1}", "人體股份有限公司 · 設計文件附錄", h1, NOTE_APPENDIX, atoc, abody, fname)
    page = SKELETON_HEAD + page.replace("<style>", "<style>\nbody { margin: 0; }", 1)
    page = page.replace("\n<div class=\"shell\">", "\n</head>\n<body>\n<div class=\"shell\">", 1) + "\n</body>\n</html>\n"
    (OUT / fname).write_text(page, encoding="utf-8")
    print(fname, "sections:", sum(1 for t in atoc if t[0] == 2), "bytes:", len(page.encode()))
