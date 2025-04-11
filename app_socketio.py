import logging
import os
import json
from flask import Flask, request, jsonify
from flask_socketio import SocketIO
from dotenv import load_dotenv
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
    DeepgramClientOptions,
)
from common.batch_audio import process_audio
import base64

load_dotenv()

app_socketio = Flask("app_socketio")
socketio = SocketIO(
    app_socketio,
    cors_allowed_origins=[
        "http://localhost:8001/",
        "http://localhost:8001",
        "http://localhost:8002/",
        "http://localhost:8002",
        "http://127.0.0.1:8001/",
        "http://127.0.0.1:8001",
        "http://127.0.0.1:8002/",
        "http://127.0.0.1:8002",
    ],
)

API_KEY = os.getenv("DEEPGRAM_API_KEY")

# Load default configuration
with open("config/defaults.json", "r") as f:
    DEFAULT_CONFIG = json.load(f)

# Set up client configuration
config = DeepgramClientOptions(
    verbose=logging.INFO,  # Change to logging.INFO or logging.DEBUG for more verbose output
    options={"keepalive": "true"},
)

deepgram = None
dg_connection = None


def initialize_deepgram_connection(config_options=None):
    global dg_connection, deepgram, config

    if not config_options:
        print("No configuration options provided")
        return

    # Update client config with base URL and create new client
    if "baseUrl" in config_options:
        base_url = config_options.pop("baseUrl")
        config.url = f"wss://{base_url}"  # Use wss:// for secure WebSocket
        deepgram = DeepgramClient(API_KEY, config)

    if not deepgram:
        print("No base URL provided")
        return

    dg_connection = deepgram.listen.websocket.v("1")  # Use websocket instead of live

    # Event handlers remain the same
    def on_open(self, open, **kwargs):
        print(f"\n\n{open}\n\n")

    def on_message(self, result, **kwargs):
        transcript = result.channel.alternatives[0].transcript
        if len(transcript) > 0:
            timing = {"start": result.start, "end": result.start + result.duration}

            socketio.emit(
                "transcription_update",
                {
                    "transcription": transcript,
                    "is_final": result.is_final,
                    "timing": timing,
                },
            )

    def on_close(self, close, **kwargs):
        print(f"\n\n{close}\n\n")

    def on_error(self, error, **kwargs):
        print(f"\n\n{error}\n\n")

    dg_connection.on(LiveTranscriptionEvents.Open, on_open)
    dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
    dg_connection.on(LiveTranscriptionEvents.Close, on_close)
    dg_connection.on(LiveTranscriptionEvents.Error, on_error)
    
    options = LiveOptions(**config_options)
    print(f"Starting Deepgram connection with options: {options}")

    if dg_connection.start(options) is False:
        print("Failed to start connection")
        exit()


@socketio.on("audio_stream")
def handle_audio_stream(data):
    if dg_connection:
        dg_connection.send(data)


@socketio.on("toggle_transcription")
def handle_toggle_transcription(data):
    global dg_connection
    print("toggle_transcription", data)
    action = data.get("action")
    if action == "start":
        print("Starting Deepgram connection")
        config = data.get("config", {})
        initialize_deepgram_connection(config)
    elif action == "stop" and dg_connection:
        print("Closing Deepgram connection")
        dg_connection.finish()
        dg_connection = None


@socketio.on("connect")
def server_connect():
    print("Client connected")


@socketio.on("restart_deepgram")
def restart_deepgram():
    print("Restarting Deepgram connection")
    initialize_deepgram_connection()


@socketio.on("upload_file")
def handle_file_upload(data):
    if "file" not in data:
        print("Error: No file provided in data")
        return {"error": "No file provided"}, 400

    file = data["file"]
    if not file:
        print("Error: Empty file object")
        return {"error": "No file selected"}, 400

    print(f"Received file: {file['name']}")
    print(f"File data length: {len(file['data'])}")

    # Save file temporarily
    temp_dir = "temp"
    os.makedirs(temp_dir, exist_ok=True)
    file_path = os.path.join(temp_dir, file["name"])
    print(f"Will save to: {file_path}")

    # Save the file
    try:
        file_data = base64.b64decode(file["data"].split(",")[1])
        print(f"Decoded file size: {len(file_data)} bytes")
        with open(file_path, "wb") as f:
            f.write(file_data)
        print(f"File saved successfully to {file_path}")
    except Exception as e:
        print(f"Error saving file: {str(e)}")
        return {"error": f"Error saving file: {str(e)}"}, 500

    try:
        # Use the config parameters from the client
        params = data.get("config", {})
        # Remove base_url as it's not needed for file processing
        params.pop("baseUrl", None)
        print(f"Processing audio with params: {params}")
        result = process_audio(file_path, params)
        print(f"Processing result: {result}")

        # Clean up
        os.remove(file_path)
        print(f"Temporary file removed: {file_path}")
        return result
    except Exception as e:
        print(f"Error processing audio: {str(e)}")
        if os.path.exists(file_path):
            os.remove(file_path)
            print(f"Temporary file removed after error: {file_path}")
        return {"error": str(e)}, 500


if __name__ == "__main__":
    logging.info("Starting SocketIO server.")
    socketio.run(app_socketio, debug=True, allow_unsafe_werkzeug=True, port=5001)
