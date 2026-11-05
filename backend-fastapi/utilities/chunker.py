import hashlib
import html
import re
from collections import Counter

MAX_WORDS = 450


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


def split_long(text: str) -> list[str]:
    """Cut at 450 words; each next part restarts at the sentence that was cut."""
    words = text.split()
    if len(words) <= MAX_WORDS:
        return [text]
    parts, start = [], 0
    while True:
        end = min(start + MAX_WORDS, len(words))
        parts.append(" ".join(words[start:end]))
        if end == len(words):
            return parts
        start = next((i for i in range(end - 1, start + MAX_WORDS // 2, -1)
                      if words[i - 1].rstrip("”\"’')").endswith((".", "?", "!"))), end)


def chunker(md: str, source: str = "") -> list[dict]:
    if source.lower().endswith(".md"):
        source = source[:-3] + ".pdf"
    blocks, title, citation = clean(md)
    doc_id = citation.replace(" ", "-") or hashlib.sha1(md.encode()).hexdigest()[:10]
    body_start = next((i for i, b in enumerate(blocks) if re.match(r"1\.\s", b)), len(blocks))

    units, section, buf = [], "front matter", []
    for b in blocks[:body_start] + [None]:
        if b is None or b.startswith("## "):
            if buf:
                units.append((section, None, join(buf)))
            section, buf = (b[3:] if b else section), []
        else:
            buf.append(b)

    paras, n = {}, 1
    for b in blocks[body_start:]:
        for line in b.split("\n"):
            if m := re.match(rf"{n}\.\s+(.*)", line):
                paras[n], n = [m.group(1)], n + 1
            elif n > 1:
                paras[n - 1].append(line)
    units += [("judgment", k, join(v)) for k, v in paras.items()]

    chunks = []
    for i, (sec, para, text) in enumerate(units):
        label = f"Para {para}" if para else sec
        parts = split_long(text)
        for j, part in enumerate(parts, 1):
            chunks.append({
                "chunk_id": f"{doc_id}_{len(chunks)}",
                "doc_id": doc_id, "source": source, "title": title, "citation": citation,
                "section": sec, "para": para, "part": j, "total_parts": len(parts),
                "word_count": len(part.split()), "text": part,
                "embed_text": f"{title} | {citation} | {label}\n{part}",
            })
    return chunks
