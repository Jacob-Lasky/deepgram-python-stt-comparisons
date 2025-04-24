from typing import Dict, Optional
from .base import BaseSTTProvider
from .deepgram_provider import DeepgramProvider
from .microsoft_provider import MicrosoftProvider

class Providers:
    """Registry for STT providers."""
    
    def __init__(self):
        self.providers: Dict[str, BaseSTTProvider] = {}

    def add_provider(self, name: str, provider: BaseSTTProvider) -> None:
        """Register a new STT provider."""
        self.providers[name] = provider

    def get_provider(self, name: str) -> Optional[BaseSTTProvider]:
        """Get a provider by name."""
        return self.providers.get(name)

__all__ = ['BaseSTTProvider', 'DeepgramProvider', 'MicrosoftProvider', 'Providers']