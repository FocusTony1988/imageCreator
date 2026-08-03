import os
import json
import time
import re
import markdown
from flask import Flask, request, jsonify, send_file, Response
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# --- CONFIGURATION ---
# Google Gemini API key configuration
API_KEY = os.environ.get("GEMINI_API_KEY")
API_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/"

# Initialize OpenAI client pointed to the Gemini API compatibility endpoint
client = OpenAI(api_key=API_KEY, base_url=API_BASE)

def get_ai_response_stream(messages, model, temperature=0.7):
    """Core generator that calls the Gemini API and handles rate limits (429) with retry."""
    max_retries = 6
    base_delay = 5
    
    for attempt in range(max_retries):
        try:
            res = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature
            )
            yield ('result', res.choices[0].message.content)
            return
        except Exception as e:
            err_msg = str(e)
            # Check for Rate Limit / Quota Exceeded error
            if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "quota" in err_msg.lower():
                # Try to parse recommended sleep duration (e.g., "Please retry in 40.9s")
                match = re.search(r"retry in (\d+\.?\d*)s", err_msg)
                delay = int(float(match.group(1))) + 1 if match else base_delay * (2 ** attempt)
                yield ('log', f"⚠️ Gemini API Rate-Limit (429). Warte {delay}s... (Versuch {attempt + 1}/{max_retries})")
                time.sleep(delay)
            else:
                yield ('error', f"API-Fehler ({model}): {e}")
                return
    yield ('error', "Maximale Anzahl an API-Versuchen überschritten.")

def get_ai_response(messages, model, temperature=0.7):
    """Blocking helper function to make API calls to Google Gemini with automatic retry."""
    result = None
    for event_type, val in get_ai_response_stream(messages, model, temperature):
        if event_type == 'result':
            result = val
        elif event_type == 'error':
            print(f"[API ERROR] {val}")
    return result

# --- FRONTEND ROUTES ---

@app.route('/')
def index():
    """Serves the HTML user interface."""
    print("[AutoBot] Webpage opened by a user.")
    return send_file('index.html')

@app.route('/api/optimize', methods=['POST'])
def optimize_goal():
    data = request.json
    raw_goal = data.get('goal', '')
    model = data.get('model', 'gemini-3.5-flash')
    print(f"[Step 1] Optimizing raw goal with {model}...")
    
    prompt = (
        f"Der Nutzer hat folgendes rohes Ziel formuliert: '{raw_goal}'.\n"
        "Du bist ein Prompt-Engineer. Optimiere diese Aufgabenstellung so, "
        "dass ein nachfolgendes KI-Agentensystem sie perfekt, klar und eindeutig versteht. "
        "Formuliere es professionell, präzise und mach versteckte Annahmen explizit. "
        "Gib NUR die optimierte Version zurück, ohne Erklärungen."
    )
    
    optimized = get_ai_response([{"role": "user", "content": prompt}], model=model, temperature=0.5)
    print("[Step 1] Goal successfully optimized.")
    return jsonify({"optimized_goal": optimized if optimized else raw_goal})

@app.route('/api/interrogate', methods=['POST'])
def interrogate():
    data = request.json
    goal = data.get('goal', '')
    model = data.get('model', 'gemini-3.5-flash')
    print(f"[Step 2] Formulating questions with {model}...")
    
    prompt = (
        f"Der Nutzer hat folgendes Ziel: '{goal}'.\n"
        "Du bist ein Senior-Anforderungsanalyst. Um dieses Ziel perfekt zu erreichen, fehlen uns Details.\n"
        "Generiere exakt 3-5 kurze, präzise Rückfragen.\n"
        "Gib NUR die Fragen als nummerierte Liste aus, kein Vorgeplänkel."
    )
    
    questions = get_ai_response([{"role": "user", "content": prompt}], model=model, temperature=0.7)
    print("[Step 2] Questions successfully generated.")
    return jsonify({"questions": questions})

@app.route('/api/generate', methods=['POST'])
def generate_solution():
    data = request.json
    goal = data.get('goal', '')
    answers = data.get('answers', '')
    model = data.get('model', 'gemini-3.5-flash')
    
    print(f"[Step 3] Starting Agentic Workflow with {model}...")
    
    def event_stream():
        context = f"Ursprüngliches Ziel: {goal}\nZusatzinfos vom Nutzer: {answers}"
        
        # Helper to execute AI calls and stream logs if retries occur
        def call_ai(messages, temperature=0.7):
            for event_type, val in get_ai_response_stream(messages, model, temperature):
                if event_type == 'log':
                    yield ('log', f"data: {json.dumps({'event': 'log', 'message': val})}\n\n")
                elif event_type == 'result':
                    yield ('result', val)
                elif event_type == 'error':
                    yield ('log', f"data: {json.dumps({'event': 'log', 'message': f'🔴 {val}'})}\n\n")

        # 1. Expert Assembly
        yield f"data: {json.dumps({'event': 'log', 'message': '🧠 Rufe Expertengremium zusammen...'})}\n\n"
        prompt_exp = (
            f"Kontext: {context}\n\n"
            "Nenne exakt 4 Berufsbezeichnungen (Komma-getrennt), die dieses Problem gemeinsam perfekt lösen. "
            "Antworte AUSSCHLIESSLICH mit den Bezeichnungen, keine Einleitung, keine Sätze."
        )
        
        exp_response = None
        for ev_type, ev_val in call_ai([{"role": "user", "content": prompt_exp}], temperature=0.3):
            if ev_type == 'log':
                yield ev_val
            elif ev_type == 'result':
                exp_response = ev_val
        
        if not exp_response:
            exp_response = "Lead Analyst, Strategischer Berater, Kritischer Gutachter, Software Engineer"
            
        if isinstance(exp_response, str):
            raw_list = [e.strip() for e in exp_response.split(",")]
            experts = [e for e in raw_list if len(e) < 30][:4]
            if not experts:
                experts = ["Lead Analyst", "Strategischer Berater", "Kritischer Gutachter", "Software Engineer"]
        else:
            experts = ["Lead Analyst", "Strategischer Berater", "Kritischer Gutachter", "Software Engineer"]
            
        experts_str = ", ".join(experts)
        yield f"data: {json.dumps({'event': 'experts', 'experts': experts, 'message': f'Gewählte Experten: {experts_str}'})}\n\n"
        
        # 2. Lead Architect Draft
        yield f"data: {json.dumps({'event': 'log', 'message': '📝 Lead Architect entwirft das erste Lösungskonzept...'})}\n\n"
        draft_sys = "Du bist der Lead Architect. Erstelle einen ersten, umfassenden Lösungsentwurf."
        
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
        yield f"data: {json.dumps({'event': 'log', 'message': f'🕵️ Review Board startet ({len(experts)} Reviews)...'})}\n\n"
        reviews = []
        for role in experts:
            yield f"data: {json.dumps({'event': 'log', 'message': f'   - Analysiere mit Experte: {role}...'})}\n\n"
            rev_sys = f"Du bist ein {role} in einem Review-Board."
            rev_user = f"Entwurf:\n{draft}\n\nFinde die 2-3 größten Schwachstellen aus deiner Sicht. Liefere NUR kritisches Feedback in Stichpunkten."
            
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
        yield f"data: {json.dumps({'event': 'log', 'message': '🏗️ Lead Architect fusioniert Feedback in das Konzept...'})}\n\n"
        reviews_str = "\n".join(reviews)
        merge_sys = "Du bist der Lead Architect. Fusioniere Feedback in das Konzept."
        merge_user = f"Entwurf:\n{draft}\n\nFeedback:\n{reviews_str}\n\nSchreibe den Entwurf neu, integriere das Feedback. Liefere das finale Konzept."
        
        final_concept = None
        for ev_type, ev_val in call_ai([{"role": "system", "content": merge_sys}, {"role": "user", "content": merge_user}], temperature=0.4):
            if ev_type == 'log':
                yield ev_val
            elif ev_type == 'result':
                final_concept = ev_val
                
        if not final_concept:
            final_concept = draft
            
        # 5. Final Synthesis
        yield f"data: {json.dumps({'event': 'log', 'message': '🧐 Final Synthesis (Dokument wird formatiert)...'})}\n\n"
        synth_prompt = f"Hier ist das Arbeitsergebnis: {final_concept}\n\nStrukturiere dies in eine perfekte, professionelle Markdown-Form."
        
        final_md = None
        for ev_type, ev_val in call_ai([{"role": "user", "content": synth_prompt}], temperature=0.3):
            if ev_type == 'log':
                yield ev_val
            elif ev_type == 'result':
                final_md = ev_val
                
        if not final_md:
            final_md = final_concept
            
        html_body = markdown.markdown(final_md, extensions=['tables', 'fenced_code'])
        
        yield f"data: {json.dumps({'event': 'final', 'html': html_body, 'markdown': final_md, 'message': 'Workflow erfolgreich beendet!'})}\n\n"
        
    return Response(event_stream(), mimetype='text/event-stream')

if __name__ == "__main__":
    print("Auto-Bot Server gestartet auf http://127.0.0.1:5000")
    app.run(debug=True, port=5000)