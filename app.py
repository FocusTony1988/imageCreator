import os
import json
import time
import re
import markdown
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv

# Lade Umgebungsvariablen (.env Datei) für lokale Entwicklung
load_dotenv()

app = Flask(__name__, static_url_path='', static_folder='.')
CORS(app)

# --- CONFIGURATION ---
# Google Gemini API key configuration (wird nun extern über .env oder Hosting-Umgebungsvariablen eingelesen)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("WARNUNG: GEMINI_API_KEY wurde nicht als Umgebungsvariable gefunden.")

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/"

# Configurable pacing delay between sequential API requests (in seconds) to prevent 429 limits
PACING_DELAY = int(os.environ.get("PACING_DELAY", "3"))

# Initialize separate clients for Gemini and local LM Studio
gemini_client = OpenAI(api_key=GEMINI_API_KEY, base_url=GEMINI_BASE)

def get_lm_studio_model(lm_studio_base):
    """Helper to dynamically fetch the model currently loaded in LM Studio."""
    import urllib.request
    import json
    try:
        url = lm_studio_base.rstrip("/") + "/models"
        with urllib.request.urlopen(url, timeout=2) as response:
            data = json.loads(response.read().decode())
            return data['data'][0]['id']
    except Exception as e:
        print(f"Error fetching local LM Studio model, falling back: {e}")
        return "local-model"

def map_model_name(model_name):
    """Maps custom UI model names to actual Gemini API model IDs."""
    model_lower = model_name.lower()
    if '3.5-flash' in model_lower:
        return 'gemini-3.5-flash'
    elif '2.5-flash' in model_lower:
        return 'gemini-2.5-flash'
    elif '3.1-flash-lite' in model_lower:
        return 'gemini-3.1-flash-lite'
    elif 'lm-studio' in model_lower:
        return 'lm-studio'
    return model_name

def get_ai_response_stream(messages, model, temperature=0.7, lm_studio_base="http://127.0.0.1:1234/v1"):
    """Core generator that calls either Gemini or LM Studio and handles rate limits."""
    import time
    import re
    
    # Map model name to actual Gemini ID
    model = map_model_name(model)
    
    # Determine the API client and target model
    if model == 'lm-studio':
        client = OpenAI(api_key="lm-studio", base_url=lm_studio_base)
        target_model = get_lm_studio_model(lm_studio_base)
        is_gemini = False
    else:
        client = gemini_client
        target_model = model
        is_gemini = True
        
    max_retries = 6
    base_delay = 5
    
    for attempt in range(max_retries):
        try:
            res = client.chat.completions.create(
                model=target_model,
                messages=messages,
                temperature=temperature
            )
            yield ('result', res.choices[0].message.content)
            return
        except Exception as e:
            err_msg = str(e)
            # Only apply rate-limit retries for Gemini API (LM Studio has no quota limits)
            if is_gemini and ("429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "quota" in err_msg.lower()):
                delay = None
                
                # Pattern 1: Standard Gemini/OpenAI message: "Please retry in 40.9s"
                match1 = re.search(r"retry(?:ing)?\s+(?:in|after)\s+(\d+\.?\d*)\s*s", err_msg, re.IGNORECASE)
                if match1:
                    delay = int(float(match1.group(1))) + 1
                    
                # Pattern 2: Google RPC details: "retryDelay': '40s'"
                if not delay:
                    match2 = re.search(r"retryDelay[\'\"]?:\s*[\'\"]?(\d+)\s*s", err_msg, re.IGNORECASE)
                    if match2:
                        delay = int(match2.group(1)) + 1
                        
                # Pattern 3: Generic "retry after X seconds"
                if not delay:
                    match3 = re.search(r"retry.*\s+(\d+\.?\d*)\s*(?:seconds|sec|s)", err_msg, re.IGNORECASE)
                    if match3:
                        delay = int(float(match3.group(1))) + 1
                
                # Fallback to exponential backoff if no regex matched
                if not delay:
                    delay = base_delay * (2 ** attempt)
                    
                yield ('log', f"⚠️ Gemini API Rate-Limit (429). Warte {delay}s... (Versuch {attempt + 1}/{max_retries})")
                time.sleep(delay)
            else:
                yield ('error', f"API-Fehler ({model} -> {target_model}): {e}")
                return
    yield ('error', "Maximale Anzahl an API-Versuchen überschritten.")

def get_ai_response(messages, model, temperature=0.7, lm_studio_base="http://127.0.0.1:1234/v1"):
    """Blocking helper function to make API calls with automatic retry."""
    result = None
    for event_type, val in get_ai_response_stream(messages, model, temperature, lm_studio_base):
        if event_type == 'result':
            result = val
        elif event_type == 'error':
            print(f"[API ERROR] {val}")
    return result

# --- FRONTEND ROUTES ---

@app.route('/')
def index():
    """Serves the HTML user interface."""
    return send_file('index.html')

@app.route('/api/optimize', methods=['POST'])
def optimize_goal():
    data = request.json
    raw_goal = data.get('goal', '')
    model = data.get('model', 'gemini-3.5-flash')
    sys_prompt = data.get('system_prompt', '')
    lm_url = data.get('lm_url', 'http://127.0.0.1:1234/v1')
    
    print(f"[Optimize] Optimizing raw goal with {model}...")
    
    messages = []
    if sys_prompt:
        messages.append({"role": "system", "content": sys_prompt})
    messages.append({"role": "user", "content": raw_goal})
    
    optimized = get_ai_response(messages, model=model, temperature=0.5, lm_studio_base=lm_url)
    return jsonify({"optimized_goal": optimized if optimized else ""})

@app.route('/api/generate', methods=['POST'])
def generate_solution():
    data = request.json
    goal = data.get('goal', '')
    model = data.get('model', 'gemini-3.5-flash')
    sys_prompt = data.get('system_prompt', '')
    lm_url = data.get('lm_url', 'http://127.0.0.1:1234/v1')
    
    print(f"[Auto Bot] Starting Agentic Workflow with {model}...")
    
    def event_stream():
        context = f"Nutzer-Prompt:\n{goal}\n\nStrukturvorgaben & Regeln:\n{sys_prompt}"
        
        # Helper to execute AI calls and stream logs if retries occur
        def call_ai(messages, temperature=0.7):
            for event_type, val in get_ai_response_stream(messages, model, temperature, lm_url):
                if event_type == 'log':
                    yield ('log', f"data: {json.dumps({'event': 'log', 'message': val})}\n\n")
                elif event_type == 'result':
                    yield ('result', val)
                elif event_type == 'error':
                    yield ('log', f"data: {json.dumps({'event': 'log', 'message': f'🔴 {val}'})}\n\n")

        # 1. Expert Assembly
        yield f"data: {json.dumps({'event': 'log', 'message': '🧠 Rufe Expertengremium zusammen...'})}\n\n"
        prompt_exp = (
            f"Kontext: Das ist ein Prompt für eine Bild-KI.\n"
            "Nenne exakt 4 Berufsbezeichnungen (Komma-getrennt), die diesen Prompt perfekt aus verschiedenen Blickwinkeln (z.B. Beleuchtung, Komposition, Kamera, Regie) analysieren und verbessern können. "
            "Antworte AUSSCHLIESSLICH mit den Bezeichnungen auf Englisch (z.B. Lead Director, Lighting Specialist), keine Einleitung, keine Sätze."
        )
        
        exp_response = None
        for ev_type, ev_val in call_ai([{"role": "user", "content": prompt_exp}], temperature=0.3):
            if ev_type == 'log':
                yield ev_val
            elif ev_type == 'result':
                exp_response = ev_val
        
        if not exp_response:
            exp_response = "Lead Director, Lighting Specialist, Camera Operator, Art Director"
            
        if isinstance(exp_response, str):
            raw_list = [e.strip() for e in exp_response.split(",")]
            experts = [e for e in raw_list if len(e) < 30][:4]
            if not experts or len(experts) < 4:
                experts = ["Lead Director", "Lighting Specialist", "Camera Operator", "Art Director"]
        else:
            experts = ["Lead Director", "Lighting Specialist", "Camera Operator", "Art Director"]
            
        experts_str = ", ".join(experts)
        yield f"data: {json.dumps({'event': 'experts', 'experts': experts, 'message': f'Gewählte Experten: {experts_str}'})}\n\n"
        
        # 2. Lead Architect Draft
        if PACING_DELAY > 0 and model != 'lm-studio':
            yield f"data: {json.dumps({'event': 'log', 'message': f'⏳ Pause von {PACING_DELAY}s zur Ratenbegrenzungs-Schonung...'})}\n\n"
            time.sleep(PACING_DELAY)
            
        yield f"data: {json.dumps({'event': 'log', 'message': f'📝 {experts[0]} entwirft das erste Konzept...'})}\n\n"
        draft_sys = f"Du bist der {experts[0]}. Erstelle basierend auf dem Kontext einen ersten Rohentwurf des fertigen JSON Outputs."
        
        draft = None
        for ev_type, ev_val in call_ai([{"role": "system", "content": draft_sys}, {"role": "user", "content": f"Kontext:\n{context}"}], temperature=0.6):
            if ev_type == 'log':
                yield ev_val
            elif ev_type == 'result':
                draft = ev_val
                
        if not draft:
            draft = "Fehler beim Erstellen des ersten Entwurfs."
            
        yield f"data: {json.dumps({'event': 'draft', 'content': draft, 'message': 'Entwurf erfolgreich erstellt.'})}\n\n"
        
        # 3. Review Board
        if PACING_DELAY > 0 and model != 'lm-studio':
            yield f"data: {json.dumps({'event': 'log', 'message': f'⏳ Pause von {PACING_DELAY}s zur Ratenbegrenzungs-Schonung...'})}\n\n"
            time.sleep(PACING_DELAY)
            
        yield f"data: {json.dumps({'event': 'log', 'message': f'🕵️ Review Board startet ({len(experts)-1} Reviews)...'})}\n\n"
        reviews = []
        for i, role in enumerate(experts[1:], 1): # Skip the Lead Director
            if i > 1 and PACING_DELAY > 0 and model != 'lm-studio':
                yield f"data: {json.dumps({'event': 'log', 'message': f'⏳ Pause von {PACING_DELAY}s zur Ratenbegrenzungs-Schonung...'})}\n\n"
                time.sleep(PACING_DELAY)
                
            yield f"data: {json.dumps({'event': 'log', 'message': f'   - Analysiere mit Experte: {role}...'})}\n\n"
            rev_sys = f"Du bist ein {role} in einem Review-Board für AI Prompts."
            rev_user = f"Bisheriger Entwurf (JSON):\n{draft}\n\nFinde aus deiner speziellen Fachrichtung genau 2 konkrete Verbesserungen, die in den Text-Prompts oder Einstellungen noch fehlen oder schwammig sind. Liefere NUR kritisches Feedback in Stichpunkten, keine Floskeln."
            
            rev = None
            for ev_type, ev_val in call_ai([{"role": "system", "content": rev_sys}, {"role": "user", "content": rev_user}], temperature=0.7):
                if ev_type == 'log':
                    yield ev_val
                elif ev_type == 'result':
                    rev = ev_val
            
            if rev:
                reviews.append(f"### Gutachten vom {role}:\n{rev}\n")
                yield f"data: {json.dumps({'event': 'review', 'role': role, 'content': rev, 'message': f'Feedback von {role} erhalten.'})}\n\n"
            else:
                yield f"data: {json.dumps({'event': 'log', 'message': f'   ⚠️ Fehler beim Feedback von {role}.'})}\n\n"
                
        # 4. Master Merge
        if PACING_DELAY > 0 and model != 'lm-studio':
            yield f"data: {json.dumps({'event': 'log', 'message': f'⏳ Pause von {PACING_DELAY}s zur Ratenbegrenzungs-Schonung...'})}\n\n"
            time.sleep(PACING_DELAY)
            
        yield f"data: {json.dumps({'event': 'log', 'message': f'🏗️ {experts[0]} fusioniert Feedback in das Konzept...'})}\n\n"
        reviews_str = "\n".join(reviews)
        merge_sys = f"Du bist der {experts[0]}. Fusioniere das Feedback deiner Kollegen in den finalen JSON Output."
        merge_user = f"Ursprüngliche Regeln:\n{sys_prompt}\n\nRohentwurf:\n{draft}\n\nFeedback der Kollegen:\n{reviews_str}\n\nSchreibe den JSON Entwurf neu und integriere die Verbesserungen der Experten in die Prompts. Liefere AUSSCHLIESSLICH das finale JSON Objekt zurück (ohne Markdown Code Blocks)."
        
        final_concept = None
        for ev_type, ev_val in call_ai([{"role": "system", "content": merge_sys}, {"role": "user", "content": merge_user}], temperature=0.4):
            if ev_type == 'log':
                yield ev_val
            elif ev_type == 'result':
                final_concept = ev_val
                
        if not final_concept:
            final_concept = draft
            
        yield f"data: {json.dumps({'event': 'final', 'content': final_concept, 'message': 'Workflow erfolgreich beendet!'})}\n\n"
        
    return Response(event_stream(), mimetype='text/event-stream')

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5080))
    print(f"Auto-Bot Server gestartet auf Port {port}")
    # debug=True sollte in einer echten Produktionsumgebung auf False stehen!
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_ENV") == "development")
