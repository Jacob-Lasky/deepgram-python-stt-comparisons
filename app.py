import logging
import os
import json
import base64
from flask import Flask, render_template
from flask_socketio import SocketIO
from dotenv import load_dotenv

from providers import Providers, DeepgramProvider, MicrosoftProvider

load_dotenv()

# Define colors for logging
class LogColors:
    RESET = '\033[0m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'
    WHITE = '\033[37m'

# Initialize Flask and SocketIO
app = Flask(__name__)
socketio = SocketIO(
    app,
    cors_allowed_origins="*"  # Allow all origins since we're in development
)

# Load provider-specific configurations
PROVIDER_CONFIGS = {}

# Load provider configurations
try:
    # Load Deepgram config
    with open("static/config/providers/deepgram.json", "r") as f:
        PROVIDER_CONFIGS["deepgram"] = json.load(f)
        logging.info("Successfully loaded Deepgram provider config")
    
    # Load Microsoft config
    with open("static/config/providers/microsoft.json", "r") as f:
        PROVIDER_CONFIGS["microsoft"] = json.load(f)
        logging.info("Successfully loaded Microsoft provider config")
except Exception as e:
    logging.error(f"Error loading provider configs: {e}")

# Initialize provider registry
providers = Providers()
active_providers = {}  # Dictionary to store active providers by ID

# Function to debug active_providers
def debug_active_providers():
    logging.debug(f"DEBUG: active_providers contains {len(active_providers)} items")
    for pid, provider in active_providers.items():
        provider_type = type(provider).__name__
        is_connected = provider.is_connected if hasattr(provider, 'is_connected') else 'unknown'
        logging.debug(f"DEBUG: Provider {pid} is of type {provider_type}, connected: {is_connected}")

def create_transcription_callback(provider_id):
    """Create a callback function for a specific provider ID."""
    def callback(result):
        # Add providerId to the result
        result["providerId"] = provider_id
        
        # Log the full result being sent to the client
        logging.debug(f"Emitting transcription from provider {provider_id}: {result}")
        
        # Ensure is_final is a boolean
        if "is_final" in result:
            result["is_final"] = bool(result["is_final"])
            logging.debug(f"is_final type: {type(result['is_final'])}, value: {result['is_final']}")
        
        socketio.emit("transcription_update", result)
    
    return callback

# Flask routes
@app.route("/")
def index():
    return render_template("index.html")

# Provider connection handling
def initialize_provider(provider_name: str, provider_id: int, config_options=None):
    global active_providers, PROVIDER_CONFIGS
    
    logging.info(f"INIT: Initializing provider '{provider_name}' with ID {provider_id}")
    logging.info(f"INIT: Current active_providers: {list(active_providers.keys())}")
    
    # Stop the provider if it's already active
    if provider_id in active_providers:
        logging.info(f"INIT: Provider ID {provider_id} already active, stopping it first")
        active_providers[provider_id].stop()
        
    # Get provider-specific default config
    provider_default_config = PROVIDER_CONFIGS.get(provider_name, {})
    logging.info(f"INIT: Loaded default config for provider '{provider_name}'")
    
    if provider_name == "deepgram":
        return initialize_deepgram(provider_default_config, provider_id, config_options)
    
    elif provider_name == "microsoft":
        return initialize_microsoft(provider_default_config, provider_id, config_options)
    
    else:
        logging.error(f"INIT: Unknown provider: {provider_name}")
        return False


def initialize_deepgram(provider_default_config, provider_id, config_options=None, provider_name="deepgram"):
    logging.info("INIT: Initializing Deepgram provider")
    # get API key from .env file
    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        logging.error("INIT: No Deepgram API key found in environment")
        return False
    logging.info("INIT: Found Deepgram API key in environment")
        
    # Create a callback specific to this provider ID
    callback = create_transcription_callback(provider_id)
    logging.info("INIT: Created callback for Deepgram provider")
    
    # Merge provider default config with user-provided config
    merged_config = provider_default_config.copy()
    if config_options:
        merged_config.update(config_options)
    logging.info(f"INIT: Merged config for Deepgram: {merged_config}")
    
    provider = DeepgramProvider(api_key, callback)
    logging.info("INIT: Created Deepgram provider instance")
    
    if not provider.initialize(merged_config):
        logging.error(f"INIT: Failed to initialize Deepgram provider {provider_id}")
        return False
    logging.info(f"INIT: Successfully initialized Deepgram provider {provider_id}")
        
    providers.add_provider(f"{provider_name}_{provider_id}", provider)
    active_providers[provider_id] = provider
    logging.info(f"INIT: Added Deepgram provider {provider_id} to active providers")
    return True


def initialize_microsoft(provider_default_config, provider_id, config_options=None, provider_name="microsoft"):
    logging.info("INIT: Initializing Microsoft provider")
    # get API key and region from .env file
    api_key = os.getenv("AZURE_SPEECH_KEY")
    region = os.getenv("AZURE_SPEECH_REGION")
        
    logging.info(f"INIT: Microsoft API key available: {'Yes' if api_key else 'No'}")
    logging.info(f"INIT: Microsoft region available: {'Yes' if region else 'No'}")
        
    if not api_key or not region:
        logging.error("INIT: No Microsoft Speech API key or region found in environment")
        return False
        
    # Create a callback specific to this provider ID
    callback = create_transcription_callback(provider_id)
    logging.info("INIT: Created callback for Microsoft provider")
    
    # Merge provider default config with user-provided config
    merged_config = provider_default_config.copy()
    if config_options:
        merged_config.update(config_options)
    logging.info(f"INIT: Merged config for Microsoft: {merged_config}")
    
    logging.info("INIT: Creating Microsoft provider instance")
    provider = MicrosoftProvider(api_key, region, callback)
    logging.info("INIT: Created Microsoft provider instance")
    
    logging.info("INIT: Initializing Microsoft provider with config")
    if not provider.initialize(merged_config):
        logging.error(f"INIT: Failed to initialize Microsoft provider {provider_id}")
        return False
    logging.info(f"INIT: Successfully initialized Microsoft provider {provider_id}")
        
    providers.add_provider(f"{provider_name}_{provider_id}", provider)
    active_providers[provider_id] = provider
    logging.info(f"INIT: Added Microsoft provider {provider_id} to active providers")
    logging.info(f"INIT: Updated active_providers: {list(active_providers.keys())}")
    return True
    

# SocketIO event handlers
@socketio.on("audio_stream")
def handle_audio_stream(data):
    global active_providers
    
    logging.debug(f"Received audio stream data: {type(data)} with keys {data.keys()}")
    logging.debug(f"AUDIO: Current active_providers: {list(active_providers.keys())}")
    
    # Extract just the audio data from the message
    audio_data = data.get('data')
    provider_id = data.get('providerId')
    
    if audio_data and provider_id is not None:
        # Only send to the specific provider it was intended for
        if provider_id in active_providers:
            provider = active_providers[provider_id]
            provider_type = type(provider).__name__
            logging.debug(f"AUDIO: Found provider {provider_id} of type {provider_type}")
            
            if provider.is_connected:
                logging.debug(f"AUDIO: Provider {provider_id} is connected, sending {len(audio_data)} bytes")
                provider.send(audio_data)
            else:
                logging.error(f"AUDIO: Provider {provider_id} is not connected, cannot send audio data")
        else:
            logging.error(f"AUDIO: Provider ID {provider_id} not found in active_providers")
            logging.info(f"AUDIO: Active providers: {list(active_providers.keys())}")
    else:
        if not audio_data:
            logging.warning("AUDIO: No audio data received")
        if provider_id is None:
            logging.warning("AUDIO: No provider ID received")

@socketio.on("toggle_transcription")
def handle_toggle_transcription(data):
    global active_providers
    
    logging.info(f"Received toggle_transcription event with data: {data}")
    logging.info(f"TOGGLE: Current active_providers before processing: {list(active_providers.keys())}")
    
    action = data.get("action")
    provider_name = data.get("provider", "deepgram")
    provider_id = data.get("providerId", 0)
    
    logging.info(f"PROVIDER SELECTION: Action={action}, Provider={provider_name}, ID={provider_id}")
    
    result = {"success": False, "message": "Unknown action"}
    
    if action == "start":
        logging.info(f"Starting {provider_name} connection for provider ID {provider_id}")
        config = data.get("config", {})
        logging.info(f"Using config: {config}")
        
        # Log environment variables for debugging
        if provider_name == "microsoft":
            azure_key = os.getenv("AZURE_SPEECH_KEY")
            azure_region = os.getenv("AZURE_SPEECH_REGION")
            logging.info(f"Azure credentials available: Key={'✓' if azure_key else '✗'}, Region={'✓' if azure_region else '✗'}")
            if azure_region:
                logging.info(f"Azure region: {azure_region}")
        
        logging.info(f"About to initialize {provider_name} provider...")
        init_success = initialize_provider(provider_name, provider_id, config)
        logging.info(f"Provider initialization result: {init_success}")
        
        if init_success:
            logging.info(f"Provider initialized successfully, starting {provider_name}...")
            
            # Double-check that provider was added to active_providers
            if provider_id not in active_providers:
                logging.error(f"CRITICAL: Provider {provider_id} not found in active_providers after initialization!")
                # Try to re-initialize
                if provider_name == "microsoft":
                    api_key = os.getenv("AZURE_SPEECH_KEY")
                    region = os.getenv("AZURE_SPEECH_REGION")
                    callback = create_transcription_callback(provider_id)
                    provider = MicrosoftProvider(api_key, region, callback)
                    if provider.initialize(config):
                        providers.add_provider(f"{provider_name}_{provider_id}", provider)
                        active_providers[provider_id] = provider
                        logging.info(f"Re-initialized Microsoft provider {provider_id} and added to active_providers")
                    else:
                        logging.error(f"Failed to re-initialize Microsoft provider {provider_id}")
                        result = {"success": False, "message": f"Failed to initialize {provider_name} provider {provider_id}"}
                        return result
            
            # Now start the provider
            start_success = active_providers[provider_id].start(config)
            logging.info(f"Provider start result: {start_success}")
            
            if start_success:
                logging.info(f"Started {provider_name} provider {provider_id} successfully")
                logging.info(f"Active providers after start: {list(active_providers.keys())}")
                # Double-check that the provider is actually in active_providers
                if provider_id in active_providers:
                    logging.info(f"Confirmed provider {provider_id} is in active_providers")
                    # Debug the provider's connection status
                    provider = active_providers[provider_id]
                    is_connected = provider.is_connected if hasattr(provider, 'is_connected') else 'unknown'
                    logging.info(f"Provider {provider_id} connection status: {is_connected}")
                    debug_active_providers()
                else:
                    logging.error(f"CRITICAL: Provider {provider_id} not found in active_providers after successful start!")
                result = {"success": True, "message": f"Started {provider_name} provider {provider_id} successfully"}
            else:
                error_msg = f"Failed to start {provider_name} provider {provider_id}"
                logging.error(error_msg)
                result = {"success": False, "message": error_msg}
        else:
            error_msg = f"Failed to initialize {provider_name} provider {provider_id}"
            logging.error(error_msg)
            result = {"success": False, "message": error_msg}
    
    elif action == "stop":
        logging.info(f"Attempting to stop provider {provider_id}")
        logging.info(f"Current active providers: {list(active_providers.keys())}")
        
        if provider_id in active_providers:
            logging.info(f"Stopping {provider_name} provider {provider_id}")
            active_providers[provider_id].stop()
            del active_providers[provider_id]
            logging.info(f"Provider {provider_id} stopped and removed from active providers")
            logging.info(f"Active providers after stop: {list(active_providers.keys())}")
            result = {"success": True, "message": f"Stopped {provider_name} provider {provider_id} successfully"}
        else:
            error_msg = f"No active provider with ID {provider_id}"
            logging.warning(error_msg)
            result = {"success": False, "message": error_msg}
    else:
        error_msg = f"Invalid action '{action}'"
        logging.warning(error_msg)
        result = {"success": False, "message": error_msg}
        
    # Return acknowledgment to the client
    return result

@socketio.on("connect")
def server_connect():
    logging.info("Client connected")

if __name__ == "__main__":
    # Create a custom formatter with colors based on provider
    class ColoredFormatter(logging.Formatter):
        def format(self, record):
            # Default format
            log_fmt = '%(levelname)s:%(name)s:%(message)s'
            
            # Add colors based on the provider
            if 'MSFT' in record.getMessage() or 'microsoft' in record.name.lower():
                # Blue for Microsoft
                log_fmt = f"{LogColors.BLUE}%(levelname)s:%(name)s:%(message)s{LogColors.RESET}"
            elif 'DG' in record.getMessage() or 'deepgram' in record.name.lower():
                # Green for Deepgram
                log_fmt = f"{LogColors.GREEN}%(levelname)s:%(name)s:%(message)s{LogColors.RESET}"
            elif 'ERROR' in record.levelname:
                # Red for errors
                log_fmt = f"{LogColors.RED}%(levelname)s:%(name)s:%(message)s{LogColors.RESET}"
            elif 'WARNING' in record.levelname:
                # Yellow for warnings
                log_fmt = f"{LogColors.YELLOW}%(levelname)s:%(name)s:%(message)s{LogColors.RESET}"
                
            formatter = logging.Formatter(log_fmt)
            return formatter.format(record)

    # Configure logging
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Remove existing handlers
    for handler in root_logger.handlers[:]:  
        root_logger.removeHandler(handler)

    # Create and add the new handler with our custom formatter
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(ColoredFormatter())
    root_logger.addHandler(stream_handler)

    # Suppress Deepgram websocket logs
    deepgram_loggers = [
        'deepgram.clients.listen_router',
        'deepgram.clients.common.v1.abstract_sync_websocket'
    ]
    for logger_name in deepgram_loggers:
        logging.getLogger(logger_name).setLevel(logging.ERROR)

    logging.info("Starting combined Flask-SocketIO server")
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True, port=8001)
