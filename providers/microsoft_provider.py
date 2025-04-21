import logging
import os
import time
import threading
from typing import Dict, Any, Optional, Callable
import azure.cognitiveservices.speech as speechsdk

from .base import BaseSTTProvider

class MicrosoftProvider(BaseSTTProvider):
    def __init__(self, api_key: str, region: str, on_transcription: Callable):
        """
        Initialize the Microsoft Speech-to-Text provider.
        
        Args:
            api_key: Microsoft Speech API key
            region: Microsoft Speech region (e.g., 'eastus')
            on_transcription: Callback function for transcription updates
        """
        self.api_key = api_key
        self.region = region
        self.on_transcription = on_transcription
        self.speech_config = None
        self.audio_config = None
        self.speech_recognizer = None
        self._is_connected = False
        self._stop_recognition = False
        self._audio_stream = None
        self._push_stream = None
        self._config = {}

    def initialize(self, config: Dict[str, Any]) -> bool:
        """Initialize the Microsoft Speech client with configuration."""
        try:
            self._config = config
            self.speech_config = speechsdk.SpeechConfig(
                subscription=self.api_key, 
                region=self.region
            )
            
            # Configure speech recognition based on provided options
            if "language" in config:
                self.speech_config.speech_recognition_language = config["language"]
            
            # Set up the audio stream that we'll push audio data into
            self._audio_stream = speechsdk.audio.PushAudioInputStream()
            self.audio_config = speechsdk.audio.AudioConfig(stream=self._audio_stream)
            
            # Create the speech recognizer
            self.speech_recognizer = speechsdk.SpeechRecognizer(
                speech_config=self.speech_config, 
                audio_config=self.audio_config
            )
            
            # Set up event handlers
            self.speech_recognizer.recognizing.connect(self._on_recognizing)
            self.speech_recognizer.recognized.connect(self._on_recognized)
            self.speech_recognizer.session_started.connect(self._on_session_started)
            self.speech_recognizer.session_stopped.connect(self._on_session_stopped)
            self.speech_recognizer.canceled.connect(self._on_canceled)
            
            return True
        except Exception as e:
            logging.error(f"Failed to initialize Microsoft Speech: {e}")
            return False

    def start(self, options: Dict[str, Any]) -> bool:
        """Start the Microsoft Speech connection with the given options."""
        if not self.speech_recognizer:
            logging.error("Microsoft Speech recognizer not initialized")
            return False
        
        try:
            # Update config with any new options
            self._config.update(options)
            
            # Start continuous recognition
            self._stop_recognition = False
            self._is_connected = True
            
            # Start recognition in a separate thread to not block
            threading.Thread(target=self._start_continuous_recognition).start()
            
            return True
        except Exception as e:
            logging.error(f"Failed to start Microsoft Speech: {e}")
            self._is_connected = False
            return False

    def _start_continuous_recognition(self):
        """Start continuous recognition in a separate thread."""
        try:
            # Start continuous recognition
            self.speech_recognizer.start_continuous_recognition()
            
            # Keep the thread alive while recognition is active
            while not self._stop_recognition:
                time.sleep(0.1)
                
            # Stop recognition when requested
            self.speech_recognizer.stop_continuous_recognition()
        except Exception as e:
            logging.error(f"Error in continuous recognition: {e}")
            self._is_connected = False

    def send(self, audio_data: bytes) -> None:
        """Send audio data to Microsoft Speech."""
        if self._is_connected and self._audio_stream:
            try:
                self._audio_stream.write(audio_data)
            except Exception as e:
                logging.error(f"Error sending audio data to Microsoft Speech: {e}")

    def stop(self) -> None:
        """Stop the Microsoft Speech connection."""
        if self._is_connected:
            self._stop_recognition = True
            self._is_connected = False
            
            # Close the audio stream
            if self._audio_stream:
                try:
                    self._audio_stream.close()
                except:
                    pass
                self._audio_stream = None

    @property
    def is_connected(self) -> bool:
        """Check if Microsoft Speech is currently connected."""
        return self._is_connected

    def _on_recognizing(self, evt):
        """Handle interim recognition results."""
        if evt.result.text:
            self.on_transcription({
                "transcription": evt.result.text,
                "is_final": False,
                "timing": {"start": 0, "end": 0},  # Microsoft doesn't provide timing info in the same way
            })

    def _on_recognized(self, evt):
        """Handle final recognition results."""
        if evt.result.text:
            self.on_transcription({
                "transcription": evt.result.text,
                "is_final": True,
                "timing": {"start": 0, "end": 0},  # Microsoft doesn't provide timing info in the same way
            })

    def _on_session_started(self, evt):
        """Handle session start event."""
        logging.info(f"Microsoft Speech session started: {evt}")

    def _on_session_stopped(self, evt):
        """Handle session stop event."""
        logging.info(f"Microsoft Speech session stopped: {evt}")
        self._is_connected = False

    def _on_canceled(self, evt):
        """Handle cancellation event."""
        logging.error(f"Microsoft Speech recognition canceled: {evt.reason}")
        if evt.reason == speechsdk.CancellationReason.Error:
            logging.error(f"Error details: {evt.error_details}")
        self._is_connected = False
