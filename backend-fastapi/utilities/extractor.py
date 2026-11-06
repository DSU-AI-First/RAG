import base64
import json
import os
from typing import Any

import pymupdf
import requests

PARSE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
PARSE_MODEL = "nvidia/nemotron-parse"


def _extract_text(value: Any) -> list[str]:
    if isinstance(value, dict):
        text = value.get("text")
        return [text] if isinstance(text, str) else []
    if isinstance(value, list):
        return [text for item in value for text in _extract_text(item)]
    return []


def extractor(pdf_content: bytes) -> str:
    if not pdf_content.startswith(b"%PDF-"):
        raise ValueError("Uploaded file is not a PDF")

    if "NVIDIA_API_KEY" not in os.environ:
        raise RuntimeError("NVIDIA_API_KEY is not set")

    pages = []
    with pymupdf.open(stream=pdf_content, filetype="pdf") as document:
        for page in document:
            image = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).tobytes("png")
            image_data = base64.b64encode(image).decode("ascii")
            response = requests.post(
                PARSE_URL,
                headers={"Authorization": f"Bearer {os.environ['NVIDIA_API_KEY']}"},
                json={
                    "model": PARSE_MODEL,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/png;base64,{image_data}"},
                                },
                            ],
                        }
                    ],
                    "temperature": 0,
                    "max_tokens": 4096,
                },
                timeout=120,
            )
            response.raise_for_status()
            message = response.json()["choices"][0]["message"]
            content = message.get("content")
            if content is None:
                tool_calls = message.get("tool_calls", [])
                if not tool_calls:
                    raise RuntimeError("Nemotron Parse returned no extracted text")
                parsed = json.loads(tool_calls[0]["function"]["arguments"])
                content = "\n".join(_extract_text(parsed))
            pages.append(content)

    return "\n\n".join(pages)
