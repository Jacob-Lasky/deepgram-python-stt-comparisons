let providers = [];
let socket;
const socket_port = 8001;

// Provider configurations
let PROVIDER_CONFIGS = {};

// Load provider configurations
async function loadProviderConfigs() {
    try {
        // Load Deepgram config
        const deepgramResponse = await fetch('../static/config/providers/deepgram.json');
        if (deepgramResponse.ok) {
            PROVIDER_CONFIGS.deepgram = await deepgramResponse.json();
        }
        
        // Load Microsoft config
        const microsoftResponse = await fetch('../static/config/providers/microsoft.json');
        if (microsoftResponse.ok) {
            PROVIDER_CONFIGS.microsoft = await microsoftResponse.json();
        }
        
        console.log('Loaded provider configurations:', PROVIDER_CONFIGS);
    } catch (error) {
        console.error('Error loading provider configurations:', error);
    }
}

// Initialize everything when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
    console.log('Initializing application...');
    
    // Load provider configurations first
    await loadProviderConfigs();

    // Initialize socket
    console.log('Initializing socket connection...');
    socket = io("http://" + window.location.hostname + ":" + socket_port.toString());
    
    // Add the first provider automatically
    setTimeout(() => {
        if (providers.length === 0) {
            addProvider();
        }
    }, 500);

    // Set up socket event handlers
    socket.on('connect', () => {
        console.log('Client: Connected to server');
        console.log('Socket ID:', socket.id);
    });

    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
    });

    socket.on('disconnect', () => {
        console.log('Client: Disconnected from server');
        // Stop recording for all providers
        providers.forEach(provider => {
            if (provider.isRecording) {
                const recordButton = provider.getElement('.mic-checkbox');
                if (recordButton) recordButton.checked = false;
                stopRecording(provider);
            }
        });
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });

    // Set up transcription update handler
    socket.on("transcription_update", (data) => {
        console.log('Received transcription update:', data);
        
        const provider = providers.find(p => p.id === data.providerId);
        if (!provider) {
            console.error('Provider not found for ID:', data.providerId);
            return;
        }
        
        const finalCaptions = provider.getElement(".finalCaptions");
        if (!finalCaptions) {
            console.error('Final captions container not found');
            return;
        }
        
        // Update final container
        if (data.is_final) {
            console.log('Processing FINAL transcription:', data.transcription);
            // Remove any existing interim span
            const existingInterim = finalCaptions.querySelector('.interim-final');
            if (existingInterim) {
                existingInterim.remove();
            }
            // For final results, append as a new span
            const finalDiv = document.createElement("span");
            finalDiv.textContent = data.transcription + " ";
            finalDiv.className = "final";
            finalCaptions.appendChild(finalDiv);
            finalDiv.scrollIntoView({ behavior: "smooth" });
        } else {
            console.log('Processing INTERIM transcription:', data.transcription);
            // For interim results, update or create the interim span
            let interimSpan = finalCaptions.querySelector('.interim-final');
            if (!interimSpan) {
                interimSpan = document.createElement("span");
                interimSpan.className = "interim-final";
                finalCaptions.appendChild(interimSpan);
            }
            interimSpan.textContent = data.transcription + " ";
            interimSpan.scrollIntoView({ behavior: "smooth" });
        }
    });

    // Add provider button handler
    const addProviderBtn = document.getElementById('addProviderBtn');
    if (addProviderBtn) {
        console.log('Found add provider button, adding click handler');
        addProviderBtn.addEventListener('click', () => {
            console.log('Add provider button clicked');
            addProvider();
        });
    } else {
        console.error('Could not find add provider button');
    }

    // Add main record button handler
    const mainRecordButton = document.getElementById('record');
    
    if (mainRecordButton) {
        console.log('Found main record button, adding change handler');
        mainRecordButton.addEventListener('change', async () => {
            console.log('Main record button changed:', mainRecordButton.checked);
            if (!socket?.connected) {
                console.error('Socket not connected');
                mainRecordButton.checked = false;
                return;
            }
            
            // Disable/enable the Add Provider button based on recording state
            if (addProviderBtn) {
                if (mainRecordButton.checked) {
                    addProviderBtn.disabled = true;
                    addProviderBtn.classList.add('disabled');
                } else {
                    addProviderBtn.disabled = false;
                    addProviderBtn.classList.remove('disabled');
                }
            }

            for (const provider of providers) {
                try {
                    if (mainRecordButton.checked) {
                        console.log('Starting recording for provider', provider.id);
                        await startRecording(provider);
                    } else {
                        console.log('Stopping recording for provider', provider.id);
                        await stopRecording(provider);
                    }
                } catch (error) {
                    console.error('Error with provider', provider.id, error);
                    mainRecordButton.checked = false;
                    // Re-enable the Add Provider button if there's an error
                    if (addProviderBtn) {
                        addProviderBtn.disabled = false;
                        addProviderBtn.classList.remove('disabled');
                    }
                }
            }
        });
    } else {
        console.error('Could not find main record button');
    }
});

class Provider {
  constructor(id) {
    this.id = id;
    this.isRecording = false;
    this.microphone = null;
    this.changedParams = new Set();
    this.isImported = false;
    this.column = null;
  }

  getElement(selector) {
    if (!this.column) {
      this.column = document.getElementById(`provider-${this.id}`);
    }
    return this.column?.querySelector(selector);
  }

  getAllElements(selector) {
    if (!this.column) {
      this.column = document.getElementById(`provider-${this.id}`);
    }
    return this.column?.querySelectorAll(selector) || [];
  }

  remove() {
    if (this.column) {
      this.column.remove();
      const index = providers.indexOf(this);
      if (index > -1) {
        providers.splice(index, 1);
      }
    }
  }
}


function setDefaultValues(provider) {
    // Get the current provider type
    const providerType = provider.getElement('.provider-select')?.value;
    if (!providerType) return;
    
    // Fetch provider-specific configuration
    fetch(`../static/config/providers/${providerType}.json`)
        .then(response => response.json())
        .then(config => {
            // Apply the provider-specific configuration to the form
            for (const [key, value] of Object.entries(config)) {
                if (typeof value === 'boolean') {
                    const checkbox = provider.getElement(`.${key}`);
                    if (checkbox) checkbox.checked = value;
                } else if (key !== 'extra') {
                    const input = provider.getElement(`.${key}`);
                    if (input) input.value = value;
                }
            }
            
            // Update extra params if present
            if (config.extra && Object.keys(config.extra).length > 0) {
                const extraParams = provider.getElement('.extraParams');
                if (extraParams) {
                    extraParams.value = JSON.stringify(config.extra, null, 2);
                }
            }
            
            // Update the URL display
            updateRequestUrl(getConfig(provider), provider);
        })
}

function resetConfig(provider) {
    // Clear changed parameters tracking and import state
    provider.changedParams.clear();
    provider.isImported = false;
    
    // Get the current provider type
    const providerType = provider.getElement('.provider-select').value;
    
    // Fetch provider-specific configuration
    fetch(`../static/config/providers/${providerType}.json`)
        .then(response => response.json())
        .then(config => {
            // Apply the provider-specific configuration to the form
            for (const [key, value] of Object.entries(config)) {
                if (typeof value === 'boolean') {
                    const checkbox = provider.getElement(`.${key}`);
                    if (checkbox) checkbox.checked = value;
                } else if (key !== 'extra') {
                    const input = provider.getElement(`.${key}`);
                    if (input) input.value = value;
                }
            }
            
            // Update extra params if present
            if (config.extra && Object.keys(config.extra).length > 0) {
                const extraParams = provider.getElement('.extraParams');
                if (extraParams) {
                    extraParams.value = JSON.stringify(config.extra, null, 2);
                }
            }
            
            // Update the URL display
            updateRequestUrl(getConfig(provider), provider);
        })
        .catch(error => {
            console.error(`Error loading ${providerType} configuration:`, error);
            // Fallback to default values
            setDefaultValues(provider);
            updateRequestUrl(getConfig(provider), provider);
        });
}


async function getMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return new MediaRecorder(stream, { mimeType: "audio/webm" });
  } catch (error) {
    console.error("Error accessing microphone:", error);
    throw error;
  }
}

async function openMicrophone(microphone, socket, provider) {
  return new Promise((resolve) => {
    microphone.onstart = () => {
      console.log(`Client: Microphone opened for provider ${provider.id}`);
      document.body.classList.add(`recording-${provider.id}`);
      resolve();
    };
    microphone.ondataavailable = async (event) => {
      console.log(`Client: Microphone data received for provider ${provider.id}, size: ${event.data.size} bytes`);
      if (event.data.size > 0) {
        // Get the provider type for logging
        const providerType = provider.getElement('.provider-select').value;
        console.log(`Sending audio data to ${providerType} provider ${provider.id}`);
        
        socket.emit("audio_stream", { data: event.data, providerId: provider.id });
      }
    };
    microphone.start(1000);
  });
}

async function startRecording(provider) {
  provider.isRecording = true;
  provider.microphone = await getMicrophone();
  console.log(`Client: Waiting to open microphone for provider ${provider.id}`);
  
  // Send configuration before starting microphone
  const config = getConfig(provider);
  // Force interim_results to true for live recording
  config.interim_results = true;
  
  // Update the UI to show interim_results is true
  provider.getElement('.interim_results').checked = true;
  
  // Update the URL display to show interim_results=true
  updateRequestUrl(config, provider);
  
  // Collapse the configuration panel
  const configContent = provider.getElement('.config-content');
  configContent.classList.add('collapsed');
  const chevron = provider.getElement('.config-header i');
  if (chevron) chevron.style.transform = 'rotate(-90deg)';
  
  // Get the provider type from the dropdown
  const providerType = provider.getElement('.provider-select').value;
  console.log(`Starting recording with provider type: ${providerType}`);
  
  // Create the data object to send
  const data = { 
    action: "start", 
    config: config, 
    providerId: provider.id,
    provider: providerType  // Include the provider type
  };
  
  console.log('Sending toggle_transcription event with data:', JSON.stringify(data));
  
  // Add event listeners to track if the server acknowledges the event
  const ackTimeout = setTimeout(() => {
    console.warn('No acknowledgment received from server for toggle_transcription event');
  }, 2000);
  
  socket.emit("toggle_transcription", data, (response) => {
    clearTimeout(ackTimeout);
    console.log('Server acknowledged toggle_transcription event:', response);
  });
  
  await openMicrophone(provider.microphone, socket, provider);
}

async function stopRecording(provider) {
  if (provider.isRecording === true) {
    provider.microphone.stop();
    provider.microphone.stream.getTracks().forEach((track) => track.stop()); // Stop all tracks
    
    // Get the provider type from the dropdown
    const providerType = provider.getElement('.provider-select').value;
    
    // Create the data object to send
    const data = { 
      action: "stop", 
      providerId: provider.id,
      provider: providerType  // Include the provider type
    };
    
    console.log('Sending stop event with data:', JSON.stringify(data));
    
    socket.emit("toggle_transcription", data);
    provider.microphone = null;
    provider.isRecording = false;
    console.log(`Client: Microphone closed for provider ${provider.id}`);
    document.body.classList.remove(`recording-${provider.id}`);
    
    // Reset interim_results to the checkbox state
    const config = getConfig(provider);
    updateRequestUrl(config, provider);
  }
}

function getConfig(provider) {
    const config = {};
    const providerType = provider.getElement('.provider-select')?.value;
    
    // Only collect inputs that are visible or common to all providers
    // Get text inputs
    const textInputs = provider.getAllElements('.text-inputs input[type="text"]');
    textInputs.forEach(input => {
        // Check if the input's parent label is visible or has no data-provider attribute (common field)
        const parentLabel = input.closest('label');
        const isCommonField = !parentLabel.hasAttribute('data-provider');
        const isProviderSpecific = parentLabel.getAttribute('data-provider') === providerType;
        
        if ((isCommonField || isProviderSpecific) && input.value) {
            config[input.className] = input.value;
        }
    });
    
    // Get boolean inputs
    const booleanInputs = provider.getAllElements('.boolean-inputs input[type="checkbox"]');
    booleanInputs.forEach(input => {
        // Check if the input's parent label is visible or has no data-provider attribute (common field)
        const parentLabel = input.closest('label');
        const isCommonField = !parentLabel.hasAttribute('data-provider');
        const isProviderSpecific = parentLabel.getAttribute('data-provider') === providerType;
        
        if (isCommonField || isProviderSpecific) {
            config[input.className] = input.checked;
        }
    });
    
    // Get extra parameters
    const extraParamsInput = provider.getElement('.extraParams');
    if (extraParamsInput && extraParamsInput.value) {
        try {
            const extraParams = JSON.parse(extraParamsInput.value);
            config.extra = extraParams;
        } catch (e) {
            console.error('Invalid JSON in extra parameters:', e);
            // Use empty object as fallback
            config.extra = {};
        }
    } else {
        config.extra = {};
    }
    
    // For Microsoft, map some fields differently
    if (providerType === 'microsoft') {
        // Use microsoft_language instead of language
        if (config.microsoft_language) {
            config.language = config.microsoft_language;
        }
    }
    
    console.log(`Generated config for ${providerType}:`, config);
    return config;
}

function toggleConfig(element) {
    const isCollapsed = !element.closest('.config-header').classList.contains('collapsed');
    
    // Update all config panels
    document.querySelectorAll('.config-header').forEach(header => {
        const content = header.nextElementSibling;
        if (isCollapsed) {
            header.classList.add('collapsed');
            content.classList.add('collapsed');
            const chevron = header.querySelector('i');
            if (chevron) chevron.style.transform = 'rotate(-90deg)';
        } else {
            header.classList.remove('collapsed');
            content.classList.remove('collapsed');
            const chevron = header.querySelector('i');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
    });
}

function updateRequestUrl(config, provider) {
    const urlElement = provider.getElement('.requestUrl');
    if (!urlElement) return;

    const providerType = provider.getElement('.provider-select').value;
    
    if (providerType === 'deepgram') {
        // Build Deepgram URL
        let baseUrl = config.base_url || 'api.deepgram.com';
        let url = `wss://${baseUrl}/v1/listen?`;
        
        // Add model if specified
        if (config.model) {
            url += `model=${encodeURIComponent(config.model)}&`;
        }
        
        // Add language if specified
        if (config.language) {
            url += `language=${encodeURIComponent(config.language)}&`;
        }
        
        // Add boolean parameters
        const boolParams = [
            'smart_format',
            'interim_results',
            'no_delay',
            'dictation',
            'numerals',
            'profanity_filter',
            'redact'
        ];
        
        boolParams.forEach(param => {
            if (config[param] === true) {
                url += `${param}=true&`;
            }
        });
        
        // Add numeric parameters
        if (config.utterance_end_ms) {
            url += `utterance_end_ms=${encodeURIComponent(config.utterance_end_ms)}&`;
        }
        
        if (config.endpointing) {
            url += `endpointing=${encodeURIComponent(config.endpointing)}&`;
        }
        
        // Add extra parameters
        if (config.extra && typeof config.extra === 'object') {
            Object.entries(config.extra).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    url += `${encodeURIComponent(key)}=${encodeURIComponent(value)}&`;
                }
            });
        }
        
        // Remove trailing ampersand or question mark
        if (url.endsWith('&')) {
            url = url.slice(0, -1);
        } else if (url.endsWith('?')) {
            url = url.slice(0, -1);
        }
        
        urlElement.textContent = url;
    } else if (providerType === 'microsoft') {
        // Build Microsoft URL representation (just for display)
        let url = `Microsoft Speech SDK - ${config.microsoft_language || 'en-US'}`;
        urlElement.textContent = url;
    }
}

function toggleExtraParams(element) {
    const header = element.closest('.extra-params-header');
    const content = header.nextElementSibling;
    content.classList.toggle('collapsed');
    const chevron = header.querySelector('i');
    if (chevron) {
        chevron.style.transform = content.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
}

function updateConfigPanelForProvider(provider, providerType) {
    // Get all config groups
    const textInputs = provider.getElement('.text-inputs');
    const booleanInputs = provider.getElement('.boolean-inputs');
    
    if (!textInputs || !booleanInputs) return;
    
    // Use the data-provider attributes to show/hide fields
    const allLabels = provider.getAllElements('label[data-provider]');
    
    // First hide all provider-specific fields
    allLabels.forEach(label => {
        // Always show common fields
        if (label.getAttribute('data-provider') === 'common') {
            label.style.display = 'block';
        } else {
            label.style.display = 'none';
        }
    });
    
    // Then show fields specific to the selected provider
    const providerLabels = provider.getAllElements(`label[data-provider="${providerType}"]`);
    providerLabels.forEach(label => {
        label.style.display = 'block';
    });
}

function addProvider() {
    console.log('Adding new provider...');
    const template = document.getElementById('providerTemplate');
    if (!template) {
        console.error('Provider template not found');
        return;
    }

    const container = document.querySelector('.providers-container');
    if (!container) {
        console.error('Providers container not found');
        return;
    }
    
    try {
        // Find the next available ID that isn't already in use
        let newId = 0;
        const usedIds = providers.map(p => p.id);
        while (usedIds.includes(newId)) {
            newId++;
        }

        const newProvider = new Provider(newId);
        providers.push(newProvider);
        
        console.log(`Created new provider with ID ${newId}`);
        
        // Clone template
        const clone = template.content.cloneNode(true);
        const providerColumn = clone.querySelector('.provider-column');
        if (!providerColumn) {
            throw new Error('Provider column not found in template');
        }
        
        providerColumn.id = `provider-${newId}`;
        
        // Add to DOM first so we can query within it
        container.appendChild(clone);
        newProvider.column = providerColumn;
        
        // Add remove button handler
        const removeBtn = newProvider.getElement('.remove-provider-button');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => newProvider.remove());
        }
        
        // Initialize the new provider
        initializeProvider(newId);
        console.log('Provider added successfully');
    } catch (error) {
        console.error('Error adding provider:', error);
    }
}

function removeProvider(id) {
    const provider = providers.find(p => p.id === id);
    if (!provider) return;
    
    // Stop recording if active
    if (provider.isRecording) {
        stopRecording(provider);
    }
    
    // Tell the server to stop this provider
    socket.emit("toggle_transcription", { action: "stop", providerId: id });
    
    // Remove from the UI
    provider.remove();
    
    // Remove from the providers array
    const index = providers.findIndex(p => p.id === id);
    if (index !== -1) {
        providers.splice(index, 1);
    }
}

function parseUrlParams(url) {
    try {
        // Handle ws:// and wss:// protocols by temporarily replacing them
        let modifiedUrl = url;
        if (url.startsWith('ws://') || url.startsWith('wss://')) {
            modifiedUrl = url.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
        }
        
        // If URL starts with a path, prepend the default base URL
        if (url.startsWith('/')) {
            modifiedUrl = 'http://api.deepgram.com' + url;
        }
        
        const urlObj = new URL(modifiedUrl);
        const params = {};

        // Extract the hostname as baseUrl, removing /v1/listen if present
        params.baseUrl = urlObj.hostname;
        
        // Handle duplicate parameters as arrays
        const paramMap = new Map();
        urlObj.searchParams.forEach((value, key) => {
            const cleanKey = key.trim();
            const cleanValue = value.trim();
            if (cleanKey && cleanValue) {
                if (paramMap.has(cleanKey)) {
                    const existingValue = paramMap.get(cleanKey);
                    paramMap.set(cleanKey, Array.isArray(existingValue) ? [...existingValue, cleanValue] : [existingValue, cleanValue]);
                } else {
                    paramMap.set(cleanKey, cleanValue);
                }
            }
        });
        
        // Convert Map to object
        paramMap.forEach((value, key) => {
            params[key] = value;
        });
        
        return params;
    } catch (e) {
        console.error('Invalid URL:', e);
        return null;
    }
}

    // Fetch provider-specific configurations
    const providerType = provider.getElement('.provider-select').value;
    const configUrl = `../config/providers/${providerType}.json`;
    
    fetch(configUrl)
        .then(response => response.json())
        .then(updateRequestUrl(getConfig()));

function initializeProvider(id) {
    const provider = providers.find(p => p.id === id);
    if (!provider) return;

    const recordButton = provider.getElement('.mic-checkbox');
    const resetButton = provider.getElement('.reset-button');
    const clearButton = provider.getElement('.clear-button');
    const providerSelect = provider.getElement('.provider-select');
    
    // Add event listener for provider type change
    if (providerSelect) {
        providerSelect.addEventListener('change', () => {
            const selectedProvider = providerSelect.value;
            console.log(`Provider type changed to: ${selectedProvider}`);
            updateConfigPanelForProvider(provider, selectedProvider);
            // Reset to provider-specific defaults
            resetConfig(provider);
        });
        
        // Initialize the config panel for the current provider type
        updateConfigPanelForProvider(provider, providerSelect.value);
    }

    // Initialize record button
    if (recordButton) {
        recordButton.addEventListener('change', async () => {
            if (recordButton.checked) {
                try {
                    await startRecording(provider);
                } catch (error) {
                    console.error('Failed to start recording:', error);
                    recordButton.checked = false;
                }
            } else {
                await stopRecording(provider);
            }
        });
    }

    // Initialize reset button
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            resetConfig(provider);
            provider.changedParams.clear();
            provider.isImported = false;
            updateRequestUrl(getConfig(), provider);
        });
    }

    // Initialize clear button
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            // Clear results from ALL providers
            providers.forEach(p => {
                const finalCaptions = p.getElement('.finalCaptions');
                if (finalCaptions) {
                    finalCaptions.innerHTML = '';
                }
            });
        });
    }

    // Initialize input change handlers
    ['input', 'change'].forEach(eventType => {
        const inputs = provider.getAllElements('input, textarea');
        inputs.forEach(input => {
            input.addEventListener(eventType, () => {
                provider.changedParams.add(input.className);
                updateRequestUrl(getConfig(provider), provider);
            });
        });
    });
    
    // Add special handler for provider select to update the configuration panel
    if (providerSelect) {
        providerSelect.addEventListener('change', () => {
            const selectedProviderType = providerSelect.value;
            console.log(`Provider ${id} type changed to ${selectedProviderType}`);
            
            // Reset configuration when provider type changes
            provider.changedParams.clear();
            provider.isImported = false;
            
            // Fetch and apply provider-specific configuration
            fetch(`../static/config/providers/${selectedProviderType}.json`)
                .then(response => response.json())
                .then(config => {
                    // Apply the provider-specific configuration
                    for (const [key, value] of Object.entries(config)) {
                        if (typeof value === 'boolean') {
                            const checkbox = provider.getElement(`.${key}`);
                            if (checkbox) checkbox.checked = value;
                        } else if (key !== 'extra') {
                            const input = provider.getElement(`.${key}`);
                            if (input) input.value = value;
                        }
                    }
                    
                    // Update the configuration panel UI
                    updateConfigPanelForProvider(provider, selectedProviderType);
                })
                .catch(error => {
                    console.error(`Error loading ${selectedProviderType} configuration:`, error);
                });
        });
        
        // Initialize the configuration panel based on the current provider type
        updateConfigPanelForProvider(provider, providerSelect.value);
    }

    // Initialize with provider config
    updateRequestUrl(getConfig(), provider);
}

    // Make URL editable
    const urlElement = provider.getElement('.requestUrl');
    if (urlElement) {
        urlElement.contentEditable = true;
        urlElement.style.cursor = 'text';
        
        // Add event listener for URL editing
        urlElement.addEventListener('input', function(e) {
            // Store cursor position
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);
            const cursorOffset = range.startOffset;
            
            const url = this.textContent.replace(/\s+/g, '').replace(/&amp;/g, '&');
            const config = parseUrlParams(url);
            if (config) {
                // Update form fields based on URL
                Object.entries(config).forEach(([key, value]) => {
                    const element = provider.getElement(`.${key}`);
                    if (element) {
                        if (element.type === 'checkbox') {
                            element.checked = value === 'true' || value === true;
                        } else {
                            element.value = value;
                        }
                        provider.changedParams.add(key);
                    }
                });
                
                // Update extra parameters
                const extraParams = {};
                Object.entries(config).forEach(([key, value]) => {
                    if (!provider.getElement(`.${key}`)) {
                        extraParams[key] = value;
                    }
                });
                provider.getElement('.extraParams').value = JSON.stringify(extraParams, null, 2);
                
                // Update URL display with proper wrapping and escaping
                updateRequestUrl(getConfig(provider), provider);
                
                // Restore cursor position
                try {
                    const newRange = document.createRange();
                    newRange.setStart(urlElement.firstChild || urlElement, Math.min(cursorOffset, (urlElement.firstChild || urlElement).length));
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                } catch (e) {
                    console.warn('Could not restore cursor position:', e);
                }
            }
        });
    }
    
    // Add event listeners to all config inputs with change tracking
    const configInputs = provider.getAllElements('.config-panel input');
    configInputs.forEach(input => {
        input.addEventListener('change', () => {
            provider.changedParams.add(input.id);
            updateRequestUrl(getConfig(provider), provider);
        });
        if (input.type === 'text') {
            input.addEventListener('input', () => {
                provider.changedParams.add(input.id);
                updateRequestUrl(getConfig(provider), provider);
            });
        }
    });
    
    // Add event listener for extra params
    const extraParams = provider.getElement('.extraParams');
    if (extraParams) {
        extraParams.addEventListener('blur', () => {
            try {
                const rawJson = extraParams.value || '{}';
                // Parse the raw JSON string to handle duplicate keys
                const processedExtra = {};
                try {
                    const parsed = JSON.parse(rawJson);
                    Object.entries(parsed).forEach(([key, value]) => {
                        processedExtra[key] = value;
                    });
                } catch (e) {
                    console.warn('Invalid JSON in extra params');
                    return;
                }
                
                // Update the textarea with properly formatted JSON
                extraParams.value = JSON.stringify(processedExtra, null, 2);
                
                // Only mark as changed if there are actual extra params
                if (Object.keys(processedExtra).length > 0) {
                    provider.changedParams.add('extraParams');
                } else {
                    provider.changedParams.delete('extraParams');
                }
                updateRequestUrl(getConfig(provider), provider);
            } catch (e) {
                console.warn('Invalid JSON in extra params');
            }
        });
    }

    // Add resize listener to update URL formatting when window size changes
    window.addEventListener('resize', () => {
        updateRequestUrl(getConfig(provider), provider);
    });

    // Initialize with default config
    updateRequestUrl(getConfig(provider), provider);
