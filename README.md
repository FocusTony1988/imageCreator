# ImageCreator: Agentic AI Prompt Studio 🚀

Welcome to **ImageCreator** (formerly known as Nano Banana Ultimate), a highly advanced, professional-grade interface for crafting perfect prompts for diffusion models like Stable Diffusion, Midjourney, and more. 

This project goes beyond simple text-to-image translation. It introduces an **Agentic AI Workflow** powered by Google Gemini, acting as a virtual art department to meticulously analyze, discuss, and refine your visual concepts before they are ever sent to an image generator.

---

## 🌟 Key Features

### 🤖 Multi-Agent Auto-Bot System
At the heart of ImageCreator is the **Auto-Bot System**, a streaming Server-Sent Events (SSE) pipeline that optimizes your raw ideas based on your selected intervention level:
* **Level 1 (Raw / Purist):** Quick translation and focused stylistic enhancements. Keeps your original prompt authentic and raw.
* **Level 2 (Balanced):** Structural optimization that introduces logical lighting and camera specifications without overpowering the core idea.
* **Level 3 (Overdrive - 4 Agent Board):** A full simulation of a virtual art department. The Lead Director drafts the initial prompt, which is then rigorously reviewed by a Lighting Specialist, Camera Operator, and Art Director. The final prompt is a polished, highly detailed masterpiece.

### 🎛️ Specialized Workflows
The studio provides dedicated interfaces for various creative needs:
* **Main Generation:** The core studio for building scenes from scratch with precise control over subjects, environments, lighting, and camera physics.
* **Edit Mode (Img2Img):** Specialized UI for modifying existing images, including denoising strength, physics integration, and prompt alignment.
* **Cinematic Studio:** Dedicated tools for film emulation, offering controls for shot size, camera angles, depth of field, and specific film stocks (e.g., Kodak Portra, CineStill).
* **Veo Video Mode:** Optimization pipeline for generating prompts tailored to AI video generation models like Google Veo.

### 💧 AI Watermark Removal Engine
A powerful backend utility that leverages Gemini's vision capabilities to detect the precise coordinates of watermarks, text, or visual artifacts in an image, and automatically removes them using OpenCV-based intelligent inpainting algorithms.

### 📦 ComfyUI / API Ready
Every generation results in a structured JSON payload containing workflow metadata, positive/negative prompts, generation parameters (steps, CFG scale, aspect ratio), and advanced node hints (LoRAs, ControlNet). This makes it instantly plug-and-play with ComfyUI pipelines and automated systems.

---

## 🛠️ Technology Stack

* **Frontend:** Pure, highly optimized Vanilla JavaScript and CSS. Features dynamic DOM manipulation, real-time SSE streaming logs, and glassmorphism UI aesthetics.
* **Backend:** Python (Flask) with asynchronous streaming endpoints.
* **AI Engine:** Google Gemini API (supporting `gemini-1.5-flash`, `gemini-1.5-pro`, and lightweight models) integrated for agentic reasoning and vision tasks.
* **Image Processing:** OpenCV (`cv2`) and NumPy for algorithmic image manipulation.

---

## 🚀 Getting Started

### Prerequisites
* Python 3.9+
* A valid Google Gemini API Key

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/FocusTony1988/imageCreator.git
   cd imageCreator
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment:**
   Create a `.env` file in the root directory and add your Gemini API Key:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

4. **Run the server:**
   ```bash
   python app.py
   ```
   *Alternatively, use `gunicorn app:app` for production environments.*

5. **Access the Studio:**
   Open your browser and navigate to `http://localhost:5080`.

---

## 💡 Usage Example: The Level 3 Overdrive
1. Enter a simple raw prompt like: *"A red dragon flying"*
2. Select **Stufe 3 (Overdrive)** in the AI settings.
3. Click **KI Prompt Generieren**.
4. Watch the live console as the *Lead Director* drafts the scene, the *Lighting Specialist* adds volumetric god rays, and the *Camera Operator* adjusts the lens to an 85mm f/1.8 setup.
5. Copy the finalized, robust JSON payload into your diffusion model.

---

*Built with passion for the future of AI-assisted artistry.*
