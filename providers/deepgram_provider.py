import logging
from typing import Dict, Any, Optional, Callable
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
    DeepgramClientOptions,
)

from .base import BaseSTTProvider

class DeepgramProvider(BaseSTTProvider):
    def __init__(self, api_key: str, on_transcription: Callable):
        """
        Initialize the Deepgram provider.
        
        Args:
            api_key: Deepgram API key
            on_transcription: Callback function for transcription updates
        """
        self.api_key = api_key
        self.on_transcription = on_transcription
        self.client = None
        self.connection = None
        self._config = DeepgramClientOptions(
            verbose=logging.WARNING,
            options={"keepalive": "true"},
        )

    def initialize(self, config: Dict[str, Any]) -> bool:
        """Initialize the Deepgram client with configuration."""
        try:
            logging.info(f"DG: Initializing Deepgram provider with config: {config}")
            self._config.url = f"wss://api.deepgram.com"
            
            self.client = DeepgramClient(self.api_key, self._config)
            self.connection = self.client.listen.websocket.v("1")
            
            # Set up event handlers
            self.connection.on(LiveTranscriptionEvents.Open, self._on_open)
            self.connection.on(LiveTranscriptionEvents.Transcript, self._on_message)
            self.connection.on(LiveTranscriptionEvents.Close, self._on_close)
            self.connection.on(LiveTranscriptionEvents.Error, self._on_error)
            
            return True
        except Exception as e:
            logging.error(f"DG: Failed to initialize Deepgram: {e}")
            return False

    def start(self, options: Dict[str, Any]) -> bool:
        """Start the Deepgram connection with the given options."""
        if not self.connection:
            logging.error("DG: Deepgram connection not initialized")
            return False
            
        live_options = LiveOptions(**options)
        return self.connection.start(live_options)

    def send(self, audio_data: bytes) -> None:
        """Send audio data to Deepgram."""
        logging.debug(f"DG: Send method called, connection status: is_connected={self.is_connected}")
        if self.connection and self.is_connected:
            self.connection.send(audio_data)

    def stop(self) -> None:
        """Stop the Deepgram connection."""
        if self.connection:
            try:
                logging.info("DG: Stopping Deepgram connection")
                self.connection.finish()
                logging.info("DG: Stopped Deepgram connection successfully")
            except Exception as e:
                logging.error(f"DG: Error stopping Deepgram connection: {e}")
            finally:
                self.connection = None

    @property
    def is_connected(self) -> bool:
        """Check if Deepgram is currently connected."""
        logging.debug(f"DG: Checking connection status: is_connected={self.connection is not None}")
        return self.connection is not None

    def _on_open(self, client, open_event, **kwargs):
        """Handle connection open event."""
        logging.info(f"DG: Deepgram connection opened: {open_event}")

    def _on_message(self, client, result, **kwargs):
        """Handle transcription message event."""
        logging.debug(f"DG: Received transcription message: {result}")
        transcript = result.channel.alternatives[0].transcript
        if len(transcript) > 0:
            if result.is_final:
                logging.info(f"DG: Recieved finalized transcript")
            else:
                logging.info(f"DG: Received interim transcript")

            logging.debug(f"DG: Sending transcription to callback: {transcript}")
            timing = {"start": result.start, "end": result.start + result.duration}
            self.on_transcription({
                "transcription": transcript,
                "is_final": result.is_final,
                "timing": timing,
            })

    def _on_close(self, client, close_event, **kwargs):
        """Handle connection close event."""
        logging.info(f"DG: Deepgram connection closed: {close_event}")

    def _on_error(self, client, error, **kwargs):
        """Handle error event."""
        logging.error(f"DG: Deepgram error: {error}")
