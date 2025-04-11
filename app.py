import logging
import os
import json
import base64
from flask import Flask, render_template
from flask_socketio import SocketIO
from dotenv import load_dotenv
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
    DeepgramClientOptions,
)

load_dotenv()

# Initialize Flask and SocketIO
app = Flask(__name__)
socketio = SocketIO(
    app,
    cors_allowed_origins="*"  # Allow all origins since we're in development
)

API_KEY = os.getenv("DEEPGRAM_API_KEY")

# Load default configuration
with open("config/defaults.json", "r") as f:
    DEFAULT_CONFIG = json.load(f)

# Set up client configuration
config = DeepgramClientOptions(
    verbose=logging.INFO,
    options={"keepalive": "true"},
)

deepgram = None
dg_connection = None

# Flask routes
@app.route("/")
def index():
    return render_template("index.html")

# Deepgram connection handling
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

    dg_connection = deepgram.listen.websocket.v("1")

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

# SocketIO event handlers
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

if __name__ == "__main__":
    logging.info("Starting combined Flask-SocketIO server")
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True, port=8001)
