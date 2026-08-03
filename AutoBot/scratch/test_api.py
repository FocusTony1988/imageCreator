import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
api_key = os.environ.get("GEMINI_API_KEY")
base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"

client = OpenAI(
    api_key=api_key,
    base_url=base_url
)

models = ["gemini-3.5-flash", "gemini-2.5-flash"]

for model in models:
    try:
        print(f"Testing model: {model}...")
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": "Say hello in one word."}
            ],
            temperature=0.7
        )
        print(f"Success for {model}!")
        print(f"Response: {response.choices[0].message.content.strip()}\n")
    except Exception as e:
        print(f"Error for {model}: {e}\n")
