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
active_providers = {}  # Dictionary to store active providers by ID

def create_transcription_callback(provider_id):
    """Create a callback function for a specific provider ID."""
    def callback(result):
        # Add providerId to the result
        result["providerId"] = provider_id
        
        # Log the full result being sent to the client
        logging.info(f"Emitting transcription from provider {provider_id}: {result}")
        
        # Ensure is_final is a boolean
        if "is_final" in result:
            result["is_final"] = bool(result["is_final"])
            logging.info(f"is_final type: {type(result['is_final'])}, value: {result['is_final']}")
        
        socketio.emit("transcription_update", result)
    
    return callback

# Flask routes
@app.route("/")
def index():
    return render_template("index.html")

# Provider connection handling
def initialize_provider(provider_name: str, provider_id: int, config_options=None):
    global active_providers
    
    # Stop the provider if it's already active
    if provider_id in active_providers:
        active_providers[provider_id].stop()
    
    if provider_name == "deepgram":
        # get API key from .env file
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            logging.error("No Deepgram API key found in environment")
            return False
        
        # Create a callback specific to this provider ID
        callback = create_transcription_callback(provider_id)
        
        provider = DeepgramProvider(api_key, callback)
        if not provider.initialize(config_options or {}):
            logging.error(f"Failed to initialize Deepgram provider {provider_id}")
            return False
            
        providers.add_provider(f"{provider_name}_{provider_id}", provider)
        active_providers[provider_id] = provider
        return True
    
    logging.error(f"Unknown provider: {provider_name}")
    return False

# SocketIO event handlers
@socketio.on("audio_stream")
def handle_audio_stream(data):
    logging.info(f"Received audio stream data: {type(data)} with keys {data.keys()}")
    # Extract just the audio data from the message
    audio_data = data.get('data')
    provider_id = data.get('providerId')
    
    if audio_data and provider_id is not None:
        # Only send to the specific provider it was intended for
        if provider_id in active_providers and active_providers[provider_id].is_connected:
            logging.info(f"Sending audio data to provider {provider_id}")
            active_providers[provider_id].send(audio_data)
    else:
        logging.warning("Received audio data without provider ID or audio data")

@socketio.on("toggle_transcription")
def handle_toggle_transcription(data):
    global active_providers
    
    logging.info(f"Received toggle_transcription event with data: {data}")
    
    action = data.get("action")
    provider_name = data.get("provider", "deepgram")
    provider_id = data.get("providerId", 0)
    
    if action == "start":
        logging.info(f"Starting {provider_name} connection for provider ID {provider_id}")
        config = data.get("config", {})
        logging.info(f"Using config: {config}")
        
        if initialize_provider(provider_name, provider_id, config):
            active_providers[provider_id].start(config)
            logging.info(f"Started {provider_name} provider {provider_id} successfully")
        else:
            logging.error(f"Failed to initialize {provider_name} provider {provider_id}")
    
    elif action == "stop":
        if provider_id in active_providers:
            logging.info(f"Stopping {provider_name} provider {provider_id}")
            active_providers[provider_id].stop()
            del active_providers[provider_id]
        else:
            logging.warning(f"No active provider with ID {provider_id}")
    else:
        logging.warning(f"Invalid action '{action}'")

@socketio.on("connect")
def server_connect():
    logging.info("Client connected")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("Starting combined Flask-SocketIO server")
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True, port=8001)
