from uuid import uuid4

from database.mongodb import get_collection
from schemas.chat import Chat, Message


def new_chatid() -> str:
    return str(uuid4())


def chat_exists(chatid: str) -> bool:
    return get_collection("chats").find_one({"chatid": chatid}, {"_id": 1}) is not None


def save_exchange(chatid: str, query: str, answer: str) -> None:
    chats = get_collection("chats")
    chat = chats.find_one({"chatid": chatid})
    summary = chat["summary"] if chat else ""
    summary = f"{summary}\nUser: {query}\nAssistant: {answer}".strip()
    chats.update_one(
        {"chatid": chatid},
        {"$set": Chat(chatid=chatid, summary=summary[-4000:]).model_dump()},
        upsert=True,
    )

    messages = get_collection("messages")
    messages.insert_many(
        [
            Message(role="user", text=query, chatid=chatid).model_dump(),
            Message(role="assistant", text=answer, chatid=chatid).model_dump(),
        ]
    )
