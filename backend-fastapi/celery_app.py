import os
from pathlib import Path

from celery import Celery
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

celery_app = Celery(
    "ingestion",
    broker=os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672//"),
    include=["tasks"],
)
celery_app.conf.update(task_acks_late=True, worker_prefetch_multiplier=1)
