from abc import ABC, abstractmethod
from typing import Dict, Any, Optional

class BaseSTTProvider(ABC):
    """Abstract base class for Speech-to-Text providers."""
    
    @abstractmethod
    def initialize(self, config: Dict[str, Any]) -> bool:
        """Initialize the STT provider with configuration."""
        pass
    
    @abstractmethod
    def start(self, options: Dict[str, Any]) -> bool:
        """Start the STT connection."""
        pass
    
    @abstractmethod
    def send(self, audio_data: bytes) -> None:
        """Send audio data to the STT provider."""
        pass
    
    @abstractmethod
    def stop(self) -> None:
        """Stop the STT connection."""
        pass
    
    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Check if the provider is currently connected."""
        pass
