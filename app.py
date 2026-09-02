import os
import json
import time
import re
import concurrent.futures
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
gemini_client = OpenAI(api_key=GEMINI_API_KEY, base_url=GEMINI_BASE, timeout=60.0)

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

def get_ai_response_stream(messages, model, temperature=0.7, lm_studio_base="http://127.0.0.1:1234/v1", timeout=60.0, response_format=None):
    """Core generator that calls Gemini with automatic fallback (3.5 Flash-Lite -> 2.5 Flash -> LM Studio)."""
    import time
    import re
    
    # Model fallback chain
    model_chain = []
    mapped = map_model_name(model)
    
    if mapped == 'lm-studio':
        model_chain = ['lm-studio']
    elif mapped == 'gemini-3.6-flash':
        model_chain = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'lm-studio']
    elif mapped == 'gemini-3.5-flash':
        model_chain = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'lm-studio']
    elif mapped == 'gemini-3.5-flash-lite':
        model_chain = ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'lm-studio']
    elif mapped == 'gemini-2.5-flash':
        model_chain = ['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'lm-studio']
    else:
        model_chain = [mapped, 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'lm-studio']

    # Deduplicate chain while preserving order
    seen = set()
    model_chain = [x for x in model_chain if not (x in seen or seen.add(x))]

    last_err = None

    for target_model_name in model_chain:
        if target_model_name == 'lm-studio':
            client = OpenAI(api_key="lm-studio", base_url=lm_studio_base)
            target_model = get_lm_studio_model(lm_studio_base)
            is_gemini = False
        else:
            client = gemini_client
            target_model = target_model_name
            is_gemini = True

        try:
            kwargs = {
                'model': target_model,
                'messages': messages,
                'temperature': temperature,
                'timeout': timeout
            }
            if response_format and is_gemini:
                kwargs['response_format'] = response_format

            if is_gemini:
                kwargs['stream'] = True
                stream_res = client.chat.completions.create(**kwargs)
                accumulated = []
                last_ping = time.time()
                for chunk in stream_res:
                    if chunk.choices and chunk.choices[0].delta.content:
                        accumulated.append(chunk.choices[0].delta.content)
                    now = time.time()
                    if now - last_ping > 1.5:
                        yield ('ping', ': keep-alive\n\n')
                        last_ping = now
                full_text = "".join(accumulated)
                yield ('result', full_text)
                return
            else:
                res = client.chat.completions.create(**kwargs)
                yield ('result', res.choices[0].message.content)
                return
        except Exception as e:
            last_err = str(e)
            if is_gemini and ("429" in last_err or "RESOURCE_EXHAUSTED" in last_err or "quota" in last_err.lower()):
                yield ('log', f"⚡ Modell {target_model} Quota/Rate-Limit erreicht. Schalte sofort auf Fallback um...")
            else:
                yield ('log', f"🔄 Wechsele auf Fallback-Modell wegen Fehler in {target_model_name}...")
            continue

    yield ('error', f"Alle Modelle in der Fallback-Kette fehlgeschlagen. Letzter Fehler: {last_err}")

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
def serve_index():
    return send_file('index.html')

@app.route('/download-manual')
@app.route('/Nano_Banana_Ultimate_Kamera_und_Prompt_Handbuch.pdf')
def download_manual():
    pdf_path = os.path.join(app.root_path, 'Nano_Banana_Ultimate_Kamera_und_Prompt_Handbuch.pdf')
    if os.path.exists(pdf_path):
        return send_file(pdf_path, as_attachment=True, download_name='Nano_Banana_Ultimate_Kamera_und_Prompt_Handbuch.pdf')
    return jsonify({"error": "Handbuch PDF nicht gefunden"}), 404

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

def build_agency_master_prompt(meta, shots, ar_tag='--ar 16:9'):
    """Constructs a flawless, bracket-free Agency Storyboard Pitch Deck Poster prompt matching the exact shot count and grid layout."""
    if not isinstance(meta, dict):
        meta = {}
    if not isinstance(shots, list):
        shots = []

    title = str(meta.get('title') or 'Cinematic Commercial').upper()
    dur = meta.get('total_duration_seconds', 20)
    genre = meta.get('genre', 'High-End Commercial')
    
    # Extract audio key and focus
    audio_key = 'Crisp Sound Design + ASMR Atmosphere'
    for s in shots:
        if isinstance(s, dict) and s.get('audio_cues'):
            audio_key = str(s.get('audio_cues')).split('/')[0].replace('Dialogue:', '').strip()
            break
            
    focus_key = meta.get('focus', '')
    if not focus_key and shots and isinstance(shots[0], dict):
        d_val = shots[0].get('dialogue')
        if isinstance(d_val, dict):
            focus_key = d_val.get('speaker', '')
        elif isinstance(d_val, str):
            focus_key = d_val
    if not focus_key:
        focus_key = 'Main Subject'
    
    num_shots = len(shots)
    if num_shots <= 2:
        grid_desc = f'A structured 1x2 horizontal dual-panel presentation board with {num_shots} sequential numbered scene cards'
    elif num_shots <= 4:
        grid_desc = f'A structured 2x2 grid layout presentation board with {num_shots} sequential numbered scene cards'
    elif num_shots <= 6:
        grid_desc = f'A structured 2x3 grid layout presentation board with {num_shots} sequential numbered scene cards'
    else:
        grid_desc = f'A structured 2x4 grid layout presentation board with {num_shots} sequential numbered scene cards'
        
    panels_text = []
    for idx, s in enumerate(shots):
        if not isinstance(s, dict):
            continue
        s_num = s.get('shot_number', idx + 1)
        s_dur = s.get('duration_seconds', 3)
        framing = s.get('framing', 'Cinematic Shot')
        rig = s.get('camera_rig', {})
        if isinstance(rig, dict):
            cam_info = f"{framing}, {rig.get('camera', 'Arri Alexa')} {rig.get('focal_length', '50mm')} {rig.get('lens', 'Prime')}"
        else:
            cam_info = f"{framing}, {str(rig)}"
        light_info = s.get('lighting', 'Cinematic studio lighting with realistic subsurface scattering')
        motion_info = s.get('camera_motion', 'Smooth cinematic camera movement')
        detail_info = s.get('director_notes', '') or str(s.get('keyframe_image_prompt', ''))[:60]
        
        # Strip all bracket characters to prevent Midjourney placeholder hallucinations
        cam_info = str(cam_info).replace('[', '').replace(']', '')
        light_info = str(light_info).replace('[', '').replace(']', '')
        motion_info = str(motion_info).replace('[', '').replace(']', '')
        detail_info = str(detail_info).replace('[', '').replace(']', '')
        
        panel_str = (
            f"Scene {s_num} ({s_dur}s badge): {framing}. "
            f"Camera: {cam_info}. "
            f"Visual: {light_info}. "
            f"Action: {motion_info}. "
            f"Product detail: {detail_info}."
        )
        panels_text.append(panel_str)
        
    scenes_joined = " ".join(panels_text)
    first_dur = shots[0].get('duration_seconds', 3) if shots and isinstance(shots[0], dict) else 3
    
    prompt = (
        f"A professional advertising agency presentation board, campaign pitch deck storyboard infographic poster. "
        f"Top banner with bold uppercase typography 'PREMIUM ADVERTISING AGENCY PRESENTATION: {title}'. "
        f"Header features 4 distinct colored metadata badge pills: 'Duration: {dur} Seconds', 'Style: {genre}', 'Focus: {focus_key}', 'Audio: {audio_key}', and a top-right info card 'Why This Style Works: High-impact cinematic visual pacing designed for maximum engagement and brand recall'. "
        f"Below is {grid_desc}. Each scene card has a top-left 'Scene X' badge, a top-right red duration badge (e.g. '{first_dur}s'), and a clean white border. "
        f"Underneath each image panel are 4 clean structured typographic subtitle lines (Camera, Visual, Action, Product detail): {scenes_joined} "
        f"Warm cream off-white editorial presentation board background, sharp graphic design layout, crisp typography, clean card margins, commercial advertising photography, 8k resolution concept art {ar_tag}"
    )
    return prompt

@app.route('/api/autobot/storyboard', methods=['POST'])
def generate_autobot_storyboard():
    data = request.json or {}
    concept = data.get('concept', '')
    duration = int(data.get('duration', 30))
    shot_count_req = data.get('shot_count', 'auto')
    aspect_ratio = data.get('aspect_ratio', '16:9')
    genre = data.get('genre', 'Hollywood Storytelling')
    pacing_style = data.get('pacing_style', 'balanced')
    character_info = data.get('character', '')
    model = data.get('model', 'gemini-3.5-flash-lite')
    lm_url = data.get('lm_url', 'http://127.0.0.1:1234/v1')
    language = data.get('language', 'de')
    export_format = data.get('export_format', 'google_flow')
    strict_camera_rig = data.get('strict_camera_rig', True)

    if not concept:
        return jsonify({"error": "Bitte gib ein Konzept oder eine Video-Idee ein."}), 400

    # Clean aspect ratio parameter for Midjourney / Nano Banana
    ar_tag = f"--ar {aspect_ratio}" if not aspect_ratio.startswith('--ar') else aspect_ratio

    def event_stream():
        # Helper to call AI and yield logs during retries
        def call_ai(messages, temperature=0.7, timeout=60.0, response_format=None):
            for event_type, val in get_ai_response_stream(messages, model, temperature, lm_studio_base=lm_url, timeout=timeout, response_format=response_format):
                if event_type == 'log':
                    yield ('log', f"data: {json.dumps({'event': 'log', 'message': val})}\n\n")
                elif event_type == 'ping':
                    yield ('ping', val)
                elif event_type == 'result':
                    yield ('result', val)
                elif event_type == 'error':
                    yield ('log', f"data: {json.dumps({'event': 'log', 'message': f'🔴 {val}'})}\n\n")

        # ---------------------------------------------------------
        # STAGE 1: INGESTION & PACING ANALYSIS
        # ---------------------------------------------------------
        yield f"data: {json.dumps({'event': 'log', 'message': '🚀 AutoBot Multi-Agent Board gestartet: Ingestion & Pacing...'})}\n\n"
        
        if pacing_style == 'fast':
            pacing_desc = "Fast & Punchy (Schnelle Schnitte 2.5s-5s für maximale Dynamik / Commercials)"
            target_avg_shot = 3.5
        elif pacing_style == 'atmospheric':
            pacing_desc = "Slow Atmospheric (Ruhige, getragene Kamerafahrten 5s-8s / Doku / Drama)"
            target_avg_shot = 6.0
        else:
            pacing_desc = "Cinematic Balanced (Dynamischer Rhythmus 3s - 7s)"
            target_avg_shot = 4.5

        if shot_count_req != 'auto':
            try:
                estimated_shots = max(1, int(shot_count_req))
                shot_mode_text = f"EXAKT {estimated_shots} Shots (Manuell festgelegt)"
            except Exception:
                estimated_shots = max(2, round(duration / target_avg_shot))
                shot_mode_text = f"~{estimated_shots} Shots (Auto Pacing)"
        else:
            estimated_shots = max(2, round(duration / target_avg_shot))
            shot_mode_text = f"~{estimated_shots} Shots (Auto Pacing)"

        yield f"data: {json.dumps({'event': 'log', 'message': f'🎬 Ziel-Dauer: {duration}s -> {shot_mode_text} | Pacing: {pacing_desc} | Format: {export_format.upper()} | Sprache: {language.upper()}'})}\n\n"

        # ---------------------------------------------------------
        # STAGE 2: 4 SPECIALIZED EXPERT AGENTS ASSEMBLY
        # ---------------------------------------------------------
        experts = [
            "Executive Director (Dramaturgie & Pacing)",
            "Lighting Director (Chiaroscuro & SSS Physik)",
            "Camera Operator (Optik, Brennweite & Trajektorien)",
            "Visual Artist (Charakter-Konsistenz & Keyframe Texturen)"
        ]
        experts_str = ", ".join(experts)
        yield f"data: {json.dumps({'event': 'log', 'message': f'🧠 4-Agenten-Gremium einberufen: {experts_str}'})}\n\n"

        if PACING_DELAY > 0:
            time.sleep(1)

        # ---------------------------------------------------------
        # STAGE 3: LEAD ARCHITECT INITIAL DRAFT
        # ---------------------------------------------------------
        yield f"data: {json.dumps({'event': 'log', 'message': '📝 Lead Executive Producer entwirft das initiale Storyboard-Konzept...'})}\n\n"
        
        draft_prompt = f"""Erstelle ein erstes Storyboard-Konzept für ein KI-Video mit {duration}s Länge.
Konzept: {concept}
Genre: {genre}
Seitenverhältnis: {aspect_ratio} ({ar_tag})
Charakter-Info: {character_info}
Pacing: {pacing_desc}
Dialogsprache: {language}

Strukturiere das Konzept vorab in ca. {estimated_shots} Shots mit Idee, Kameraführung (Camera Director Vektoren), Optik, Beleuchtung, Dialogen und nahtlosen Übergängen."""

        draft_res = None
        for ev_type, ev_val in call_ai([{"role": "system", "content": "Du bist ein erfahrener KI-Regisseur und Director of Photography."}, {"role": "user", "content": draft_prompt}], temperature=0.6):
            if ev_type in ('log', 'ping'):
                yield ev_val
            elif ev_type == 'result':
                draft_res = ev_val

        if not draft_res:
            draft_res = f"Initiales Konzept für {concept}"

        yield f"data: {json.dumps({'event': 'log', 'message': '✅ Erster Regie-Entwurf erstellt. Übergeben an das Experten-Board...'})}\n\n"

        # ---------------------------------------------------------
        # STAGE 4: 4-AGENT REVIEW BOARD DEBATE & CRITIQUE (PARALLEL)
        # ---------------------------------------------------------
        yield f"data: {json.dumps({'event': 'log', 'message': '⚡ 4-Agenten-Gremium analysiert den Entwurf simultan in Echtzeit...'})}\n\n"

        def evaluate_expert_role(role_name):
            rev_sys = f"Du bist der {role_name} in einem High-End Filmproduktions-Board für Veo 3.1, Google Flow und Nano Banana."
            rev_user = f"""Prüfe folgenden Entwurf für ein {duration}s KI-Video ({genre}):
{draft_res}

Finde aus der Sicht deiner Fachrolle ({role_name}) die 2-3 wichtigsten Optimierungspunkte bezüglich:
1. Optik/Kamera/Brennweite (z. B. Arri Alexa, Anamorphic Lenses, Brennweite in mm, T-Stop) und Beleuchtung (Kelvin-Farbtemperatur).
2. Pacing (Shot-Längen 3s-8s) und dynamische Vektorbewegungen (Camera Director Trajektorien).
3. Konsistente @Avatar-Tags und Dialoge (Sprache: {language}).
Liefere kurze, präzise Anweisungen in Stichpunkten."""
            res = get_ai_response([{"role": "system", "content": rev_sys}, {"role": "user", "content": rev_user}], model=model, temperature=0.5, lm_studio_base=lm_url)
            return role_name, res

        reviews = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            future_to_role = {executor.submit(evaluate_expert_role, role): role for role in experts}
            pending = set(future_to_role.keys())
            while pending:
                done, pending = concurrent.futures.wait(pending, timeout=1.0, return_when=concurrent.futures.FIRST_COMPLETED)
                if not done:
                    yield ": keep-alive\n\n"
                for future in done:
                    role = future_to_role[future]
                    try:
                        _, rev_text = future.result()
                        if rev_text:
                            reviews.append(f"### Gutachten von {role}:\n{rev_text}")
                            yield f"data: {json.dumps({'event': 'log', 'message': f'   💬 Feedback von {role} erhalten.'})}\n\n"
                        else:
                            yield f"data: {json.dumps({'event': 'log', 'message': f'   ⚠️ {role} hat Entwurf bestätigt.'})}\n\n"
                    except Exception as ex:
                        yield f"data: {json.dumps({'event': 'log', 'message': f'   ⚠️ {role} übersprungen: {ex}'})}\n\n"

        reviews_str = "\n\n".join(reviews) if reviews else "Alle Experten haben den Entwurf ohne Einwände freigegeben."

        # ---------------------------------------------------------
        # STAGE 5: MASTER SYNTHESIS (FINAL STRICT JSON STORYBOARD)
        # ---------------------------------------------------------
        if PACING_DELAY > 0:
            time.sleep(PACING_DELAY)

        yield f"data: {json.dumps({'event': 'log', 'message': '🏗️ Prompt Architect fusioniert das Feedback aller 4 Agenten in das finale Storyboard JSON...'})}\n\n"

        final_system_prompt = f"""Du bist der weltweit führende AI Video Executive Director & Prompt Architect für Google Flow & Veo 3.1.
Deine Aufgabe ist es, aus dem Erstentwurf und dem Experten-Feedback ein PERFEKTES, konsistentes Video-Storyboard JSON für einen KI-Kurzfilm ({duration}s Gesamtlänge) zu synthetisieren.

FEEDBACK DER 4 EXPERTEN:
{reviews_str}

STRIKTE REGIE- & SCHEMA-REGELN:
1. **DYNAMISCHES PACING**: Die Summe aller `duration_seconds` MUSS EXAKT {duration} Sekunden ergeben!
2. **SHOT ANZAHL & NUMMERIERUNG**: Es MÜSSEN EXAKT {estimated_shots} Shots generiert werden (Shot 1 bis Shot {estimated_shots})! `shot_number` MUSS fortlaufend von 1 bis {estimated_shots} sein. KEINE Split-Nummern (wie 4a/4b).
3. **CAMERA RIG & OPTIK**: Jedes Shot-Objekt MUSS ein `camera_rig` Objekt enthalten mit:
   - "camera": "Arri Alexa Mini LF" | "RED V-Raptor" | "Sony Venice 2" | "IMAX 70mm"
   - "lens": "Anamorphic Prime" | "Master Prime" | "Vintage Cooke Speed Panchro"
   - "focal_length": "24mm" | "35mm" | "50mm" | "75mm" | "85mm" | "100mm"
   - "aperture": "T1.4" | "T2.0" | "T2.8" | "T4.0"
4. **CAMERA DIRECTOR MOTION**: `camera_motion` verwendet exakte Vektor-Bewegungen (z. B. "Slow horizontal dolly pan left to right with parallax", "Organic handheld micro-jitter", "Slow vertical crane jib up", "FPV drone fast dive", "Tracking follow shot with dynamic foreground occlusion").
5. **BELEUCHTUNG & KELVIN**: `lighting` nennt präzise Farbtemperaturen (z. B. "3200K warm tungsten key light vs. 5600K cool blue ambient window light, volumetric rim lighting").
6. **DUAL PIPELINE PROMPTS**:
   - `keyframe_image_prompt` (T2I für Nano Banana / Midjourney): Vollständiger Prompt mit @Avatar-Tags, Kleidung, Setting, Camera Rig, Kelvin-Licht und {ar_tag}.
   - `i2v_motion_prompt` (I2V für Veo 3.1 / Runway): Strikt gegliedert:
     "Camera Movement: [Exakter Befehl aus camera_motion]. Subject Motion: [Physische Motorik und Gestik ohne redundante Farbbeschreibungen]. Environment Physics: [Partikel, Reflexionen, Regen, Rauch, Lichtbrechung]. Sound Design: [Natürliche Atmo und Soundkulisse]. FPS & Motion: 24fps, fluid cinematic motion."
7. **DIALOGUE**: `dialogue` ist ein Objekt mit: {{ "speaker": "@Avatar", "line": "Gesprochener Satz", "language": "{language}" }}.
8. **CHARACTER BIBLE**: Array aller auftretenden Charaktere mit `avatar_tag`, `character_id`, `name`, `demographics`, `physical_appearance`, `wardrobe`, `master_prompt_string`.
9. **AGENCY STORYBOARD PRESENTATION BOARD (MASTER PROMPT)**: 
   `master_contact_sheet_prompt` MUSS ein vollständiger, extrem detailreicher Image-Prompt für Nano Banana / Midjourney sein, der ein **vollständiges Agency-Pitch-Deck Storyboard Poster** generiert (exakt wie ein professionelles Werbeagentur-Pitchboard):
   - **Header oben**: Typografie-Header 'PREMIUM ADVERTISING AGENCY PRESENTATION: [TITEL]' mit 4 farbigen Meta-Pills ('Duration: {duration} Seconds', 'Style: {genre}', 'Focus: [Hauptmotiv/Produkt/@Avatar]', 'Audio: [Key Sound/Ambient]') und Infobox rechts 'Why This Style Works: [Visuelle Begründung]'.
   - **Strukturiertes Szenen-Grid**: Sequenzielle Szenenkarten (Scene 1, Scene 2, Scene 3...). Jede Karte besitzt ein 'Scene X'-Badge oben links und ein rundes Zeit-Badge (z. B. '2s', '3s', '4s') oben rechts.
   - **4 strukturierte Info-Zeilen unter JEDEM Szenenbild**:
     - 'Camera:' [Winkel, z. B. Overhead / Macro close-up / Controlled push-in / Low angle hero shot]
     - 'Visual:' [Optik, Beleuchtung, Texturen, Materialien]
     - 'Action:' [Physische Bewegung im Bild]
     - 'Key Detail / Focus:' [Dramaturgischer Fokus / Nutzenversprechen]
   - **Gestaltung**: Heller, warmer Cream-Hintergrund, präzises Grafikdesign, gestochen scharfe Typografie, saubere Karten-Rahmen, 8k Commercial Advertising Quality {ar_tag}.

AUSGABE-FORMAT:
Antworte AUSSCHLIESSLICH als valides JSON-Objekt (kein Markdown-Block, keine Begrüßung, kein Fließtext):
{{
  "storyboard_meta": {{
    "title": "Titel des Kurzfilms",
    "genre": "{genre}",
    "pacing_profile": "{pacing_style}",
    "total_duration_seconds": {duration},
    "total_shots": {estimated_shots},
    "aspect_ratio": "{aspect_ratio}",
    "core_narrative": "Prägnante 2-3 Sätze Zusammenfassung der Handlung",
    "master_contact_sheet_prompt": "A professional advertising agency presentation board, campaign pitch deck storyboard infographic for a cinematic commercial film. Header at top with bold typography 'PREMIUM ADVERTISING AGENCY PRESENTATION: [TITEL]', featuring 4 colored metadata badge pills: 'Duration: {duration} Seconds', 'Style: {genre}', 'Focus: [Key Subject/@Avatar]', 'Audio: [Main Sound]', and an analytical top-right info card 'Why This Style Works: [Psychological aesthetic rationale]'. Below is a clean, structured graphic design storyboard grid with sequential numbered scene cards. Each scene card has a top-left 'Scene X' badge and a top-right red duration circle badge '[Xs]'. Underneath each cinematic frame are 4 detailed typography caption lines: 'Camera: [Camera angle & lens]', 'Visual: [Lighting, texture, materials]', 'Action: [Dynamic movement]', 'Key Detail: [Story/product focus]'. Sequential scenes: Scene 1 ([X]s): [Wide establishing visual], Camera: [Angle], Visual: [Texture], Action: [Motion], Key Detail: [Focus]. Scene 2 ([X]s): [Medium subject visual], Camera: [Angle], Visual: [Texture], Action: [Motion], Key Detail: [Focus]. Scene 3 ([X]s): [Dynamic close-up visual], Camera: [Angle], Visual: [Texture], Action: [Motion], Key Detail: [Focus]. Scene 4 ([X]s): [Action climax visual], Camera: [Angle], Visual: [Texture], Action: [Motion], Key Detail: [Focus]. Scene 5 ([X]s): [Emotional reaction visual], Camera: [Angle], Visual: [Texture], Action: [Motion], Key Detail: [Focus]. Scene 6 ([X]s): [Cinematic final packshot/resolution], Camera: [Angle], Visual: [Texture], Action: [Motion], Key Detail: [Focus]. Warm cream editorial presentation background, sharp graphic design layout, crisp typography, clean card borders, professional advertising photography, 8k resolution concept art {ar_tag}"
  }},
  "character_bible": [
    {{
      "avatar_tag": "@Hero_Name",
      "character_id": "CHAR_001",
      "name": "Elena Vance",
      "demographics": "34-year-old female engineer",
      "physical_appearance": "athletic build, dark raven hair in a tight low bun, sharp emerald green eyes",
      "wardrobe": "dark navy tactical jacket over matte black turtleneck",
      "master_prompt_string": "Elena Vance, a 34-year-old female engineer, athletic build, dark raven hair in a tight low bun, sharp emerald green eyes, wearing dark navy tactical jacket"
    }}
  ],
  "shots": [
    {{
      "shot_number": 1,
      "duration_seconds": 4,
      "framing": "Wide Establishing Shot",
      "camera_rig": {{
        "camera": "Arri Alexa Mini LF",
        "lens": "Anamorphic Prime",
        "focal_length": "35mm",
        "aperture": "T2.0"
      }},
      "camera_motion": "Slow horizontal dolly pan left to right with parallax",
      "lighting": "3200K warm tungsten key light vs. 5600K cool blue ambient window light",
      "keyframe_image_prompt": "Cinematic wide establishing shot, @Hero_Name standing in futuristic abandoned laboratory, wearing dark navy tactical jacket, Arri Alexa Mini LF, 35mm Anamorphic Prime lens, T2.0, 3200K warm tungsten key light vs 5600K cool ambient, volumetric dust motes, highly detailed 8k raw photo {ar_tag}",
      "i2v_motion_prompt": "Camera Movement: Slow horizontal dolly pan left to right with smooth parallax. Subject Motion: @Hero_Name turns head slowly towards the light source, breathing gently. Environment Physics: Volumetric dust particles drifting in blue light rays, subtle steam rising. Sound Design: Low frequency hum of generator, distant water dripping, soft tactical footsteps. FPS & Motion: 24fps, fluid cinematic motion.",
      "dialogue": {{
        "speaker": "@Hero_Name",
        "line": "Die Energiequelle reagiert noch.",
        "language": "{language}"
      }},
      "audio_cues": "Dialogue: 'Die Energiequelle reagiert noch.' / Heavy atmospheric ambient",
      "director_notes": "Dynamischer Einstiegs-Hook (4s). Ruhige Dolly-Fahrt für sofortigen Spannungsaufbau."
    }}
  ]
}}"""

        final_user_content = f"Konzept:\n{concept}\n\nBisheriger Entwurf:\n{draft_res}\n\nCharakter-Info:\n{character_info}\n\nDialogsprache: {language}"

        yield f"data: {json.dumps({'event': 'log', 'message': '✨ Finalisiere Prompts, Transitions & Character Bible...'})}\n\n"

        messages = [
            {"role": "system", "content": final_system_prompt},
            {"role": "user", "content": final_user_content}
        ]

        raw_res = None
        for ev_type, ev_val in call_ai(messages, temperature=0.4, response_format={"type": "json_object"}):
            if ev_type in ('log', 'ping'):
                yield ev_val
            elif ev_type == 'result':
                raw_res = ev_val

        if not raw_res:
            yield f"data: {json.dumps({'event': 'error', 'message': 'Keine Antwort vom Modell erhalten.'})}\n\n"
            return

        try:
            clean_json = raw_res.strip()
            if "```json" in clean_json:
                clean_json = clean_json.split("```json")[1].split("```")[0].strip()
            elif "```" in clean_json:
                clean_json = clean_json.split("```")[1].split("```")[0].strip()

            if not clean_json.startswith('{'):
                first_brace = clean_json.find('{')
                last_brace = clean_json.rfind('}')
                if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
                    clean_json = clean_json[first_brace:last_brace+1].strip()

            parsed = json.loads(clean_json)
            if 'storyboard_meta' in parsed:
                meta = parsed['storyboard_meta']
                shots = parsed.get('shots', [])
                meta['master_contact_sheet_prompt'] = build_agency_master_prompt(meta, shots, ar_tag)
                
            yield f"data: {json.dumps({'event': 'final_storyboard', 'data': parsed, 'message': '4-Agenten Storyboard erfolgreich beendet!'})}\n\n"
        except Exception as e:
            print(f"[Storyboard Error] JSON Parsing failed: {e}")
            yield f"data: {json.dumps({'event': 'final_storyboard_raw', 'raw': raw_res, 'message': 'Raw Output empfangen.'})}\n\n"

    response = Response(event_stream(), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache, no-transform'
    response.headers['X-Accel-Buffering'] = 'no'
    response.headers['Connection'] = 'keep-alive'
    return response

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
        "einen sehr ausführlichen, hochauflösenden englischen Gesamt-Prompt (baseConcept) zu formulieren (der alle Details, Produkte, Stimmung, Atmosphäre, Hintergrund enthält), "
        "und die perfekten Dropdown-Parameter für Kamera, Optik, Licht, Komposition und Oberflächen-Physik auszuwählen. "
        "Antworte AUSSCHLIESSLICH in folgendem gültigen JSON-Format (keine Markdown-Codeblocks, kein Fließtext davor oder danach):\n"
        "{\n"
        "  \"hasPerson\": true oder false (true NUR wenn eine Person/Mensch/Charakter beschrieben wird, sonst false),\n"
        "  \"baseConcept\": \"Vollständige, extrem detaillierte englische Übersetzung und Ausformulierung der gesamten Nutzer-Idee.\",\n"
        "  \"reasoning\": \"Eine kurze, begeisternde Erklärung (2-3 Sätze auf Deutsch) für Anfänger, warum diese Kamera- und Lichtwerte gewählt wurden.\",\n"
        "  \"fields\": {\n"
        "    \"gender\": \"woman|man|non-binary person|android robot (NUR WENN hasPerson=true!)\",\n"
        "    \"ageGroup\": \"20 years old, young adult|30 years old (NUR WENN hasPerson=true!)\",\n"
        "    \"ethnicity\": \"East Asian|Scandinavian|American|Germanic (NUR WENN hasPerson=true!)\",\n"
        "    \"bodyType\": \"slender model physique|athletic toned body (NUR WENN hasPerson=true!)\",\n"
        "    \"hairColor\": \"blonde|brunette|black|ginger red (NUR WENN hasPerson=true!)\",\n"
        "    \"expression\": \"neutral cool expression|happy beaming smile (NUR WENN hasPerson=true!)\",\n"
        "    \"clothing\": \"black leather jacket|casual t-shirt and jeans (NUR WENN hasPerson=true!)\",\n"
        "    \"action\": \"Vollständige englische Beschreibung der Handlung/Pose (NUR WENN hasPerson=true!)\",\n"
        "    \"sceneType\": \"cinematic realism|cyberpunk sci-fi|high fantasy|dark horror atmosphere\",\n"
        "    \"location\": \"rainy Tokyo street|skyscraper office|pristine tropical beach|San Francisco cityscape\",\n"
        "    \"lighting\": \"dramatic cinematic lighting|soft natural window light|neon cyan and magenta lighting\",\n"
        "    \"lightingSetup\": \"3-point studio lighting setup, balanced key and fill|strong rim light, backlit silhouette, glowing edges|intense volumetric backlighting, glowing silhouette edges|warm flickering candlelight, deep orange ambient glow|chiaroscuro lighting, deep dramatic shadows, Caravaggio style|gobo light modifier, Venetian blind shadow patterns|neon split lighting, dual tone cyan and magenta glow|classic butterfly beauty lighting, flattering chin shadow\",\n"
        "    \"weather\": \"heavy rain|clear sunny sky|thick fog\",\n"
        "    \"focalLength\": \"14mm ultra-wide lens, dynamic perspective distortion|35mm prime lens, natural narrative perspective|50mm standard lens, true to life human vision|85mm portrait lens, flattering compression|200mm telephoto lens, background compression|2x anamorphic lens, oval bokeh, ultra-wide cinema ratio\",\n"
        "    \"apertureDoF\": \"f/1.2 aperture, razor-thin depth of field, sharp focus on subject|f/1.8 aperture, creamy blurred background bokeh|f/2.8 aperture, clean subject separation|f/8 aperture, deep focus, sharp background details\",\n"
        "    \"composition\": \"rule of thirds composition|centered symmetrical composition, Wes Anderson style|golden ratio spiral composition|dynamic leading lines pointing to subject|minimalist composition, vast negative space|frame within a frame composition\",\n"
        "    \"colorGrading\": \"Teal and Orange color grading, Hollywood blockbuster palette|soft pastel color palette, gentle muted tones|monochromatic black and white with vibrant color accent|muted organic earth tones, natural film palette|saturated neon RGB color grading, high contrast\",\n"
        "    \"vfxParticles\": \"floating embers, glowing sparks, atmospheric heat|floating dust motes in light rays, atmospheric particles|glowing bioluminescent spores, magical particles|refractive heat shimmer, mirage distortion, atmospheric heat haze|cinematic lens flare, anamorphic blue glare|swirling backlit snowflakes, icy air motes|slight chromatic aberration, optical prism fringing, lens distortion|dense volumetric fog, atmospheric haze, smoke drift\",\n"
        "    \"surfaceCondition\": \"rain-slicked wet surface, glossy water reflections|glistening morning dew droplets, wet surface sheen|glistening skin sheen, subtle sweat droplets|splattered mud droplets, gritty surface texture|frost crystals, frozen texture, icy sheen|mirror-like water puddle reflections, wet asphalt|water droplets on camera lens, optical distortion\",\n"
        "    \"detailLevel\": \"8k raw photo, extreme detail, no smoothing, uncompressed|16k uncompressed raw photo, hyper-detailed texture map|microscopic detail level, extreme texture precision\",\n"
        "    \"skinPhysics\": \"subsurface scattering, translucent skin, realistic epidermis|subsurface skin scattering, natural epidermal sheen, realistic pores|sweaty glossy skin texture, intense specular highlights|porcelain skin|matte velvet skin finish, soft touch texture|natural freckles, realistic skin pigmentation, beauty marks\",\n"
        "    \"microDetails\": \"visible pores, vellus hair, natural skin texture imperfections|vellus peach fuzz hair, micro skin pores, natural imperfections|natural expression lines, subtle crow's feet, micro wrinkles|microscopic iris filaments, vibrant eye catchlight reflections\",\n"
        "    \"sensorPhysics\": \"medium format CCD sensor crispness, ultra dynamic range|cctv footage, phone camera noise, raw sensor data|zero denoising, grainy texture, authentic iso noise|authentic 35mm film grain, analog texture|heavy 16mm vintage film grain, retro cinema noise|heavy film grain\",\n"
        "    \"opticsLogic\": \"24mm lens, f/8 aperture, deep depth of field, everything in focus|85mm lens, f/1.8 aperture, creamy bokeh background|Petzval vintage lens, swirling background bokeh|tilt-shift lens effect, miniature model depth of field|split-diopter shot, dual focus foreground and background|softar diffusion filter, creamy skin glow|macro lens, shallow depth of field\",\n"
        "    \"lightingLogic\": \"direct neutral white flash, harsh shadows, amateur photography|fashion ringlight illumination, halo eye catchlights|hard direct on-camera flash, stark shadows, 90s party snap|soft diffused strobe flash, gentle wrap-around light|no studio lighting, ambient light only|professional studio lighting setup\",\n"
        "    \"colorFidelity\": \"raw color tones, flat profile, low contrast, desaturated|warm Kodak Gold analog film tones, golden highlights|vibrant Fujifilm Velvia saturated landscape colors|gritty bleach bypass color grading, desaturated high contrast|vibrant Technicolor 3-strip vintage color palette|vivid colors, high saturation, instagram filter|black and white, monochrome\",\n"
        "    \"filmStock\": \"Kodak Portra 400 film grain|Cinestill 800T halation|Fujifilm Velvia 50|digital crisp 8k\"\n"
        "  }\n"
        "}\n"
        "SEHR WICHTIG: Wenn KEINE Person im Prompt beschrieben wird, setze 'hasPerson' auf false und LASS GENDER, CLOTHING, AGEGROUP, ETHNICITY, EXPRESSION, HAIRCOLOR UND ACTION VOLLSTÄNDIG WEG!"
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
                "sceneType": "cinematic realism"
            }
        })

@app.route('/api/analyze-image', methods=['POST'])
def analyze_image():
    """Vision-Endpoint: Gemini 3.5 Flash Lite analysiert ein hochgeladenes Bild optisch für I2V."""
    data = request.json
    image_base64 = data.get('image', '')
    user_hint = data.get('hint', '')
    lm_url = data.get('lm_url', 'http://127.0.0.1:1234/v1')
    
    if not image_base64:
        return jsonify({"error": "Kein Bild übergeben"}), 400

    print("[Vision Engine] Analyzing uploaded image with Gemini 3.5 Flash Lite Vision...")
    
    sys_prompt = (
        "Du bist ein optischer Vision-KI-Experte und Prompt-Engineer für Image-to-Video (I2V) Systeme (Veo 3.1, Runway Gen-3, Luma, Kling AI).\n"
        "DEINE AUFGABE:\n"
        "Betrachte das übergebene Bild genau und analysiere es vollständig. Fülle die Formularfelder für die UI auf DEUTSCH aus UND erstelle den perfekten englischen ANIMATION & CAMERA PROMPT, um genau dieses vorliegende Bild flüssig in Bewegung zu versetzen.\n\n"
        "I2V VISION-REGELN:\n"
        "1. KENNZEICHNE DAS HAUPTMOTIV: Identifiziere das Hauptmotiv im Bild (z.B. ein Fahrzeug, eine Person, eine Shampooflasche, ein Gebäude, ein Drache, ein Gericht).\n"
        "2. NIEMALS DAS AUSSEHEN NEU BESCHREIBEN: Beschreibe NICHT, welche Farbe, Kleidung oder Form das Motiv hat (das Bild zeigt es bereits!).\n"
        "3. FOKUS AUF BEWEGUNG & KAMERA: Beschreibe exakt, welche Kamerabewegung stattfindet und wie sich das Hauptmotiv und die Umwelt ab Sekunde 0 bewegen.\n"
        "4. PASSENDE PHYSIK & SOUND: Füge Partikel, Lichtwechsel, Motion Blur und ein authentisches Sound-Design hinzu.\n\n"
        "FORMAT (Erstelle AUSSCHLIESSLICH dieses JSON):\n"
        "{\n"
        "  \"identified_subject\": \"Kurze deutsche Bezeichnung des erkannten Motivs im Bild (z.B. 'Historische Schiffsszene bei Sturm')\",\n"
        "  \"fields\": {\n"
        "    \"subject\": \"Hauptmotiv AUF DEUTSCH (z.B. 'Das Pärchen im Mittelpunkt / Das Piratenschiff')\",\n"
        "    \"action\": \"Dynamische Bewegung/Animation aus dem Bild AUF DEUTSCH (z.B. 'Schaut langsam zur Kamera und lächelt')\",\n"
        "    \"fx\": \"Umwelt-Physik, Partikel & Gischt AUF DEUTSCH (z.B. 'Aufspritzende Regentropfen und Funkenflug')\",\n"
        "    \"setting\": \"Beleuchtung & Atmosphäre aus dem Bild AUF DEUTSCH (z.B. 'Dramatisches warmes Sonnenuntergangslicht mit Nebel')\",\n"
        "    \"camera\": \"Kamerabewegung AUF DEUTSCH (z.B. 'Langsames Heranzoomend und sanfte Kreisbewegung')\",\n"
        "    \"sound\": \"Authentisches Sound Design AUF DEUTSCH (z.B. 'Donnerrollen, Meeresrauschen und leiser Wind')\"\n"
        "  },\n"
        "  \"camera_movement\": \"Beschreibung der Kamerabewegung auf Englisch\",\n"
        "  \"subject_motion\": \"Beschreibung der Bewegung des neutralen Hauptmotivs auf Englisch\",\n"
        "  \"environment_physics\": \"Partikel, Licht, Wetter & Physik auf Englisch\",\n"
        "  \"sound_design\": \"Passendes Sound Design auf Englisch\",\n"
        "  \"final_i2v_prompt\": \"Camera movement: [Kamera]. Subject motion: [Bewegung]. Environment physics and particles: [Physik]. Sound design: [Sound].\"\n"
        "}"
    )

    # Format message with vision image payload for OpenAI client (Gemini format)
    content_list = []
    if user_hint:
        content_list.append({"type": "text", "text": f"Zusätzlicher Wunsch des Nutzers für die Animation: {user_hint}"})
    content_list.append({
        "type": "image_url",
        "image_url": {
            "url": image_base64 if image_base64.startswith("data:") else f"data:image/jpeg;base64,{image_base64}"
        }
    })

    messages = [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": content_list}
    ]

    res_text = get_ai_response(messages, model='gemini-3.5-flash-lite', temperature=0.3, lm_studio_base=lm_url)

    if not res_text:
        return jsonify({"error": "Leere Antwort der KI-Vision Engine."}), 500

    try:
        clean_json = res_text.strip()
        if "```json" in clean_json:
            clean_json = clean_json.split("```json")[1].split("```")[0].strip()
        elif "```" in clean_json:
            clean_json = clean_json.split("```")[1].split("```")[0].strip()

        parsed = json.loads(clean_json)
        return jsonify(parsed)
    except Exception as e:
        print(f"[Vision Error] JSON Parse Error: {e}\nRaw: {res_text}")
        return jsonify({
            "identified_subject": "Hochgeladenes Startbild",
            "final_i2v_prompt": res_text
        })

@app.route('/api/analyze-cine-image', methods=['POST'])
def analyze_cine_image():
    """Vision/JSON-Endpoint für Cinema Edit: Gemini 3.5 Flash Lite liest Bild oder JSON und stellt das Virtual Rig ein."""
    data = request.json
    image_base64 = data.get('image', '')
    json_input = data.get('json_data', None)
    lm_url = data.get('lm_url', 'http://127.0.0.1:1234/v1')

    print("[Cinema Vision Engine] Analyzing reference image/JSON with Gemini 3.5 Flash Lite Vision...")

    sys_prompt = (
        "Du bist ein professioneller Director of Photography (DoP) und Vision-KI-Experte.\n"
        "DEINE AUFGABE:\n"
        "Analysiere das übergebene Bild (oder die Prompt-JSON) und schätze die exakten Kamera-, Linsen-, Licht- und Kompositions-Einstellungen ab. "
        "Fülle auch die Motiv-Beschreibung (scene_description) vollständig AUF DEUTSCH aus, damit sie direkt in das Eingabefeld übernommen werden kann.\n\n"
        "VERFÜGBARE WERTE FÜR RIG:\n"
        "- camera: 'alexa35' (ARRI Alexa 35), 'red_vaptor' (RED V-Raptor), 'panavision' (Panavision DXL2), 'venice' (Sony Venice), 'imax' (IMAX 70mm), 'vhs' (VHS Analog)\n"
        "- lens: 'arri_sig' (ARRI Signature), 'cooke' (Cooke S4), 'canon_k35' (Canon K35), 'pana_c' (Anamorphic C-Series)\n"
        "- focal: '14mm', '24mm', '35mm', '50mm', '85mm'\n"
        "- aperture: 'f1.4', 'f2.8', 'f8'\n\n"
        "FORMAT (Erstelle AUSSCHLIESSLICH dieses JSON):\n"
        "{\n"
        "  \"identified_concept\": \"Kurzer deutscher Titel des erkannten Bildkonzepts\",\n"
        "  \"scene_description\": \"Ausführliche DEUTSCHE Beschreibung des Motivs, der Personen und der Szene für das Formular-Eingabefeld\",\n"
        "  \"rig\": {\n"
        "    \"camera\": \"alexa35|red_vaptor|panavision|venice|imax|vhs\",\n"
        "    \"lens\": \"arri_sig|cooke|canon_k35|pana_c\",\n"
        "    \"focal\": \"14mm|24mm|35mm|50mm|85mm\",\n"
        "    \"aperture\": \"f1.4|f2.8|f8\"\n"
        "  }\n"
        "}"
    )

    if json_input:
        content_list = f"Hier ist die hochgeladene/übergebene JSON-Datei des Nutzers:\n{json.dumps(json_input, indent=2)}"
    elif image_base64:
        content_list = [
            {"type": "text", "text": "Analysiere dieses Referenzbild optisch und wähle das perfekte Kamera-Rig sowie die Motivbeschreibung."},
            {
                "type": "image_url",
                "image_url": {
                    "url": image_base64 if image_base64.startswith("data:") else f"data:image/jpeg;base64,{image_base64}"
                }
            }
        ]
    else:
        return jsonify({"error": "Weder Bild noch JSON übergeben"}), 400

    messages = [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": content_list}
    ]

    res_text = get_ai_response(messages, model='gemini-3.5-flash-lite', temperature=0.3, lm_studio_base=lm_url)

    if not res_text:
        return jsonify({"error": "Leere Antwort von Gemini 3.5 Flash Lite."}), 500

    try:
        clean_json = res_text.strip()
        if "```json" in clean_json:
            clean_json = clean_json.split("```json")[1].split("```")[0].strip()
        elif "```" in clean_json:
            clean_json = clean_json.split("```")[1].split("```")[0].strip()

        parsed = json.loads(clean_json)
        return jsonify(parsed)
    except Exception as e:
        print(f"[Cinema Vision Error] JSON Parse Error: {e}\nRaw: {res_text}")
        return jsonify({"error": "Konnte Antwort nicht als JSON parsen", "raw": res_text}), 500

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
        
        # 3. Review Board (Parallel)
        yield f"data: {json.dumps({'event': 'log', 'message': f'⚡ Review Board analysiert den Entwurf simultan ({len(experts)-1} Experten)...'})}\n\n"
        
        def run_prompt_expert(role_name):
            rev_sys = f"Du bist ein {role_name} in einem Review-Board für AI Prompts."
            rev_user = f"Bisheriger Entwurf (JSON):\n{draft}\n\nFinde aus deiner speziellen Fachrichtung genau 2 konkrete Verbesserungen, die in den Text-Prompts oder Einstellungen noch fehlen oder schwammig sind. Liefere NUR kritisches Feedback in Stichpunkten, keine Floskeln."
            res = get_ai_response([{"role": "system", "content": rev_sys}, {"role": "user", "content": rev_user}], model=model, temperature=0.7, lm_studio_base=lm_url)
            return role_name, res

        reviews = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(experts)-1) as executor:
            future_to_role = {executor.submit(run_prompt_expert, role): role for role in experts[1:]}
            for future in concurrent.futures.as_completed(future_to_role):
                role = future_to_role[future]
                try:
                    _, rev = future.result()
                    if rev:
                        reviews.append(f"### Gutachten vom {role}:\n{rev}\n")
                        yield f"data: {json.dumps({'event': 'review', 'role': role, 'content': rev, 'message': f'Feedback von {role} erhalten.'})}\n\n"
                    else:
                        yield f"data: {json.dumps({'event': 'log', 'message': f'   ⚠️ {role} hat Entwurf bestätigt.'})}\n\n"
                except Exception as ex:
                    yield f"data: {json.dumps({'event': 'log', 'message': f'   ⚠️ {role} übersprungen: {ex}'})}\n\n"
                
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
        
    response = Response(event_stream(), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache, no-transform'
    response.headers['X-Accel-Buffering'] = 'no'
    response.headers['Connection'] = 'keep-alive'
    return response

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
