let isRecording = false;
let socket;
let microphone;
let audioContext;
let processor;
// Track which parameters have been changed during this session
let changedParams = new Set();
// Track if we're in a post-import state
let isImported = false;

let DEFAULT_CONFIG = {
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

const socket_port = 8001;
socket = io(
  "http://" + window.location.hostname + ":" + socket_port.toString()
);

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

function setDefaultValues() {
    if (!DEFAULT_CONFIG) return;
    
    // Set text input defaults
    ['baseUrl', 'model', 'language', 'utterance_end_ms', 'endpointing'].forEach(id => {
        const element = document.getElementById(id);
        if (element && DEFAULT_CONFIG[id]) {
            element.value = DEFAULT_CONFIG[id];
        }
    });

    // Set checkbox defaults
    ['smart_format', 'interim_results', 'no_delay', 'dictation', 
     'numerals', 'profanity_filter', 'redact'].forEach(id => {
        const element = document.getElementById(id);
        if (element && DEFAULT_CONFIG[id] !== undefined) {
            element.checked = DEFAULT_CONFIG[id];
        }
    });

    // Set extra params default
    document.getElementById('extraParams').value = JSON.stringify(DEFAULT_CONFIG.extra || {}, null, 2);
}

function resetConfig() {
    if (!DEFAULT_CONFIG) return;
    // Clear changed parameters tracking and import state
    changedParams.clear();
    isImported = false;
    setDefaultValues();
    updateRequestUrl(getConfig());
}

function importConfig(input) {
    if (!DEFAULT_CONFIG) return;
    
    // Reset all options to defaults first
    setDefaultValues();
    
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
    isImported = true;

    // Clear all form fields first
    ['baseUrl', 'model', 'language', 'utterance_end_ms', 'endpointing'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.value = '';
        }
    });

    ['smart_format', 'interim_results', 'no_delay', 'dictation', 
     'numerals', 'profanity_filter', 'redact'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.checked = false;
        }
    });

    // Only set values that are explicitly in the config
    Object.entries(config).forEach(([key, value]) => {
        const element = document.getElementById(key);
        if (element) {
            if (element.type === 'checkbox') {
                element.checked = value === 'true' || value === true;
            } else {
                element.value = value;
            }
            changedParams.add(key);
        } else {
            // If the key doesn't correspond to a form element, it's an extra param
            const extraParams = document.getElementById('extraParams');
            const currentExtra = JSON.parse(extraParams.value || '{}');
            currentExtra[key] = value;
            extraParams.value = JSON.stringify(currentExtra, null, 2);
            changedParams.add('extraParams');
        }
    });

    // Set baseUrl if not in config
    if (!config.baseUrl) {
        document.getElementById('baseUrl').value = 'api.deepgram.com';
    }

    // Update the URL display
    updateRequestUrl();
}

socket.on("transcription_update", (data) => {
  const finalCaptions = document.getElementById("finalCaptions");
  
  // Update final container
  if (data.is_final) {
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
  } else if (!data.utterance_end) {
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

async function getMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return new MediaRecorder(stream, { mimeType: "audio/webm" });
  } catch (error) {
    console.error("Error accessing microphone:", error);
    throw error;
  }
}

async function openMicrophone(microphone, socket) {
  return new Promise((resolve) => {
    microphone.onstart = () => {
      console.log("Client: Microphone opened");
      document.body.classList.add("recording");
      resolve();
    };
    microphone.ondataavailable = async (event) => {
      console.log("client: microphone data received");
      if (event.data.size > 0) {
        socket.emit("audio_stream", event.data);
      }
    };
    microphone.start(1000);
  });
}

async function startRecording() {
  isRecording = true;
  microphone = await getMicrophone();
  console.log("Client: Waiting to open microphone");
  
  // Send configuration before starting microphone
  const config = getConfig();
  // Force interim_results to true for live recording
  config.interim_results = true;
  
  // Update the UI to show interim_results is true
  document.getElementById('interim_results').checked = true;
  
  // Update the URL display to show interim_results=true
  updateRequestUrl(config);
  
  socket.emit("toggle_transcription", { action: "start", config: config });
  
  // Display the URL in the final results container
  const finalCaptions = document.getElementById("finalCaptions");
  const urlDiv = document.createElement("div");
  urlDiv.className = "url-info";
  const url = document.getElementById('requestUrl').textContent
    .replace(/\s+/g, '') // Remove all whitespace including newlines
    .replace(/&amp;/g, '&'); // Fix any HTML-encoded ampersands
  urlDiv.textContent = `Using URL: ${url}`;
  finalCaptions.appendChild(urlDiv);
  urlDiv.scrollIntoView({ behavior: "smooth" });
  
  await openMicrophone(microphone, socket);
}

async function stopRecording() {
  if (isRecording === true) {
    microphone.stop();
    microphone.stream.getTracks().forEach((track) => track.stop()); // Stop all tracks
    socket.emit("toggle_transcription", { action: "stop" });
    microphone = null;
    isRecording = false;
    console.log("Client: Microphone closed");
    document.body.classList.remove("recording");
    
    // Reset interim_results to the checkbox state
    const config = getConfig();
    updateRequestUrl(config);
  }
}

function getConfig() {
    const config = {};
    
    const addIfSet = (id) => {
        const element = document.getElementById(id);
        const value = element.type === 'checkbox' ? element.checked : element.value;
        if (value !== '' && value !== false) {
            config[id] = value;
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
    const extraParams = document.getElementById('extraParams');
    if (extraParams && extraParams.value) {
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

function toggleConfig() {
    const header = document.querySelector('.config-header');
    const content = document.getElementById('configContent');
    header.classList.toggle('collapsed');
    content.classList.toggle('collapsed');
}

function updateRequestUrl() {
    const urlElement = document.getElementById('requestUrl');

    const baseUrl = document.getElementById('baseUrl').value;
    const params = new URLSearchParams();
    
    // Only add parameters that are explicitly set
    const language = document.getElementById('language').value;
    if (language) params.append('language', language);
    
    const model = document.getElementById('model').value;
    if (model) params.append('model', model);
    
    const utteranceEndMs = document.getElementById('utterance_end_ms').value;
    if (utteranceEndMs) params.append('utterance_end_ms', utteranceEndMs);
    
    const endpointing = document.getElementById('endpointing').value;
    if (endpointing) params.append('endpointing', endpointing);
    
    const smartFormat = document.getElementById('smart_format').checked;
    if (smartFormat) params.append('smart_format', 'true');
    
    const interimResults = document.getElementById('interim_results').checked;
    if (interimResults) params.append('interim_results', 'true');
    
    const noDelay = document.getElementById('no_delay').checked;
    if (noDelay) params.append('no_delay', 'true');
    
    const dictation = document.getElementById('dictation').checked;
    if (dictation) params.append('dictation', 'true');
    
    const numerals = document.getElementById('numerals').checked;
    if (numerals) params.append('numerals', 'true');
    
    const profanityFilter = document.getElementById('profanity_filter').checked;
    if (profanityFilter) params.append('profanity_filter', 'true');
    
    const redact = document.getElementById('redact').checked;
    if (redact) params.append('redact', 'true');
    
    // Add extra parameters if any
    const extraParams = document.getElementById('extraParams');
    if (extraParams && extraParams.value) {
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
    const baseUrlDisplay = isRecording ? `ws://${baseUrl}/v1/listen?` : `http://${baseUrl}/v1/listen?`;
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

function toggleExtraParams() {
    const header = document.querySelector('.extra-params-header');
    const content = document.getElementById('extraParamsContent');
    header.classList.toggle('collapsed');
    content.classList.toggle('collapsed');
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

function simplifyUrl() {
    // Clear import state and changed params
    isImported = false;
    changedParams.clear();
    // Update URL to show only non-default params
    updateRequestUrl(getConfig());
}

document.addEventListener("DOMContentLoaded", () => {
    const recordButton = document.getElementById("record");
    const configPanel = document.querySelector('.config-panel');
    const copyButton = document.getElementById('copyUrl');
    const resetButton = document.getElementById('resetButton');
    const simplifyButton = document.getElementById('simplifyButton');
    const clearButton = document.getElementById('clearButton');
    
    // Make URL editable
    const urlElement = document.getElementById('requestUrl');
    urlElement.contentEditable = true;
    urlElement.style.cursor = 'text';
    
    // Clear button functionality
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            document.getElementById('captions').innerHTML = '';
            document.getElementById('finalCaptions').innerHTML = '';
        });
    }
    
    // Reset button functionality
    if (resetButton) {
        resetButton.addEventListener('click', resetConfig);
    }
    
    // Simplify button functionality
    if (simplifyButton) {
        simplifyButton.addEventListener('click', simplifyUrl);
    }
    
    // Copy URL functionality
    copyButton.addEventListener('click', () => {
        const url = document.getElementById('requestUrl').textContent
            .replace(/\s+/g, '') // Remove all whitespace including newlines
            .replace(/&amp;/g, '&'); // Fix any HTML-encoded ampersands
        navigator.clipboard.writeText(url).then(() => {
            copyButton.classList.add('copied');
            setTimeout(() => copyButton.classList.remove('copied'), 1000);
        });
    });

    // Add event listeners to all config inputs with change tracking
    const configInputs = document.querySelectorAll('#configForm input');
    configInputs.forEach(input => {
        input.addEventListener('change', () => {
            changedParams.add(input.id);
            updateRequestUrl(getConfig());
        });
        if (input.type === 'text') {
            input.addEventListener('input', () => {
                changedParams.add(input.id);
                updateRequestUrl(getConfig());
            });
        }
    });
    
    // Add event listener for extra params
    document.getElementById('extraParams').addEventListener('blur', () => {
        try {
            const extraParams = document.getElementById('extraParams');
            const rawJson = extraParams.value || '{}';
            // Parse the raw JSON string to handle duplicate keys
            const processedExtra = {};
            const lines = rawJson.split('\n');
            lines.forEach(line => {
                const match = line.match(/"([^"]+)":\s*"([^"]+)"/);
                if (match) {
                    const [, key, value] = match;
                    if (processedExtra[key]) {
                        if (Array.isArray(processedExtra[key])) {
                            processedExtra[key].push(value);
                        } else {
                            processedExtra[key] = [processedExtra[key], value];
                        }
                    } else {
                        processedExtra[key] = value;
                    }
                }
            });
            // Update the textarea with the processed JSON
            extraParams.value = JSON.stringify(processedExtra, null, 2);
            // Mark extra params as changed if they're not empty
            if (Object.keys(processedExtra).length > 0) {
                changedParams.add('extraParams');
            } else {
                changedParams.delete('extraParams');
            }
            updateRequestUrl();
        } catch (e) {
            console.warn('Invalid JSON in extra params');
        }
    });

    // Add resize listener to update URL formatting when window size changes
    window.addEventListener('resize', () => {
        updateRequestUrl(getConfig());
    });

    // Initialize URL with current config instead of defaults
    updateRequestUrl(getConfig());

    recordButton.addEventListener("change", async () => {
        if (recordButton.checked) {
            try {
                await startRecording();
            } catch (error) {
                console.error("Failed to start recording:", error);
                recordButton.checked = false;
            }
        } else {
            await stopRecording();
        }
    });

    // Initialize extra params as collapsed
    const extraParamsHeader = document.querySelector('.extra-params-header');
    extraParamsHeader.classList.add('collapsed');

    // Add import button handler
    document.getElementById('importButton').addEventListener('click', () => {
        const importInput = document.getElementById('importInput');
        const input = importInput.value.trim();
        if (!input) {
            alert('Please enter a configuration to import.');
            return;
        }
        
        try {
            importConfig(input);
            // Only clear input if import was successful
            importInput.value = '';
        } catch (e) {
            alert('Invalid configuration format. Please provide a valid JSON object or URL.');
        }
    });

    // Add keyboard shortcut (Enter key) for import input
    document.getElementById('importInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('importButton').click();
        }
    });

    // Add event listener for URL editing
    document.getElementById('requestUrl').addEventListener('input', function(e) {
        // Store cursor position
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);
        const cursorOffset = range.startOffset;
        
        const url = this.textContent.replace(/\s+/g, '').replace(/&amp;/g, '&');
        const config = parseUrlParams(url);
        if (config) {
            // Update form fields based on URL
            Object.entries(config).forEach(([key, value]) => {
                const element = document.getElementById(key);
                if (element) {
                    if (element.type === 'checkbox') {
                        element.checked = value === 'true' || value === true;
                    } else {
                        element.value = value;
                    }
                    changedParams.add(key);
                }
            });
            
            // Update extra parameters
            const extraParams = {};
            Object.entries(config).forEach(([key, value]) => {
                if (!document.getElementById(key)) {
                    extraParams[key] = value;
                }
            });
            document.getElementById('extraParams').value = JSON.stringify(extraParams, null, 2);
            
            // Update URL display with proper wrapping and escaping
            updateRequestUrl();
            
            // Restore cursor position
            try {
                const urlElement = document.getElementById('requestUrl');
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

    // Add event listener for interim_results checkbox
    const interimResultsCheckbox = document.getElementById('interim_results');
    if (interimResultsCheckbox) {
        interimResultsCheckbox.addEventListener('change', function() {
            // Only update URL if not recording
            if (!isRecording) {
                updateRequestUrl(getConfig());
            }
        });
    }
});
