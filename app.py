import os
import json
import time
import re
import markdown
from flask import Flask, request, jsonify, send_file, Response
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv

import tempfile
import cv2
import numpy as np
from pathlib import Path
from watermark_engine.gemini_engine import GeminiEngine
from watermark_engine import region_eraser
from watermark_engine import image_io
from watermark_engine.metadata import remove_ai_metadata

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
    if '3.6-flash' in model_lower:
        return 'gemini-3.6-flash'
    elif '3.5-flash-lite' in model_lower:
        return 'gemini-3.5-flash-lite'
    elif '3.5-flash' in model_lower:
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
    model = data.get('model', 'gemini-3.5-flash-lite')
    sys_prompt = data.get('system_prompt', '')
    lm_url = data.get('lm_url', 'http://127.0.0.1:1234/v1')
    
    print(f"[Optimize] Optimizing raw goal with {model}...")
    
    messages = []
    if sys_prompt:
        messages.append({"role": "system", "content": sys_prompt})
    messages.append({"role": "user", "content": raw_goal})
    
    optimized = get_ai_response(messages, model=model, temperature=0.5, lm_studio_base=lm_url)
    return jsonify({"optimized_goal": optimized if optimized else ""})

@app.route('/api/copilot', methods=['POST'])
def run_copilot():
    data = request.json
    idea = data.get('idea', '')
    lm_url = data.get('lm_url', 'http://127.0.0.1:1234/v1')
    
    if not idea:
        return jsonify({"error": "Keine Idee angegeben"}), 400
        
    print(f"[Co-Pilot] Analyzing idea with gemini-3.5-flash-lite: {idea[:60]}...")
    
    sys_prompt = (
        "Du bist der KI-Co-Pilot für ein professionelles Bild- und Video-Prompt-Engineering-Tool. "
        "Deine Aufgabe ist es, die Idee des Nutzers vollständig zu analysieren, festzustellen, ob eine Person im Mittelpunkt steht, "
        "einen sehr ausführlichen, hochauflösenden englischen Gesamt-Prompt (baseConcept) zu formulieren (der alle Details, Titel, Magazin-Cover, Stimmung, Atmosphäre, Hintergrund und Blicke enthält), "
        "und die perfekten Dropdown-Parameter für Kamera, Optik, Licht, Komposition und Oberflächen-Physik auszuwählen. "
        "Antworte AUSSCHLIESSLICH in folgendem gültigen JSON-Format (keine Markdown-Codeblocks, kein Fließtext davor oder danach):\n"
        "{\n"
        "  \"hasPerson\": true oder false,\n"
        "  \"baseConcept\": \"Vollständige, extrem detaillierte englische Übersetzung und Ausformulierung der gesamten Nutzer-Idee inklusive Magazin-Titeln, Stimmung, Umgebungsdetails und Blickkontakt.\",\n"
        "  \"reasoning\": \"Eine kurze, begeisternde Erklärung (2-3 Sätze auf Deutsch) für Anfänger, warum diese Kamera- und Lichtwerte gewählt wurden.\",\n"
        "  \"fields\": {\n"
        "    \"gender\": \"woman|man|non-binary person|android robot\",\n"
        "    \"ageGroup\": \"20 years old, young adult|30 years old\",\n"
        "    \"ethnicity\": \"East Asian|Scandinavian|American|Germanic\",\n"
        "    \"bodyType\": \"slender model physique|athletic toned body\",\n"
        "    \"hairColor\": \"blonde|brunette|black|ginger red\",\n"
        "    \"expression\": \"neutral cool expression|happy beaming smile\",\n"
        "    \"clothing\": \"black leather jacket|casual t-shirt and jeans\",\n"
        "    \"action\": \"Vollständige englische Beschreibung der gesamten Handlung, Pose, Magazin-Titel und Blickkontakt\",\n"
        "    \"sceneType\": \"cinematic realism|cyberpunk sci-fi|high fantasy|dark horror atmosphere\",\n"
        "    \"location\": \"rainy Tokyo street|skyscraper office|pristine tropical beach|San Francisco cityscape\",\n"
        "    \"lighting\": \"dramatic cinematic lighting|soft natural window light|neon cyan and magenta lighting\",\n"
        "    \"lightingSetup\": \"3-point studio lighting setup, balanced key and fill|strong rim light, backlit silhouette, glowing edges|chiaroscuro lighting, deep dramatic shadows, Caravaggio style|gobo light modifier, Venetian blind shadow patterns|neon split lighting, dual tone cyan and magenta glow\",\n"
        "    \"weather\": \"heavy rain|clear sunny sky|thick fog\",\n"
        "    \"focalLength\": \"14mm ultra-wide lens, dynamic perspective distortion|35mm prime lens, natural narrative perspective|50mm standard lens, true to life human vision|85mm portrait lens, flattering compression|200mm telephoto lens, background compression|2x anamorphic lens, oval bokeh, ultra-wide cinema ratio\",\n"
        "    \"apertureDoF\": \"f/1.2 aperture, razor-thin depth of field, sharp focus on subject|f/1.8 aperture, creamy blurred background bokeh|f/2.8 aperture, clean subject separation|f/8 aperture, deep focus, sharp background details\",\n"
        "    \"composition\": \"rule of thirds composition|centered symmetrical composition, Wes Anderson style|golden ratio spiral composition|dynamic leading lines pointing to subject|minimalist composition, vast negative space|frame within a frame composition\",\n"
        "    \"colorGrading\": \"Teal and Orange color grading, Hollywood blockbuster palette|soft pastel color palette, gentle muted tones|monochromatic black and white with vibrant color accent|muted organic earth tones, natural film palette|saturated neon RGB color grading, high contrast\",\n"
        "    \"vfxParticles\": \"floating embers, glowing sparks, atmospheric heat|floating dust motes in light rays, atmospheric particles|glowing bioluminescent spores, magical particles|cinematic lens flare, anamorphic blue glare|dense volumetric fog, atmospheric haze, smoke drift\",\n"
        "    \"surfaceCondition\": \"rain-slicked wet surface, glossy water reflections|glistening skin sheen, subtle sweat droplets|frost crystals, frozen texture, icy sheen|water droplets on camera lens, optical distortion\",\n"
        "    \"detailLevel\": \"8k raw photo, extreme detail, no smoothing, uncompressed|16k uncompressed raw photo, hyper-detailed texture map|microscopic detail level, extreme texture precision\",\n"
        "    \"skinPhysics\": \"subsurface scattering, translucent skin, realistic epidermis|subsurface skin scattering, natural epidermal sheen, realistic pores|sweaty glossy skin texture, intense specular highlights|porcelain skin|matte velvet skin finish, soft touch texture|natural freckles, realistic skin pigmentation, beauty marks\",\n"
        "    \"microDetails\": \"visible pores, vellus hair, natural skin texture imperfections|vellus peach fuzz hair, micro skin pores, natural imperfections|natural expression lines, subtle crow's feet, micro wrinkles|microscopic iris filaments, vibrant eye catchlight reflections\",\n"
        "    \"vfxParticles\": \"floating embers, glowing sparks, atmospheric heat|floating dust motes in light rays, atmospheric particles|glowing bioluminescent spores, magical particles|refractive heat shimmer, mirage distortion, atmospheric heat haze|cinematic lens flare, anamorphic blue glare|swirling backlit snowflakes, icy air motes|slight chromatic aberration, optical prism fringing, lens distortion|dense volumetric fog, atmospheric haze, smoke drift\",\n"
        "    \"surfaceCondition\": \"rain-slicked wet surface, glossy water reflections|glistening morning dew droplets, wet surface sheen|glistening skin sheen, subtle sweat droplets|splattered mud droplets, gritty surface texture|frost crystals, frozen texture, icy sheen|mirror-like water puddle reflections, wet asphalt|water droplets on camera lens, optical distortion\",\n"
        "    \"lightingSetup\": \"3-point studio lighting setup, balanced key and fill|strong rim light, backlit silhouette, glowing edges|intense volumetric backlighting, glowing silhouette edges|warm flickering candlelight, deep orange ambient glow|chiaroscuro lighting, deep dramatic shadows, Caravaggio style|gobo light modifier, Venetian blind shadow patterns|neon split lighting, dual tone cyan and magenta glow|classic butterfly beauty lighting, flattering chin shadow\",\n"
        "    \"sensorPhysics\": \"medium format CCD sensor crispness, ultra dynamic range|cctv footage, phone camera noise, raw sensor data|zero denoising, grainy texture, authentic iso noise|authentic 35mm film grain, analog texture|heavy 16mm vintage film grain, retro cinema noise|heavy film grain\",\n"
        "    \"opticsLogic\": \"24mm lens, f/8 aperture, deep depth of field, everything in focus|85mm lens, f/1.8 aperture, creamy bokeh background|Petzval vintage lens, swirling background bokeh|tilt-shift lens effect, miniature model depth of field|split-diopter shot, dual focus foreground and background|softar diffusion filter, creamy skin glow|macro lens, shallow depth of field\",\n"
        "    \"lightingLogic\": \"direct neutral white flash, harsh shadows, amateur photography|fashion ringlight illumination, halo eye catchlights|hard direct on-camera flash, stark shadows, 90s party snap|soft diffused strobe flash, gentle wrap-around light|no studio lighting, ambient light only|professional studio lighting setup\",\n"
        "    \"colorFidelity\": \"raw color tones, flat profile, low contrast, desaturated|warm Kodak Gold analog film tones, golden highlights|vibrant Fujifilm Velvia saturated landscape colors|gritty bleach bypass color grading, desaturated high contrast|vibrant Technicolor 3-strip vintage color palette|vivid colors, high saturation, instagram filter|black and white, monochrome\",\n"
        "    \"filmStock\": \"Kodak Portra 400 film grain|Cinestill 800T halation|Fujifilm Velvia 50|digital crisp 8k\"\n"
        "  }\n"
        "}\n"
        "Kürze nichts ab! Die vollständige Idee muss im baseConcept und action-Feld enthalten sein."
    )
    
    messages = [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": f"Idee des Nutzers:\n{idea}"}
    ]
    
    res_text = get_ai_response(messages, model='gemini-3.5-flash-lite', temperature=0.3, lm_studio_base=lm_url)
    
    if not res_text:
        return jsonify({"error": "Leere Antwort vom KI Co-Pilot."}), 500
        
    try:
        clean_json = res_text.strip()
        if "```json" in clean_json:
            clean_json = clean_json.split("```json")[1].split("```")[0].strip()
        elif "```" in clean_json:
            clean_json = clean_json.split("```")[1].split("```")[0].strip()
            
        parsed = json.loads(clean_json)
        return jsonify(parsed)
    except Exception as e:
        print(f"[Co-Pilot Error] Could not parse JSON: {e}\nRaw output: {res_text}")
        return jsonify({
            "reasoning": "Der Co-Pilot hat deine Idee verarbeitet und grundlegende Einstellungen gewählt.",
            "fields": {
                "sceneType": "cinematic realism",
                "detailLevel": "8k raw photo, extreme detail, no smoothing, uncompressed"
            }
        })

@app.route('/api/generate', methods=['POST'])
def generate_solution():
    data = request.json
    goal = data.get('goal', '')
    model = data.get('model', 'gemini-3.5-flash-lite')
    sys_prompt = data.get('system_prompt', '')
    lm_url = data.get('lm_url', 'http://127.0.0.1:1234/v1')
    level = str(data.get('level', '3'))
    
    print(f"[Auto Bot] Starting Agentic Workflow (Level {level}) with {model}...")
    
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

        if level == '1':
            yield f"data: {json.dumps({'event': 'log', 'message': '🌱 Level 1 (Raw / Purist): Übersetze Idee und setze primären Fokus...'})}\n\n"
            sys_prompt_l1 = (
                "Du bist ein puristischer Prompt-Engineer. Übersetze die Idee ins Englische und füge maximal 2–3 prägnante, stilistische Keywords hinzu. "
                "Erzeuge KEINE überladenen oder widersprüchlichen Prompts. Belasse das Bild so roh und authentisch wie möglich. "
                "Liefere AUSSCHLIESSLICH das finale JSON Objekt zurück (wie in der Strukturvorgabe gefordert)."
            )
            l1_user = f"Strukturvorgaben & Regeln:\n{sys_prompt}\n\nNutzer-Prompt:\n{goal}"
            
            final_concept = None
            for ev_type, ev_val in call_ai([{"role": "system", "content": sys_prompt_l1}, {"role": "user", "content": l1_user}], temperature=0.3):
                if ev_type == 'log': yield ev_val
                elif ev_type == 'result': final_concept = ev_val
                    
            if not final_concept:
                final_concept = "{ \"error\": \"Generierung fehlgeschlagen.\" }"
            
            yield f"data: {json.dumps({'event': 'final', 'content': final_concept, 'message': 'Level 1 Prompt generiert!'})}\n\n"
            return
            
        elif level == '2':
            yield f"data: {json.dumps({'event': 'log', 'message': '⚖️ Level 2 (Balanced): Optimiere Struktur und ergänze grundlegende Einstellungen...'})}\n\n"
            sys_prompt_l2 = (
                "Du bist ein erfahrener Prompt-Engineer. Optimiere den Prompt leicht. Füge grundlegende Licht- und Kameraeinstellungen hinzu, "
                "aber achte strikt darauf, keine logischen Widersprüche (z.B. weiches Mondlicht vs. harte Kontraste) zu erzeugen. "
                "Der Prompt soll balanciert und stimmig wirken, ohne die KI mit Mikro-Details zu bombardieren. "
                "Liefere AUSSCHLIESSLICH das finale JSON Objekt zurück (wie in der Strukturvorgabe gefordert)."
            )
            l2_user = f"Strukturvorgaben & Regeln:\n{sys_prompt}\n\nNutzer-Prompt:\n{goal}"
            
            final_concept = None
            for ev_type, ev_val in call_ai([{"role": "system", "content": sys_prompt_l2}, {"role": "user", "content": l2_user}], temperature=0.5):
                if ev_type == 'log': yield ev_val
                elif ev_type == 'result': final_concept = ev_val
                    
            if not final_concept:
                final_concept = "{ \"error\": \"Generierung fehlgeschlagen.\" }"
            
            yield f"data: {json.dumps({'event': 'final', 'content': final_concept, 'message': 'Level 2 Prompt generiert!'})}\n\n"
            return

        yield f"data: {json.dumps({'event': 'log', 'message': '🚀 Level 3 (Overdrive): Starte volle 4-Agenten-Diskussion...'})}\n\n"

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

@app.route('/api/watermark/remove', methods=['POST'])
def remove_watermark():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "Empty file"}), 400

    remove_synthid = request.form.get('remove_synthid') == 'true'

    temp_path = None
    out_path = None
    try:
        # Save uploaded file to a temporary file
        fd, temp_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        file.save(temp_path)

        # Read image
        img = image_io.imread(temp_path)
        if img is None:
            return jsonify({"error": "Could not read image"}), 400
        
        # Detect & remove visible watermark
        engine = GeminiEngine()
        mask = engine.footprint_mask(img, force=True)
        
        out_fd, out_path = tempfile.mkstemp(suffix=".png")
        os.close(out_fd)

        if mask is not None:
            cleaned = region_eraser.erase(img, mask=mask)
            image_io.imwrite(out_path, cleaned)
        else:
            import shutil
            shutil.copyfile(temp_path, out_path)
        
        # If requested, strip SynthID metadata (C2PA / EXIF / XMP)
        if remove_synthid:
            remove_ai_metadata(Path(out_path), Path(out_path))

        return send_file(out_path, mimetype='image/png')
            
    except Exception as e:
        print(f"Error processing watermark: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5080))
    print(f"Auto-Bot Server gestartet auf Port {port}")
    # debug=True sollte in einer echten Produktionsumgebung auf False stehen!
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_ENV") == "development")
