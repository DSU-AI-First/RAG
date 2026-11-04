import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient


@lru_cache(maxsize=1)
def get_database():
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    client = MongoClient(os.environ["MONGODB_URI"])
    client.admin.command("ping")
    return client.get_default_database()


def get_collection(name="judgements"):
    return get_database()[name]
