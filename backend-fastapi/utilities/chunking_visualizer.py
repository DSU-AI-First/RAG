import re
from typing import Dict, List, Sequence, Tuple

import pymupdf

ChunkRange = Tuple[int, int]
TOKEN_PATTERN = re.compile(r"\w+|[^\w\s]", re.UNICODE)


def extract_pdf_text(content: bytes) -> str:
    try:
        with pymupdf.open(stream=content, filetype="pdf") as document:
            return "\n\n".join(page.get_text("text", sort=True) for page in document)
    except pymupdf.FileDataError as error:
        raise ValueError("The uploaded PDF could not be read") from error


def _fixed_ranges(text: str, chunk_size: int, overlap: int) -> List[ChunkRange]:
    step = chunk_size - overlap
    return [
        (start, min(start + chunk_size, len(text)))
        for start in range(0, len(text), step)
    ]


def _recursive_ranges(
    text: str, start: int, end: int, chunk_size: int, overlap: int
) -> List[ChunkRange]:
    separators = ("\n\n", "\n", ". ", " ")
    ranges = []
    position = start
    while position < end:
        limit = min(position + chunk_size, end)
        if limit == end:
            ranges.append((position, end))
            break

        next_position = None
        for separator in separators:
            last_start = limit - len(separator)
            separator_start = text.rfind(separator, position, last_start + 1)
            if separator_start > position:
                next_position = separator_start + len(separator)
                break
        if next_position is None:
            next_position = limit

        ranges.append((position, next_position))
        if next_position == end:
            break
        position = max(position + 1, next_position - overlap)
    return ranges


def _paragraph_ranges(text: str) -> List[ChunkRange]:
    return [
        (match.start(), match.end())
        for match in re.finditer(r"\S.*?(?=\n\s*\n|\Z)", text, re.DOTALL)
    ]


def _sentence_ranges(text: str) -> List[ChunkRange]:
    ranges = []
    start = 0
    for match in re.finditer(r"[.!?][\"'’”)]*\s+", text):
        end = match.end()
        if text[start:end].strip():
            ranges.append((start, end))
        start = end
    if text[start:].strip():
        ranges.append((start, len(text)))
    return ranges


def _group_ranges(
    text: str, units: Sequence[ChunkRange], chunk_size: int
) -> List[ChunkRange]:
    if not units:
        return []

    ranges = []
    start, end = units[0]
    for unit_start, unit_end in units[1:]:
        if unit_end - start <= chunk_size:
            end = unit_end
            continue
        ranges.extend(_recursive_ranges(text, start, end, chunk_size, 0))
        start, end = unit_start, unit_end
    ranges.extend(_recursive_ranges(text, start, end, chunk_size, 0))
    return ranges


def _to_utf16_offsets(text: str, chunks: List[Dict[str, object]]) -> None:
    offsets = sorted(
        {int(chunk["start"]) for chunk in chunks}
        | {int(chunk["end"]) for chunk in chunks}
    )
    converted = {}
    offset_index = 0
    utf16_offset = 0
    for character_offset, character in enumerate(text):
        while offset_index < len(offsets) and offsets[offset_index] == character_offset:
            converted[offsets[offset_index]] = utf16_offset
            offset_index += 1
        utf16_offset += 2 if ord(character) > 0xFFFF else 1
    while offset_index < len(offsets):
        converted[offsets[offset_index]] = utf16_offset
        offset_index += 1

    for chunk in chunks:
        chunk["start_utf16"] = converted[int(chunk["start"])]
        chunk["end_utf16"] = converted[int(chunk["end"])]


def generate_chunks(
    text: str, strategy: str, chunk_size: int, chunk_overlap: int
) -> List[Dict[str, object]]:
    if not text:
        return []
    if strategy == "fixed":
        ranges = _fixed_ranges(text, chunk_size, 0)
    elif strategy == "fixed_overlap":
        ranges = _fixed_ranges(text, chunk_size, chunk_overlap)
    elif strategy == "paragraph":
        ranges = _group_ranges(text, _paragraph_ranges(text), chunk_size)
    elif strategy == "sentence":
        ranges = _group_ranges(text, _sentence_ranges(text), chunk_size)
    elif strategy == "recursive":
        ranges = _recursive_ranges(text, 0, len(text), chunk_size, chunk_overlap)
    else:
        raise ValueError("Unknown chunking strategy")

    chunks = []
    for start, end in ranges:
        chunk_text = text[start:end]
        chunks.append(
            {
                "index": len(chunks),
                "text": chunk_text,
                "start": start,
                "end": end,
                "characters": len(chunk_text),
                "token_count": len(TOKEN_PATTERN.findall(chunk_text)),
            }
        )
    _to_utf16_offsets(text, chunks)
    return chunks
