import sqlite3
from pathlib import Path


DATABASE_PATH = Path(__file__).resolve().parent / "drishti.db"


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH)

    connection.row_factory = sqlite3.Row

    return connection


def initialize_database():

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            timestamp TEXT,
            detection_count INTEGER,
            detections TEXT
        )
        """
    )

    connection.commit()
    connection.close()


def save_detection(
    filename,
    timestamp,
    detection_count,
    detections
):

    connection = get_connection()

    cursor = connection.cursor()

    cursor.execute(
        """
        INSERT INTO detections
        (
            filename,
            timestamp,
            detection_count,
            detections
        )
        VALUES (?, ?, ?, ?)
        """,
        (
            filename,
            timestamp,
            detection_count,
            str(detections)
        )
    )

    connection.commit()

    connection.close()