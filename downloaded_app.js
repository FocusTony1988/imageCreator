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
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    print("WARNUNG: GEMINI_API_KEY wurde nicht als Umgebungsvariable gefunden.")

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/"
PACING_DELAY = int(os.environ.get("PACING_DELAY", "3"))

gemini_client = OpenAI(api_key=GEMINI_API_KEY, base_url=GEMINI_BASE)

def get_lm_studio_model(lm_studio_base):
    import urllib.request
    import json
    try:
        url = lm_studio_base.rstrip("/") + "/models"
        with urllib.request.urlopen(url, timeout=2) as response:
            data = json.loads(response.read().decode())
        
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

        yield f"data: {json.dumps({'event': 'log', 'message': '🧠 Rufe Expertengremium zusammen...'})}\n\n"
        prompt_exp = (
            f"Kontext: Das ist ein Prompt für eine Bild-KI.\n"
            "Nenne exakt 4 Berufsbezeichnungen (Komma-getrennt), die diesen Prompt perfekt aus verschiedenen Blickwinkeln (z.B. Beleuchtung, Komposition, Kamera, Regie) analysieren und verbessern können. "
            "Antworte AUSSCHLIESSLICH mit den Bezeichnungen auf Englisch (z.B. Lead Director, Lighting Specialist), keine Einleitung, keine Sätze."
        )
        
        exp_response = None
        for ev_type, ev_val in call_ai([{"role": "user", "content": prompt_exp}], temperature=0.3):
            if ev_type == 'log': yield ev_val
            elif ev_type == 'result': exp_response = ev_val
        
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
        
        if PACING_DELAY > 0 and model != 'lm-studio':
            yield f"data: {json.dumps({'event': 'log', 'message': f'⏳ Pause von {PACING_DELAY}s zur Ratenbegrenzungs-Schonung...'})}\n\n"
            time.sleep(PACING_DELAY)
            
        yield f"data: {json.dumps({'event': 'log', 'message': f'📝 {experts[0]} entwirft das erste Konzept...'})}\n\n"
        draft_sys = f"Du bist der {experts[0]}. Erstelle basierend auf dem Kontext einen ersten Rohentwurf des fertigen JSON Outputs."
        
        draft = None
        for ev_type, ev_val in call_ai([{"role": "system", "content": draft_sys}, {"role": "user", "content": f"Kontext:\n{context}"}], temperature=0.6):
            if ev_type == 'log': yield ev_val
            elif ev_type == 'result': draft = ev_val
                
        if not draft:
            draft = "Fehler beim Erstellen des ersten Entwurfs."
            
        yield f"data: {json.dumps({'event': 'draft', 'content': draft, 'message': 'Entwurf erfolgreich erstellt.'})}\n\n"
        
        if PACING_DELAY > 0 and model != 'lm-studio':
            yield f"data: {json.dumps({'event': 'log', 'message': f'⏳ Pause von {PACING_DELAY}s zur Ratenbegrenzungs-Schonung...'})}\n\n"
            time.sleep(PACING_DELAY)
            
        yield f"data: {json.dumps({'event': 'log', 'message': f'🕵️ Review Board startet ({len(experts)-1} Reviews)...'})}\n\n"
        reviews = []
        for i, role in enumerate(experts[1:], 1):
            if i > 1 and PACING_DELAY > 0 and model != 'lm-studio':
                yield f"data: {json.dumps({'event': 'log', 'message': f'⏳ Pause von {PACING_DELAY}s zur Ratenbegrenzungs-Schonung...'})}\n\n"
                time.sleep(PACING_DELAY)
                
            yield f"data: {json.dumps({'event': 'log', 'message': f'   - Analysiere mit Experte: {role}...'})}\n\n"
            rev_sys = f"Du bist ein {role} in einem Review-Board für AI Prompts."
            rev_user = f"Bisheriger Entwurf (JSON):\n{draft}\n\nFinde aus deiner speziellen Fachrichtung genau 2 konkrete Verbesserungen, die in den Text-Prompts oder Einstellungen noch fehlen oder schwammig sind. Liefere NUR kritisches Feedback in Stichpunkten, keine Floskeln."
            
            rev = None
            for ev_type, ev_val in call_ai([{"role": "system", "content": rev_sys}, {"role": "user", "content": rev_user}], temperature=0.7):
                if ev_type == 'log': yield ev_val
                elif ev_type == 'result': rev = ev_val
            
            if rev:
                reviews.append(f"### Gutachten vom {role}:\n{rev}\n")
                yield f"data: {json.dumps({'event': 'review', 'role': role, 'content': rev, 'message': f'Feedback von {role} erhalten.'})}\n\n"
            else:
                yield f"data: {json.dumps({'event': 'log', 'message': f'   ⚠️ Fehler beim Feedback von {role}.'})}\n\n"
                
        if PACING_DELAY > 0 and model != 'lm-studio':
            yield f"data: {json.dumps({'event': 'log', 'message': f'⏳ Pause von {PACING_DELAY}s zur Ratenbegrenzungs-Schonung...'})}\n\n"
            time.sleep(PACING_DELAY)
            
        yield f"data: {json.dumps({'event': 'log', 'message': f'🏗️ {experts[0]} fusioniert Feedback in das Konzept...'})}\n\n"
        reviews_str = "\n".join(reviews)
        merge_sys = f"Du bist der {experts[0]}. Fusioniere das Feedback deiner Kollegen in den finalen JSON Output."
        merge_user = f"Ursprüngliche Regeln:\n{sys_prompt}\n\nRohentwurf:\n{draft}\n\nFeedback der Kollegen:\n{reviews_str}\n\nSchreibe den JSON Entwurf neu und integriere die Verbesserungen der Experten in die Prompts. Liefere AUSSCHLIESSLICH das finale JSON Objekt zurück (ohne Markdown Code Blocks)."
        
        final_concept = None
        for ev_type, ev_val in call_ai([{"role": "system", "content": merge_sys}, {"role": "user", "content": merge_user}], temperature=0.4):
            if ev_type == 'log': yield ev_val
            elif ev_type == 'result': final_concept = ev_val
                
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
        fd, temp_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        file.save(temp_path)

        img = image_io.imread(temp_path)
        if img is None:
            return jsonify({"error": "Could not read image"}), 400
        
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
        
        if remove_synthid:
            remove_ai_metadata(Path(out_path), Path(out_path))

        return send_file(out_path, mimetype='image/png')
            
    except Exception as e:
        print(f"Error processing watermark: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5080))
    print(f"Auto-Bot Server gestartet auf Port {port}")
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_ENV") == "development")
