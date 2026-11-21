import hashlib
import html
import re
from collections import Counter

MAX_WORDS = 500


def clean(md: str) -> tuple[list[str], str, str]:
    """Unescape HTML, flatten links, drop repeated headings (running page headers)."""
    md = html.unescape(re.sub(r"\[([^\]]*(?:\[[^\]]*\])?[^\]]*)\]\(https?://[^)]*\)", r"\1", md))
    blocks = [b.strip() for b in md.split("\n\n") if b.strip()]
    counts = Counter(b for b in blocks if b.startswith("## "))
    title = next((h[3:] for h, c in counts.most_common() if c > 1 and " v. " in h), "")
    citation = (re.search(r"\d{4} INSC \d+", md) or [""])[0]
    return [b for b in blocks if counts.get(b, 0) <= 1], title, citation


def join(blocks: list[str]) -> str:
    """Join blocks, healing sentences that were cut at a page break."""
    text = ""
    for b in blocks:
        text += b if not text else (" " if text[-1] not in '.:;"”)' else "\n\n") + b
    return text


def pack(units: list[tuple]) -> list[list[tuple]]:
    """Greedily group units; a unit that would overflow MAX_WORDS starts a new group.
    A unit larger than MAX_WORDS becomes its own group — never split mid-paragraph."""
    groups, group, words = [], [], 0
    for unit in units:
        unit_words = len(unit[2].split())
        if group and (words + unit_words > MAX_WORDS or unit[0] != group[0][0]):
            groups.append(group)
            group, words = [], 0
        group.append(unit)
        words += unit_words
    if group:
        groups.append(group)
    return groups


def chunker(md: str, source: str = "") -> list[dict]:
    if source.lower().endswith(".md"):
        source = source[:-3] + ".pdf"
    blocks, title, citation = clean(md)
    doc_id = citation.replace(" ", "-") or hashlib.sha1(md.encode()).hexdigest()[:10]

    # Body starts at the first LINE that opens numbered paragraph 1 (plain-text
    # extractors don't align paragraphs to blank-line blocks).
    front_blocks, body_lines = [], []
    for b in blocks:
        if body_lines:
            body_lines.extend(b.split("\n"))
            continue
        lines = b.split("\n")
        start = next((i for i, ln in enumerate(lines) if re.match(r"\s*1\.\s", ln)), None)
        if start is None:
            front_blocks.append(b)
        else:
            if start:
                front_blocks.append("\n".join(lines[:start]))
            body_lines.extend(lines[start:])

    units, section, buf = [], "front matter", []
    for b in front_blocks + [None]:
        if b is None or b.startswith("## "):
            if buf:
                units.append((section, None, join(buf)))
            section, buf = (b[3:] if b else section), []
        else:
            buf.append(b)

    paras, n = {}, 1
    for line in body_lines:
        if m := re.match(rf"\s*{n}\.\s+(.*)", line):
            paras[n], n = [m.group(1)], n + 1
        elif n > 1:
            paras[n - 1].append(line)
    units += [("judgment", k, join(v)) for k, v in paras.items()]

    chunks = []
    for group in pack(units):
        sec, para = group[0][0], group[0][1]
        para_end = group[-1][1]
        if para and para_end != para:
            label = f"Paras {para}-{para_end}"
        else:
            label = f"Para {para}" if para else sec
        text = "\n\n".join(unit[2] for unit in group)
        chunks.append({
            "chunk_id": f"{doc_id}_{len(chunks)}",
            "doc_id": doc_id, "source": source, "title": title, "citation": citation,
            "section": sec, "para": para, "para_end": para_end, "part": 1, "total_parts": 1,
            "word_count": len(text.split()), "text": text,
            "embed_text": f"{title} | {citation} | {label}\n{text}",
        })
    return chunks
