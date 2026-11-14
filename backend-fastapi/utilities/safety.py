import json
import os

from fastapi import HTTPException
from openai import APIError, OpenAI

QUERY_SAFETY_MODEL = "nvidia/llama-3.1-nemotron-safety-guard-8b-v3"
RESPONSE_SAFETY_MODEL = "nvidia/llama-3.1-nemotron-safety-guard-8b-v3"

QUERY_SAFETY_PROMPT = """You moderate queries to a legal research assistant about
Indian Supreme Court judgments.

Neutral legal questions, including discussion of crimes or violence in judgments,
are safe. Mark a query unsafe only if it seeks actionable instructions for harm
or crime, threatens or targets a person, requests highly sensitive personal
information, or asks for definitive personalized legal advice.

Return only JSON with "User Safety" set to "safe" or "unsafe"."""

RESPONSE_SAFETY_PROMPT = """You moderate answers from a legal research assistant
about Indian Supreme Court judgments.

Use the user message only as context. Evaluate whether the assistant response is
unsafe. Neutral legal explanations, including discussion of crimes or violence in
judgments, are safe. Mark a response unsafe only if it provides actionable
instructions for harm or crime, threatens or targets a person, exposes highly
sensitive personal information, or gives definitive personalized legal advice.

Return only JSON with "User Safety" and "Response Safety" set to "safe" or "unsafe"."""


def _check_safety(model_env: str, model: str, prompt: str, text: str, rating: str) -> bool:
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="NVIDIA_API_KEY is not set")

    client = OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=api_key)
    try:
        completion = client.chat.completions.create(
            model=os.getenv(model_env, model),
            messages=[{"role": "user", "content": f"{prompt}\n\n{text}"}],
            temperature=0,
            max_tokens=128,
        )
    except APIError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    if not completion.choices:
        raise HTTPException(status_code=503, detail="Safety screening returned no result")

    content = completion.choices[0].message.content
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=503, detail="Safety screening returned no result")

    try:
        result = json.loads(content)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=503,
            detail="Safety screening returned invalid JSON",
        ) from error

    value = result.get(rating) if isinstance(result, dict) else None
    if not isinstance(value, str) or value.lower() not in ("safe", "unsafe"):
        raise HTTPException(status_code=503, detail="Safety screening returned an invalid rating")
    return value.lower() == "safe"


def check_query_safety(query: str) -> bool:
    return _check_safety(
        "NEMOTRON_QUERY_SAFETY_MODEL",
        QUERY_SAFETY_MODEL,
        QUERY_SAFETY_PROMPT,
        f"User message:\n{query}",
        "User Safety",
    )


def check_response_safety(query: str, response: str) -> bool:
    return _check_safety(
        "NEMOTRON_RESPONSE_SAFETY_MODEL",
        RESPONSE_SAFETY_MODEL,
        RESPONSE_SAFETY_PROMPT,
        f"User message:\n{query}\n\nAssistant response:\n{response}",
        "Response Safety",
    )
