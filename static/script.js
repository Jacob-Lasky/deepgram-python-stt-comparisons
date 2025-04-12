let providers = [];
let socket;
const socket_port = 8001;

// Default configuration
const DEFAULT_CONFIG = {
    "base_url": "api.deepgram.com",
    "model": "nova-3",
    "language": "en",
    "utterance_end_ms": "1000",
    "endpointing": "10",
    "smart_format": false,
    "interim_results": true,
    "no_delay": false,
    "dictation": false,
    "numerals": false,
    "profanity_filter": false,
    "redact": false,
    "extra": {}
};

// Initialize everything when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
    console.log('Initializing application...');

    // Initialize socket first
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

    // Initialize default configuration
    try {
        const response = await fetch('../config/defaults.json');
        if (response.ok) {
            const config = await response.json();
            Object.assign(DEFAULT_CONFIG, config);
        }
    } catch (error) {
        console.warn('Could not load default configuration, using built-in defaults:', error);
    }
    console.log('Using configuration:', DEFAULT_CONFIG);

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
    if (!DEFAULT_CONFIG) return;
    
    // Set text input defaults
    ['baseUrl', 'model', 'language', 'utterance_end_ms', 'endpointing'].forEach(className => {
        const element = provider.getElement(`.${className}`);
        if (element && DEFAULT_CONFIG[className]) {
            element.value = DEFAULT_CONFIG[className];
        }
    });

    // Set checkbox defaults
    ['smart_format', 'interim_results', 'no_delay', 'dictation', 
     'numerals', 'profanity_filter', 'redact'].forEach(className => {
        const element = provider.getElement(`.${className}`);
        if (element && DEFAULT_CONFIG[className] !== undefined) {
            element.checked = DEFAULT_CONFIG[className];
        }
    });

    // Set extra params default
    const extraParams = provider.getElement('.extraParams');
    if (extraParams) {
        extraParams.value = JSON.stringify(DEFAULT_CONFIG.extra || {}, null, 2);
    }
}

function resetConfig(provider) {
    if (!DEFAULT_CONFIG) return;
    // Clear changed parameters tracking and import state
    provider.changedParams.clear();
    provider.isImported = false;
    setDefaultValues(provider);
    updateRequestUrl(getConfig(provider), provider);
}

function importConfig(input, provider) {
    if (!DEFAULT_CONFIG) return;
    
    // Reset all options to defaults first
    setDefaultValues(provider);
    
    let config;
    
    try {
        config = JSON.parse(input);
    } catch (e) {
        config = parseUrlParams(input);
    }
    
    if (!config) {
        throw new Error('Invalid configuration format. Please provide a valid JSON object or URL.');
    }

    // Set import state
    provider.isImported = true;

    // Clear all form fields first
    ['baseUrl', 'model', 'language', 'utterance_end_ms', 'endpointing'].forEach(className => {
        const element = provider.getElement(`.${className}`);
        if (element) {
            element.value = '';
        }
    });

    ['smart_format', 'interim_results', 'no_delay', 'dictation', 
     'numerals', 'profanity_filter', 'redact'].forEach(className => {
        const element = provider.getElement(`.${className}`);
        if (element) {
            element.checked = false;
        }
    });

    // Only set values that are explicitly in the config
    Object.entries(config).forEach(([key, value]) => {
        const element = provider.getElement(`.${key}`);
        if (element) {
            if (element.type === 'checkbox') {
                element.checked = value === 'true' || value === true;
            } else {
                element.value = value;
            }
            provider.changedParams.add(key);
        } else {
            // If the key doesn't correspond to a form element, it's an extra param
            const extraParams = provider.getElement('.extraParams');
            if (extraParams) {
                const currentExtra = JSON.parse(extraParams.value || '{}');
                currentExtra[key] = value;
                extraParams.value = JSON.stringify(currentExtra, null, 2);
                provider.changedParams.add('extraParams');
            }
        }
    });

    // Set baseUrl if not in config
    if (!config.baseUrl) {
        const baseUrlElement = provider.getElement('.baseUrl');
        if (baseUrlElement) {
            baseUrlElement.value = 'api.deepgram.com';
        }
    }

    // Update the URL display
    updateRequestUrl(getConfig(provider), provider);
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
      console.log(`Client: Microphone data received for provider ${provider.id}`);
      if (event.data.size > 0) {
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
  
  socket.emit("toggle_transcription", { action: "start", config: config, providerId: provider.id });
  
  await openMicrophone(provider.microphone, socket, provider);
}

async function stopRecording(provider) {
  if (provider.isRecording === true) {
    provider.microphone.stop();
    provider.microphone.stream.getTracks().forEach((track) => track.stop()); // Stop all tracks
    socket.emit("toggle_transcription", { action: "stop", providerId: provider.id });
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
    
    const addIfSet = (className) => {
        const element = provider.getElement(`.${className}`);
        if (!element) return;
        const value = element.type === 'checkbox' ? element.checked : element.value;
        if (value !== '' && value !== false) {
            config[className] = value;
        }
    };

    addIfSet('baseUrl');
    addIfSet('language');
    addIfSet('model');
    addIfSet('utterance_end_ms');
    addIfSet('endpointing');
    addIfSet('smart_format');
    addIfSet('interim_results');
    addIfSet('no_delay');
    addIfSet('dictation');
    addIfSet('numerals');
    addIfSet('profanity_filter');
    addIfSet('redact');

    // Add extra parameters
    const extraParams = provider.getElement('.extraParams');
    if (extraParams?.value) {
        try {
            const extra = JSON.parse(extraParams.value);
            Object.entries(extra).forEach(([key, value]) => {
                if (value !== undefined && value !== '') {
                    config[key] = value;
                }
            });
        } catch (e) {
            console.error('Error parsing extra parameters:', e);
        }
    }

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
    const baseUrl = provider.getElement('.baseUrl')?.value;
    if (!baseUrl) return;
    
    const params = new URLSearchParams();
    
    // Only add parameters that are explicitly set
    const language = provider.getElement('.language')?.value;
    if (language) params.append('language', language);
    
    const model = provider.getElement('.model')?.value;
    if (model) params.append('model', model);
    
    const utteranceEndMs = provider.getElement('.utterance_end_ms')?.value;
    if (utteranceEndMs) params.append('utterance_end_ms', utteranceEndMs);
    
    const endpointing = provider.getElement('.endpointing')?.value;
    if (endpointing) params.append('endpointing', endpointing);
    
    const smartFormat = provider.getElement('.smart_format')?.checked;
    if (smartFormat) params.append('smart_format', 'true');
    
    const interimResults = provider.getElement('.interim_results')?.checked;
    if (interimResults) params.append('interim_results', 'true');
    
    const noDelay = provider.getElement('.no_delay')?.checked;
    if (noDelay) params.append('no_delay', 'true');
    
    const dictation = provider.getElement('.dictation')?.checked;
    if (dictation) params.append('dictation', 'true');
    
    const numerals = provider.getElement('.numerals')?.checked;
    if (numerals) params.append('numerals', 'true');
    
    const profanityFilter = provider.getElement('.profanity_filter')?.checked;
    if (profanityFilter) params.append('profanity_filter', 'true');
    
    const redact = provider.getElement('.redact')?.checked;
    if (redact) params.append('redact', 'true');
    
    // Add extra parameters if any
    const extraParams = provider.getElement('.extraParams');
    if (extraParams?.value) {
        try {
            const extra = JSON.parse(extraParams.value);
            Object.entries(extra).forEach(([key, value]) => {
                if (value !== undefined && value !== '') {
                    if (Array.isArray(value)) {
                        value.forEach(v => params.append(key, v));
                    } else {
                        params.append(key, value);
                    }
                }
            });
        } catch (e) {
            console.error('Invalid extra parameters JSON:', e);
        }
    }
    
    // Calculate maxLineLength for new parameters
    const containerWidth = urlElement.parentElement.getBoundingClientRect().width;
    const avgCharWidth = 8.5;
    const safetyMargin = 40;
    const maxLineLength = Math.floor((containerWidth - safetyMargin) / avgCharWidth);
    
    // Format URL with line breaks
    const baseUrlDisplay = `ws://${baseUrl}/v1/listen?`;
    const pairs = params.toString().split('&');
    let currentLine = baseUrlDisplay;
    const outputLines = [];
    
    pairs.forEach((pair, index) => {
        const shouldBreakLine = currentLine !== baseUrlDisplay && 
            (currentLine.length + pair.length + 1 > maxLineLength);
        
        if (shouldBreakLine) {
            outputLines.push(currentLine + '&amp;');
            currentLine = pair;
        } else {
            currentLine += (currentLine === baseUrlDisplay ? '' : '&amp;') + pair;
        }
        
        if (index === pairs.length - 1) {
            outputLines.push(currentLine);
        }
    });
    
    urlElement.innerHTML = outputLines.join('\n');
    return outputLines.join('').replace(/&amp;/g, '&');
}

function toggleExtraParams(element) {
    const header = element.closest('.extra-params-header');
    const content = header.nextElementSibling;
    header.classList.toggle('collapsed');
    content.classList.toggle('collapsed');
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

    // Fetch default configuration
    fetch('../config/defaults.json')
        .then(response => response.json())
        .then(config => {
            DEFAULT_CONFIG = config;
            // Initialize URL with current config
            updateRequestUrl(getConfig());
        })
        .catch(error => {
            console.error('Error loading default configuration:', error);
            // Initialize URL with current config
            updateRequestUrl(getConfig());
        });

function initializeProvider(id) {
    const provider = providers.find(p => p.id === id);
    if (!provider) return;

    const recordButton = provider.getElement('.mic-checkbox');
    const resetButton = provider.getElement('.reset-button');
    const clearButton = provider.getElement('.clear-button');
    const urlElement = provider.getElement('.requestUrl');
    const importButton = provider.getElement('.import-button');
    const importInput = provider.getElement('.importInput');

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
            if (!DEFAULT_CONFIG) return;
            provider.changedParams.clear();
            provider.isImported = false;
            Object.entries(DEFAULT_CONFIG).forEach(([key, value]) => {
                const element = provider.getElement(`.${key}`);
                if (element) {
                    if (element.type === 'checkbox') {
                        element.checked = value === 'true' || value === true;
                    } else {
                        element.value = value;
                    }
                }
            });
            updateRequestUrl(DEFAULT_CONFIG, provider);
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

    // Initialize import functionality
    if (importButton && importInput) {
        importButton.addEventListener('click', () => {
            const input = importInput.value.trim();
            if (!input) {
                alert('Please enter a configuration to import.');
                return;
            }
            
            try {
                importConfig(input, provider);
                importInput.value = '';
            } catch (e) {
                alert('Invalid configuration format. Please provide a valid JSON object or URL.');
            }
        });

        importInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                importButton.click();
            }
        });
    }

    // Initialize URL editing
    if (urlElement) {
        urlElement.addEventListener('input', function(e) {
            const selection = window.getSelection();
            const range = selection.getRangeAt(0);
            const cursorOffset = range.startOffset;
            
            const url = this.textContent.replace(/\s+/g, '').replace(/&amp;/g, '&');
            const config = parseUrlParams(url);
            if (config) {
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
                
                updateRequestUrl(getConfig(provider), provider);
                
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

    // Initialize input change handlers
    ['input', 'change'].forEach(eventType => {
        const inputs = provider.getAllElements('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener(eventType, () => {
                provider.changedParams.add(input.className);
                updateRequestUrl(getConfig(provider), provider);
            });
        });
    });

    // Initialize with default config
    Object.entries(DEFAULT_CONFIG).forEach(([key, value]) => {
        const element = provider.getElement(`.${key}`);
        if (element) {
            if (element.type === 'checkbox') {
                element.checked = value === 'true' || value === true;
            } else {
                element.value = value;
            }
        }
    });
    updateRequestUrl(DEFAULT_CONFIG, provider);
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
