import logging
import os
import time
import threading
import asyncio
import traceback
import io
from typing import Dict, Any, Callable, Optional

# Check if Azure Speech SDK is available
try:
    import azure.cognitiveservices.speech as speechsdk
    AZURE_SDK_AVAILABLE = True
    logging.info("Azure Speech SDK imported successfully")
except ImportError:
    AZURE_SDK_AVAILABLE = False
    logging.error("Failed to import Azure Speech SDK. Make sure it's installed with: pip install azure-cognitiveservices-speech")

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
        self.speech_recognizer = None
        self._is_connected = False
        self._stop_recognition = False
        self._audio_stream = None
        self._config = {}
        
        # Create an event loop for the background thread
        self._loop = None
        self._thread = None

    def initialize(self, config: Dict[str, Any]) -> bool:
        """Initialize the Microsoft Speech client with configuration."""
        if not AZURE_SDK_AVAILABLE:
            logging.error("MSFT: Cannot initialize - Azure Speech SDK not available")
            return False
            
        # Validate API key and region
        if not self.api_key or len(self.api_key.strip()) < 10:
            logging.error("MSFT: Invalid API key - too short or empty")
            return False
            
        if not self.region or len(self.region.strip()) < 2:
            logging.error("MSFT: Invalid region - too short or empty")
            return False
            
        try:
            logging.info(f"MSFT: Initializing Microsoft provider with config: {config}")
            logging.info(f"MSFT: Using API key: {self.api_key[:4]}... and region: {self.region}")
            
            self._config = config
            
            # Create a new event loop for the background thread
            self._loop = asyncio.new_event_loop()
            
            # Create the speech config
            self.speech_config = speechsdk.SpeechConfig(
                subscription=self.api_key, 
                region=self.region
            )
            logging.info("MSFT: Created SpeechConfig successfully")
            
            # Configure speech recognition based on provided options
            language = config.get("language", "en-US")
            self.speech_config.speech_recognition_language = language
            logging.info(f"MSFT: Set speech recognition language to {language}")

            # Configure profanity filter
            if config.get("profanity_filter", False):
                self.speech_config.set_profanity(speechsdk.ProfanityOption.Masked)
            else:
                self.speech_config.set_profanity(speechsdk.ProfanityOption.Raw)
            
            # Set up the audio stream with ANY format to support WebM
            format = speechsdk.audio.AudioStreamFormat(compressed_stream_format=speechsdk.AudioStreamContainerFormat.ANY)
            self._audio_stream = speechsdk.audio.PushAudioInputStream(format)
            logging.info("MSFT: Created PushAudioInputStream with ANY format successfully")
            
            audio_config = speechsdk.audio.AudioConfig(stream=self._audio_stream)
            logging.info("MSFT: Created AudioConfig successfully")
            
            # Create the speech recognizer
            self.speech_recognizer = speechsdk.SpeechRecognizer(
                speech_config=self.speech_config, 
                audio_config=audio_config,
                language=language
            )
            logging.info("MSFT: Created SpeechRecognizer successfully")
            
            # Set up event handlers
            self.speech_recognizer.recognizing.connect(self._on_recognizing)
            self.speech_recognizer.recognized.connect(self._on_recognized)
            self.speech_recognizer.session_started.connect(self._on_session_started)
            self.speech_recognizer.session_stopped.connect(self._on_session_stopped)
            self.speech_recognizer.canceled.connect(self._on_canceled)
            logging.info("MSFT: Connected all event handlers successfully")
            
            return True
        except Exception as e:
            logging.error(f"MSFT: Error initializing Microsoft provider: {e}")
            logging.error(f"MSFT: Exception details: {traceback.format_exc()}")
            return False

    def start(self, options: Dict[str, Any]) -> bool:
        """Start the Microsoft Speech connection with the given options."""
        if not self.speech_recognizer:
            logging.error("MSFT: Microsoft Speech recognizer not initialized")
            return False
        
        try:
            logging.info(f"MSFT: Starting Microsoft provider with options: {options}")
            
            # Update config with any new options
            self._config.update(options)
            logging.info(f"MSFT: Updated config: {self._config}")
            
            # Set connection status
            self._stop_recognition = False
            self._is_connected = True
            logging.info(f"MSFT: Set connection status to True, is_connected={self.is_connected}")
            
            # Start recognition in a separate thread
            def run_recognition_loop():
                asyncio.set_event_loop(self._loop)
                try:
                    logging.info("MSFT: Starting continuous recognition")
                    self.speech_recognizer.start_continuous_recognition()
                    logging.info("MSFT: Continuous recognition started successfully")
                    
                    # Keep the loop running
                    while not self._stop_recognition:
                        time.sleep(0.1)
                        
                    # Stop recognition when requested
                    self.speech_recognizer.stop_continuous_recognition()
                    logging.info("MSFT: Continuous recognition stopped")
                except Exception as e:
                    logging.error(f"MSFT: Error in recognition thread: {e}")
                    logging.error(f"MSFT: Exception details: {traceback.format_exc()}")
                    self._is_connected = False
            
            # Start the thread
            self._thread = threading.Thread(target=run_recognition_loop)
            self._thread.daemon = True
            self._thread.start()
            logging.info("MSFT: Started recognition thread")
            
            return True
        except Exception as e:
            logging.error(f"MSFT: Error starting Microsoft provider: {e}")
            logging.error(f"MSFT: Exception details: {traceback.format_exc()}")
            self._is_connected = False
            logging.info("MSFT: Set connection status to False due to error")
            return False

    

    def send(self, audio_data: bytes) -> None:
        """Send audio data to Microsoft Speech."""
        logging.debug(f"MSFT: Send method called, connection status: is_connected={self.is_connected}")
        
        if not self._is_connected:
            logging.error("MSFT: Cannot send audio - not connected")
            return
            
        if not self._audio_stream:
            logging.error("MSFT: Cannot send audio - no audio stream")
            return
            
        try:
            # Log audio data size
            logging.debug(f"MSFT: Sending {len(audio_data)} bytes of audio data")
            
            # Send the WebM audio data directly to the stream
            # The AudioStreamFormat with ANY format should handle WebM correctly
            self._audio_stream.write(audio_data)
            logging.debug("MSFT: Successfully wrote audio data to stream")
        except Exception as e:
            logging.error(f"MSFT: Error sending audio data to Microsoft Speech: {e}")
            logging.error(f"MSFT: Exception details: {traceback.format_exc()}")


    def stop(self) -> None:
        """Stop the Microsoft Speech connection."""
        logging.info(f"MSFT: Stop method called, current connection status: is_connected={self.is_connected}")
        
        if self._is_connected:
            logging.info("MSFT: Provider is connected, stopping recognition")
            self._stop_recognition = True
            self._is_connected = False
            logging.info(f"MSFT: Set _is_connected to False, new status: is_connected={self.is_connected}")
            
            # Wait for the thread to finish
            if self._thread and self._thread.is_alive():
                logging.info("MSFT: Waiting for recognition thread to finish")
                self._thread.join(timeout=2.0)  # Wait up to 2 seconds for the thread to finish
            
            # Close the audio stream
            if self._audio_stream:
                try:
                    logging.info("MSFT: Closing audio stream")
                    self._audio_stream.close()
                    logging.info("MSFT: Successfully closed audio stream")
                except Exception as e:
                    logging.error(f"MSFT: Error closing audio stream: {e}")
                self._audio_stream = None
                
            logging.info("MSFT: Provider successfully stopped")
        else:
            logging.info("MSFT: Provider was not connected, nothing to stop")

    @property
    def is_connected(self) -> bool:
        """Check if Microsoft Speech is currently connected."""
        logging.debug(f"MSFT: Checking connection status: _is_connected={self._is_connected}")
        return self._is_connected

    def _on_recognizing(self, evt):
        """Handle interim recognition results."""
        logging.info(f"MSFT: Received interim recognition event")
        if evt.result.text:
            logging.debug(f"MSFT: Interim transcription: {evt.result.text}")
            # Send the transcription through the callback
            self.on_transcription({
                "transcription": evt.result.text,
                "is_final": False,
                "timing": {"start": 0, "end": 0},  # Microsoft doesn't provide timing info in the same way
            })
        else:
            logging.info("MSFT: Received empty interim recognition result")

    def _on_recognized(self, evt):
        """Handle final recognition results."""
        logging.info(f"MSFT: Received final recognition event")
        if evt.result.text:
            logging.debug(f"MSFT: Final transcription: {evt.result.text}")
            # Send the final transcription through the callback
            self.on_transcription({
                "transcription": evt.result.text,
                "is_final": True,
                "timing": {"start": 0, "end": 0},  # Microsoft doesn't provide timing info in the same way
            })
        else:
            logging.info("MSFT: Received empty final recognition result")

    def _on_session_started(self, evt):
        """Handle session start event."""
        logging.info(f"MSFT: Session started: {evt}")
        logging.info("MSFT: Recognition session has started successfully")

    def _on_session_stopped(self, evt):
        """Handle session stop event."""
        logging.info(f"MSFT: Session stopped: {evt}")
        self._is_connected = False
        logging.info("MSFT: Set connection status to False due to session stop")

    def _on_canceled(self, evt):
        """Handle cancellation event."""
        logging.error(f"MSFT: Recognition canceled: {evt.reason}")
        if evt.reason == speechsdk.CancellationReason.Error:
            logging.error(f"MSFT: Error details: {evt.error_details}")
            # Add more detailed error information
            if hasattr(evt, 'error_code'):
                logging.error(f"MSFT: Error code: {evt.error_code}")
            if hasattr(evt, 'result'):
                logging.error(f"MSFT: Result: {evt.result}")
        self._is_connected = False
        logging.error("MSFT: Set connection status to False due to cancellation")
