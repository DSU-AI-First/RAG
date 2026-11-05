import json
import os

from fastapi import APIRouter, HTTPException
from openai import OpenAI
from pinecone import Pinecone

from database.chat_store import chat_exists, new_chatid, save_exchange
from utilities.embed_upsert import INDEX_NAME, embed_query

router = APIRouter(tags=["chat"])


@router.post("/chat-response")
def chatresponse(query: str, chatid: str | None = None):
    if chatid is None:
        chatid = new_chatid()
    elif not chat_exists(chatid):
        raise HTTPException(status_code=404, detail="Chat not found")

    sparse_vector, dense_vector = embed(query)
    context = vector_search(sparse_vector, dense_vector)
    answer, source_ids = getLLMResponse(query, context)
    matches = {match.id: match for match in context}
    if any(source_id not in matches for source_id in source_ids):
        raise HTTPException(status_code=502, detail="The model cited a chunk that was not retrieved")

    save_exchange(chatid, query, answer)
    return {
        "chatid": chatid,
        "answer": answer,
        "sources": [
            {
                "chunk_id": source_id,
                "case_title": (matches[source_id].metadata or {}).get("title", ""),
                "case_id": (matches[source_id].metadata or {}).get("doc_id", "").replace("-", "_"),
                "paragraph_number": (matches[source_id].metadata or {}).get("para"),
                "text": (matches[source_id].metadata or {}).get("text", ""),
            }
            for source_id in source_ids
        ],
    }


def embed(text: str):
    return embed_query(text)


def vector_search(sparse_vector: dict, dense_vector: list[float]):
    index = Pinecone(api_key=os.environ["PINECONE_API_KEY"]).Index(INDEX_NAME)
    return index.query(
        vector=dense_vector,
        sparse_vector=sparse_vector,
        top_k=5,
        include_metadata=True,
    ).matches


def getLLMResponse(query: str, context) -> tuple[str, list[str]]:
    passages = []
    for match in context:
        metadata = match.metadata or {}
        source = " | ".join(
            str(metadata[key])
            for key in ("title", "citation", "section", "para")
            if metadata.get(key) is not None
        )
        passages.append(f"chunk_id: {match.id}\n{source}\n{metadata.get('text', '')}")

    client = OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=os.environ["NVIDIA_API_KEY"],
    )
    context_text = "\n\n".join(passages)
    completion = client.chat.completions.create(
        model="nvidia/nemotron-3.5-super-vl-120b-a12b",
        messages=[
            {
                "role": "system",
                "content": "Answer using only the provided context. Cite supporting chunks "
                "by their exact chunk_id. If the context does not support an answer, say so "
                "and return no source IDs. Return only JSON with string field 'answer' and "
                "array-of-string field 'source_ids'.",
            },
            {
                "role": "user",
                "content": f"Context:\n\n{context_text}\n\nQuestion:\n{query}",
            },
        ],
        temperature=1,
        top_p=0.95,
        max_tokens=2048,
    )
    content = completion.choices[0].message.content
    if not content:
        raise RuntimeError("The language model returned an empty response")

    try:
        result = json.loads(content)
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=502, detail="The model returned invalid JSON") from error

    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="The model returned an invalid answer format")
    answer, source_ids = result.get("answer"), result.get("source_ids")
    if not isinstance(answer, str) or not answer or not isinstance(source_ids, list) or not all(
        isinstance(source_id, str) for source_id in source_ids
    ):
        raise HTTPException(status_code=502, detail="The model returned an invalid answer format")
    return answer, source_ids
