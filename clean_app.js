<USER_REQUEST>
    /* =========================================
       MODULE 1: CORE UTILITIES & NAVIGATION
       ========================================= */

    // 1. DEBOUNCE LOGIC (Performance)
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const later = () => { clearTimeout(timeout); func(...args); };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Custom Toast statt alert()
    function showToast(msg, isError = false) {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        toast.style.background = isError ? '#ef4444' : 'var(--success)';
        toast.innerText = msg;
        setTimeout(() => toast.style.display = 'none', 4500);
    }
    
    // Robuster JSON Extractor (Ignoriert Markdown und Fließtext lokaler Modelle)
    function extractJSON(str) {
        try {
            // 1. Zuerst schauen wir, ob wir Markdown haben und entfernen es sicher auf EINER Zeile
            let cleanStr = str.replace(/```[a-zA-Z]*\n?/gi, '').replace(/```/gi, '').trim();
            
            // 2. Wir suchen gezielt die erste öffnende Klammer und letzte schließende Klammer
            const startIndex = cleanStr.indexOf('{');
            const endIndex = cleanStr.lastIndexOf('}');
            
            if (startIndex !== -1 && endIndex !== -1) {
                cleanStr = cleanStr.substring(startIndex, endIndex + 1);
                return JSON.parse(cleanStr);
            }
            
            // FALLBACK: Wenn kein JSON gefunden wurde, versuchen wir das Textformat zu parsen:
            // **Positive Prompt:** [content]
            // **Negative Prompt:** [content]
            const posMatch = str.match(/\*\*Positive Prompt:\*\*([\s\S]*?)(?=\*\*Negative Prompt:\*\*|$)/i);
            const negMatch = str.match(/\*\*Negative Prompt:\*\*([\s\S]*?)$/i);
            
            if (posMatch) {
                const positive = posMatch[1].trim();

<truncated 45215 bytes>
      document.getElementById('codeBlock').textContent = JSON.stringify(json, null, 2);
        Prism.highlightElement(document.getElementById('codeBlock'));
        showToast("Static JSON erfolgreich generiert!");
    }
    
    function saveUrl() { 
        localStorage.setItem('lm_studio_url', document.getElementById('apiUrl').value); 
        updateKeyStatus();
        // Set interval to check status periodically
        setInterval(updateKeyStatus, 15000); 
    }
    
    let statusTimeout;
    function debouncedCheckStatus() {
        clearTimeout(statusTimeout);
        statusTimeout = setTimeout(updateKeyStatus, 1000);
    }

    async function updateKeyStatus() {
        const baseUrlInput = document.getElementById('apiUrl').value.trim();
        const baseUrl = baseUrlInput || HARDCODED_URL;
        const statusText = document.getElementById('api-status-text');
        const statusDot = document.getElementById('api-status-dot');
        
        statusText.innerText = "Verbinde...";
        statusDot.style.color = "var(--warning)";
        statusDot.classList.add("pulse-animation");
        
        try {
            const cleanUrl = baseUrl.replace(/\/$/, "");
            const response = await fetch(`${cleanUrl}/models`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                let modelName = "LM Studio";
                if (data.data && data.data[0]) {
                    modelName = data.data[0].id;
                }
                if (modelName.length > 25) {
                    modelName = modelName.substring(0, 22) + "...";
                }
                statusText.innerText = `Verbunden (${modelName})`;
                statusDot.style.color = "var(--success)";
            } else {
  
<truncated 85125 bytes>

NOTE: The output was truncated because it was too long. Use a more targeted query or a smaller range to get the information you need.