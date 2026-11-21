from uuid import uuid4

from database.mongodb import get_collection
from schemas.chat import Chat, Message


def new_chatid() -> str:
    return str(uuid4())


def chat_exists(chatid: str) -> bool:
    return get_collection("chats").find_one({"chatid": chatid}, {"_id": 1}) is not None


def list_chats() -> list[dict]:
    cursor = (
        get_collection("chats")
        .find({}, {"_id": 0, "chatid": 1, "title": 1})
        .sort("time", -1)
    )
    return [{"chatid": chat["chatid"], "title": chat.get("title", "")} for chat in cursor]


def rename_chat(chatid: str, title: str) -> bool:
    result = get_collection("chats").update_one({"chatid": chatid}, {"$set": {"title": title}})
    return result.matched_count > 0


def delete_chat(chatid: str) -> bool:
    result = get_collection("chats").delete_one({"chatid": chatid})
    if result.deleted_count == 0:
        return False
    get_collection("messages").delete_many({"chatid": chatid})
    return True


def get_messages(chatid: str) -> list[dict]:
    cursor = (
        get_collection("messages")
        .find({"chatid": chatid}, {"_id": 0, "role": 1, "text": 1, "sources": 1})
        .sort("time", 1)
    )
    return [
        {
            "role": message["role"],
            "text": message["text"],
            "sources": message.get("sources", []),
        }
        for message in cursor
    ]


def save_exchange(chatid: str, query: str, answer: str, sources: list[dict]) -> None:
    chats = get_collection("chats")
    chat = chats.find_one({"chatid": chatid})
    summary = chat["summary"] if chat else ""
    summary = f"{summary}\nUser: {query}\nAssistant: {answer}".strip()
    title = (chat or {}).get("title") or query[:120]
    chats.update_one(
        {"chatid": chatid},
        {"$set": Chat(chatid=chatid, title=title, summary=summary[-4000:]).model_dump()},
        upsert=True,
    )

    messages = get_collection("messages")
    messages.insert_many(
        [
            Message(role="user", text=query, chatid=chatid).model_dump(),
            Message(role="assistant", text=answer, sources=sources, chatid=chatid).model_dump(),
        ]
    )
