import logging
import os
import json
import base64
from flask import Flask, render_template
from flask_socketio import SocketIO
from dotenv import load_dotenv

from providers import Providers, DeepgramProvider

load_dotenv()

# Initialize Flask and SocketIO
app = Flask(__name__)
socketio = SocketIO(
    app,
    cors_allowed_origins="*"  # Allow all origins since we're in development
)

# Load default configuration
with open("config/defaults.json", "r") as f:
    DEFAULT_CONFIG = json.load(f)

# Initialize provider registry
providers = Providers()
active_provider = None

def emit_transcription(result):
    """Callback function for transcription updates."""
    # Add providerId to the result
    if active_provider:
        result["providerId"] = 0  # Use 0 as the default provider ID
    
    # Log the full result being sent to the client
    logging.info(f"Emitting transcription to client: {result}")
    
    # Ensure is_final is a boolean
    if "is_final" in result:
        result["is_final"] = bool(result["is_final"])
        logging.info(f"is_final type: {type(result['is_final'])}, value: {result['is_final']}")
    
    socketio.emit("transcription_update", result)

# Flask routes
@app.route("/")
def index():
    return render_template("index.html")

# Provider connection handling
def initialize_provider(provider_name: str, config_options=None):
    global active_provider
    
    if active_provider:
        active_provider.stop()
        active_provider = None
    
    if provider_name == "deepgram":
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            logging.error("No Deepgram API key found in environment")
            return False
            
        provider = DeepgramProvider(api_key, emit_transcription)
        if not provider.initialize(config_options or {}):
            logging.error("Failed to initialize Deepgram provider")
            return False
            
        providers.add_provider(provider_name, provider)
        active_provider = provider
        return True
    
    logging.error(f"Unknown provider: {provider_name}")
    return False

# SocketIO event handlers
@socketio.on("audio_stream")
def handle_audio_stream(data):
    logging.info(f"Received audio stream data: {type(data)} with keys {data.keys()}")
    if active_provider and active_provider.is_connected:
        # Extract just the audio data from the message
        audio_data = data.get('data')
        if audio_data:
            logging.info(f"Sending audio data of type {type(audio_data)} to provider {data['providerId']}")
            active_provider.send(audio_data)

@socketio.on("toggle_transcription")
def handle_toggle_transcription(data):
    global active_provider
    
    logging.info(f"Received toggle_transcription event with data: {data}")
    
    action = data.get("action")
    provider_name = data.get("provider", "deepgram")
    
    if action == "start":
        logging.info(f"Starting {provider_name} connection")
        config = data.get("config", {})
        logging.info(f"Using config: {config}")
        
        if initialize_provider(provider_name, config):
            active_provider.start(config)
            logging.info(f"Started {provider_name} provider successfully")
        else:
            logging.error(f"Failed to initialize {provider_name} provider")
    
    elif action == "stop" and active_provider:
        logging.info(f"Stopping {provider_name} connection")
        active_provider.stop()
        active_provider = None
    else:
        logging.warning(f"Invalid action '{action}' or no active provider")

@socketio.on("connect")
def server_connect():
    logging.info("Client connected")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("Starting combined Flask-SocketIO server")
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True, port=8001)
