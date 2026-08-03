import os
import sys
# Add current working directory to path to find app.py
sys.path.append(os.getcwd())

import json
from app import app

# Create a test client for Flask
client = app.test_client()

print("1. Testing '/' endpoint (index.html delivery)...")
response = client.get('/')
assert response.status_code == 200, f"Failed: status {response.status_code}"
print("   Success!")

print("\n2. Testing '/api/optimize' with Gemini 3.5 Flash...")
test_goal = "Ich möchte einen Onlineshop für handgefertigte Kaffeetassen aufbauen."
response = client.post('/api/optimize', json={
    'goal': test_goal,
    'model': 'gemini-3.5-flash'
})
assert response.status_code == 200, f"Failed: status {response.status_code}"
data = response.get_json()
print("   Response:", data)
assert 'optimized_goal' in data, "No optimized goal in response!"
print("   Success!")

print("\n3. Testing '/api/interrogate' with Gemini 2.5 Flash...")
response = client.post('/api/interrogate', json={
    'goal': data['optimized_goal'],
    'model': 'gemini-2.5-flash'
})
assert response.status_code == 200, f"Failed: status {response.status_code}"
data_q = response.get_json()
print("   Response:", data_q)
assert 'questions' in data_q, "No questions in response!"
print("   Success!")

print("\n4. Testing streaming '/api/generate' with Gemini 3.5 Flash...")
response = client.post('/api/generate', json={
    'goal': data['optimized_goal'],
    'answers': "1. Budget ist 500€.\n2. Zielgruppe sind Kaffeeliebhaber.\n3. Fokus liegt auf Instagram Marketing.",
    'model': 'gemini-3.5-flash'
})
assert response.status_code == 200, f"Failed: status {response.status_code}"
assert response.mimetype == 'text/event-stream', f"Invalid mimetype: {response.mimetype}"

print("   Reading stream chunks...")
for line in response.iter_encoded():
    decoded = line.decode('utf-8').strip()
    if decoded.startswith('data: '):
        try:
            event_data = json.loads(decoded[6:])
            print(f"   [SSE Event] {event_data.get('event')}: {event_data.get('message', '')}")
            if event_data.get('event') == 'final':
                print("\n🎉 All test steps completed successfully!")
                break
        except Exception as e:
            # Sometime SSE returns chunked lines that aren't fully complete if it is cut off in test client buffer
            pass
