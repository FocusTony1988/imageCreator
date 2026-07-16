
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
                const negative = negMatch ? negMatch[1].trim() : "deformed, bad anatomy, disfigured, poorly drawn face, mutated, extra limbs, low quality, blurry";
                return {
                    "workflow_meta": {
                        "intent": "Parsed from text format",
                        "style_category": "Cinematic"
                    },
                    "prompts": {
                        "positive_prompt": positive,
                        "negative_prompt": negative
                    },
                    "generation_parameters": {
                        "aspect_ratio": "16:9",
                        "suggested_width": 1024,
                        "suggested_height": 1024,
                        "cfg_scale": 7.0,
                        "steps": 30,
                        "sampler_name": "DPM++ 2M Karras"
                    }
                };
            }
            
            throw new Error("Keine JSON-Struktur oder valides Textformat gefunden");
        } catch (e) {
            console.error("JSON Parsing Error:", e, str);
            throw new Error("Das lokale Modell hat ein ungültiges Format generiert. Bitte erneut versuchen. Details: " + e.message);
        }
    }

    const HARDCODED_URL = 'http://localhost:1234/v1';
    const BACKEND_API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== ''
        ? ''
        : 'https://imagecreator-t9dx.onrender.com';
    let globalPromptStyle = 'tech'; 

    function switchTab(id) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        
        document.getElementById(id).classList.add('active');
        const btn = Array.from(document.querySelectorAll('.nav-btn')).find(b => b.onclick.toString().includes(id));
        if(btn) btn.classList.add('active');
    }
    
    function changeTheme() {
        const theme = document.getElementById('themeSelect').value;
        document.body.classList.remove('theme-cyan', 'theme-emerald', 'theme-pink');
        if (theme !== 'default') {
            document.body.classList.add(theme);
        }
    }

    function setPromptStyle(style, btn) {
        globalPromptStyle = style;
        document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll(`.style-btn[onclick*="${style}"]`).forEach(b => b.classList.add('active'));
        updateNanoPrompts();
    }

    function copyResult(elementId, btnElement) {
        const el = document.getElementById(elementId);
        if(!el) return;
        const text = el.innerText;
        
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed"; 
        textArea.style.left = "-9999px"; 
        document.body.appendChild(textArea);
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                const btn = btnElement || el.parentElement.querySelector('button');
                
                if(btn) {
                    const originalHTML = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    
                    const wrapper = el.closest('.generated-output') || el.parentElement;
                    if(wrapper) {
                        const originalBorder = wrapper.style.borderColor;
                        wrapper.style.borderColor = 'var(--success)';
                        setTimeout(() => {
                            btn.innerHTML = originalHTML;
                            wrapper.style.borderColor = originalBorder || 'var(--border-color)';
                        }, 1000);
                    } else {
                        setTimeout(() => {
                            btn.innerHTML = originalHTML;
                        }, 1000);
                    }
                }
            } else {
                console.warn('Copy command failed.');
            }
        } catch (err) {
            console.error('Copy failed', err);
        }
        document.body.removeChild(textArea);
    }

    /* =========================================
       MODULE 2: SORA GENERATOR LOGIC
       ========================================= */
    let genMode = 'photo';

    function getResolutionFromAspect(aspectRatio) {
      const map = {
        '16:9': { w: 1216, h: 832 }, 
        '9:16': { w: 832, h: 1216 }, 
        '1:1': { w: 1024, h: 1024 },
        '21:9': { w: 1536, h: 640 }, 
        '4:3': { w: 1152, h: 896 }, 
        '3:4': { w: 896, h: 1152 },
        '2.35:1': { w: 1536, h: 640 }, 
        '5:4': { w: 1152, h: 960 }
      };
      return map[aspectRatio] || { w: 1024, h: 1024 };
    }
    
const genConfig = [
      { type: 'header', label: '🧠 Quick Start: Auto-Bot', icon: 'fa-bolt', modes: ['photo', 'video'] },
      { type: 'textarea', id: 'quickBotIdea', label: 'Deine Bild-Idee', desc: 'Wird in einen englischen Basis-Prompt übersetzt.', placeholder: 'z.B. Ein roter Drache fliegt über eine brennende Burg...', modes: ['photo', 'video'] },
      { type: 'select', id: 'quickBotModel', label: 'Modell für Auto-Bot', modes: ['photo', 'video'], options: [['Gemini 3.1 Flash Lite', 'gemini-3.1-flash-lite'], ['LM Studio (Lokal)', 'lm-studio']] },
      { type: 'button', id: 'btnQuickBot', label: '⚡ Basis-Prompt generieren', action: 'window.runQuickBot()', modes: ['photo', 'video'] },
      { type: 'textarea', id: 'quickBotResult', label: 'Generierter Basis-Prompt', desc: 'Wird als Basis-Element vor die Dropdowns gesetzt.', placeholder: 'Hier erscheint dein Basis-Prompt...', modes: ['photo', 'video'] },
      
      { type: 'header', label: 'Hauptmotiv: Person', icon: 'fa-user', modes: ['photo', 'video'] },
      { type: 'checkbox', id: 'describePerson', label: 'Person beschreiben', default: true, modes: ['photo', 'video'] },
      { type: 'checkbox', id: 'useCelebrity', label: 'Promi / Star nutzen?', parent: 'describePerson', default: false, modes: ['photo', 'video'] },
      { type: 'text', id: 'celebrityName', label: 'Name des Promis', parent: 'useCelebrity', modes: ['photo', 'video'], placeholder: 'z.B. Elon Musk, Marilyn Monroe...' },
      { type: 'select', id: 'gender', label: 'Geschlecht', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Frau','woman'],['Mann','man'],['Non-Binär','non-binary person'],['Android/Roboter','android robot'],['Cybernetisch','cybernetic human'],['Mystisches Wesen','mythical being']] },
      { type: 'select', id: 'ageGroup', label: 'Alter', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Kind (5-10)','child, 8 years old'],['Teenager','teenager'],['Jung (20er)','20 years old, young adult'],['30er','30 years old'],['40er','40 years old, mature'],['50er','50 years old'],['60er','60 years old'],['Alt (70+)','70 years old, elderly']] },
      { type: 'select', id: 'ethnicity', label: 'Herkunft / Look', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Amerikanisch','American'],['Deutsch/Nordeuropäisch','Germanic'],['Französisch','French'],['Italienisch/Mediterran','Mediterranean'],['Skandinavisch','Scandinavian'],['Osteuropäisch','Slavic'],['Afrikanisch','African descent'],['Ostasiatisch (Jap/Kor/Chi)','East Asian'],['Südasiatisch (Indien)','South Asian'],['Latino/Hispanic','Latino'],['Arabisch','Middle Eastern'],['Futuristisch','futuristic skin'],['Fantasy (Elf/Ork)','fantasy features']] },
      { type: 'select', id: 'bodyType', label: 'Körperbau', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Schlank (Model)','slender model physique'],['Athletisch (Fit)','athletic toned body'],['Muskulös (Bodybuilder)','muscular physique'],['Kurvig','curvy figure'],['Realistisch (Durchschnitt)','average realistic body'],['Plus Size','plus size']] },
      { type: 'select', id: 'hairColor', label: 'Haare', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Blond','blonde'],['Brunette','brunette'],['Schwarz','black'],['Rot (Ingwer)','ginger red'],['Platinweiß','platinum white'],['Grau','grey'],['Bunt (Pastell)','pastel colored'],['Neon','neon glowing hair'],['Glatze','bald']] },
      { type: 'select', id: 'hairStyle', label: 'Frisur', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Lang & Glatt','long straight hair'],['Kurz (Pixie)','short pixie cut'],['Locken (Voluminös)','voluminous curly hair'],['Wellig','wavy hair'],['Pferdeschwanz','high ponytail'],['Bob','bob cut'],['Undercut','undercut'],['Messy Bun','messy bun'],['Nass Look','wet look hair']] },
      { type: 'select', id: 'eyeColor', label: 'Augen', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Kristallblau','crystal blue'],['Smaragdgrün','emerald green'],['Tiefbraun','deep brown'],['Haselnuss','hazel'],['Stahlgrau','steel grey'],['Violett','violet'],['Leuchtend (Cyber)','glowing cybernetic']] },
      { type: 'select', id: 'expression', label: 'Ausdruck', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Neutral/Cool','neutral cool expression'],['Verliebt/Romantisch','romantic loving gaze'],['Glücklich/Strahlend','happy beaming smile'],['Ernst/Fokussiert','serious focused look'],['Wütend/Intensiv','angry intense glare'],['Traurig/Melancholisch','sad melancholic'],['Überrascht','surprised expression'],['Verträumt','dreamy look'],['Verführerisch','seductive gaze']] },
      { type: 'select', id: 'clothing', label: 'Kleidung', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Bikini / Swimwear','bikini swimwear'],['Casual (T-Shirt/Jeans)','casual t-shirt and jeans'],['Streetwear (Hoodie)','oversized hoodie streetwear'],['Business Anzug','tailored business suit'],['Abendkleid (Gala)','elegant evening gown'],['Lederjacke (Edgy)','black leather jacket'],['Sci-Fi Rüstung','futuristic sci-fi armor'],['Techwear','cyberpunk techwear'],['Mittelalter Robe','medieval robes'],['Sportbekleidung','active sportswear'],['Haute Couture','avant-garde haute couture']] },
      
      // Neues, erweitertes Feld für ästhetisch-erotischere Bikini-Modifikationen
      { type: 'select', id: 'bikiniStyle', label: 'Bikini Schnitt & Style', parent: 'describePerson', modes: ['photo', 'video'], options: [
          ['Standard / Klassisch', ''],
          ['String Bikini (Schmal)', 'micro string bikini, cheeky cut'],
          ['Tanga / Thong Bikini (Fokus Rückseite)', 'thong bikini bottom, revealing cut'],
          ['Nasser Bikini (Sinnlicher Wet-Look)', 'wet translucent bikini, water droplets on skin'],
          ['Latex / Vinyl Bikini (Glänzend)', 'shiny metallic vinyl bikini, glossy finish'],
          ['Monokini (Tiefe Ausschnitte)', 'revealing cutout monokini']
      ] },
      
      { type: 'textarea', id: 'action', label: 'Handlung / Pose', parent: 'describePerson', modes: ['photo', 'video'], placeholder: 'Was macht die Person genau? (z.B. "sitzt am Fenster und trinkt Kaffee", "rennt durch den Regen")...' },
      
      { type: 'header', label: 'Tiere & Kreaturen', icon: 'fa-paw', modes: ['photo', 'video'] },
      { type: 'checkbox', id: 'describeAnimal', label: 'Tier / Kreatur hinzufügen', default: false, modes: ['photo', 'video'] },
      { type: 'select', id: 'animalType', label: 'Tierart', parent: 'describeAnimal', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Hund','dog'],['Katze','cat'],['Wolf','wolf'],['Löwe','lion'],['Tiger','tiger'],['Bär','bear'],['Pferd','horse'],['Adler','eagle'],['Eule','owl'],['Drache','dragon'],['Phönix','phoenix'],['Roboter-Tier','robotic animal'],['Monster','monster creature']] },
      { type: 'select', id: 'animalAppearance', label: 'Aussehen', parent: 'describeAnimal', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Niedlich/Fluffig','cute fluffy'],['Majestätisch','majestic'],['Bedrohlich','threatening'],['Cyborg','cybernetic'],['Geisterhaft','ghostly spectral'],['Realistisch','hyperrealistic'],['Leuchtend','bioluminescent glowing']] },
      { type: 'textarea', id: 'animalAction', label: 'Handlung des Tiers', parent: 'describeAnimal', modes: ['photo', 'video'], placeholder: 'z.B. "schläft auf dem Sofa", "jagt eine Beute"...' },

      { type: 'header', label: 'Gegenstände & Fahrzeuge', icon: 'fa-car', modes: ['photo', 'video'] },
      { type: 'checkbox', id: 'describeObject', label: 'Objekt / Fokus hinzufügen', default: false, modes: ['photo', 'video'] },
      { type: 'select', id: 'objectCategory', label: 'Kategorie', parent: 'describeObject', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Fahrzeug (Auto/Motorrad)','vehicle'],['Fahrzeug (Flug/Raum)','aircraft spacecraft'],['Waffe (Schwert/Gun)','weapon sword gun'],['Technologie','technology gadget'],['Essen/Trinken','food and drink'],['Möbel','furniture'],['Pflanze/Blume','plant flower'],['Artefakt','magical artifact']] },
      { type: 'select', id: 'objectMaterial', label: 'Material / Zustand', parent: 'describeObject', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Gold/Glänzend','shiny gold'],['Rostiges Metall','rusty metal'],['Glas/Kristall','transparent crystal glass'],['Holz (Antik)','antique wood'],['Neon/Plastik','glowing neon plastic'],['Organisch','organic biological'],['Beschädigt/Kaputt','damaged broken']] },
      { type: 'textarea', id: 'objectDesc', label: 'Objekt Beschreibung', parent: 'describeObject', modes: ['photo', 'video'], placeholder: 'z.B. "ein roter Oldtimer Mustang", "ein leuchtendes Laserschwert"...' },

      { type: 'header', label: 'Environment & Mood', icon: 'fa-earth-americas', modes: ['photo', 'video'] },
      { type: 'select', id: 'sceneType', label: 'Genre / Stil', modes: ['photo', 'video'], hasManual: true, options: [['Bitte wählen',''],['Cinematic Realism (Film)','cinematic realism'],['Cyberpunk / Sci-Fi','cyberpunk sci-fi'],['High Fantasy','high fantasy'],['Dark Horror','dark horror atmosphere'],['Film Noir (B&W)','film noir black and white'],['Steampunk','steampunk aesthetic'],['National Geographic (Doku)','documentary photography'],['Vintage 80s/90s','vintage retro aesthetic'],['Landschaftsfotografie','landscape photography'],['Editorial / Fashion','high fashion editorial'],['Weltraum / Space','outer space sci-fi'],['Unterwasser','underwater scene'],['Post-Apokalyptisch','post-apocalyptic world'],['Surrealismus','dreamy surrealism']] },
      { type: 'select', id: 'location', label: 'Ort (Location)', modes: ['photo', 'video'], hasManual: true, options: [['Bitte wählen',''],['Luxus-Apartment (Innen)','luxury modern apartment'],['Schlafzimmer (Gemütlich)','cozy bedroom'],['Küche (Chef)','professional kitchen'],['Badezimmer (Spa)','luxury spa bathroom'],['Büro (Wolkenkratzer)','skyscraper office'],['Nachtclub (Neon)','neon nightclub'],['Supermarkt','supermarket aisle'],['Museum / Galerie','art gallery'],['Verlassene Ruinen','abandoned ruins'],['Dachterrasse (Nacht)','rooftop terrace at night'],['U-Bahn Station','gritty subway station'],['Tropischer Strand','pristine tropical beach'],['Verschneite Berge','snowy mountain peak'],['Futuristisches Labor','sci-fi laboratory'],['Raumschiff','spaceship interior'],['New York Straße','busy NYC street'],['Tokio (Regen)','rainy Tokyo street'],['Waldlichtung','mystical forest glade'],['Wüste','vast desert dunes'],['Weißes Studio (Clean)','clean white infinity studio']] },
      { type: 'select', id: 'era', label: 'Zeit / Ära', modes: ['photo', 'video'], hasManual: true, options: [['Bitte wählen',''],['Modern (Heute)','modern day'],['Nahe Zukunft (2030)','near future 2030'],['Cyberpunk Zukunft (2077)','year 2077 cyberpunk'],['Y2K (2000er)','early 2000s Y2K aesthetic'],['90er Jahre','1990s aesthetic'],['80er Jahre (Synthwave)','1980s synthwave style'],['70er Jahre (Retro)','1970s retro'],['60er Jahre','1960s style'],['Viktorianisch (1800s)','Victorian era'],['Mittelalter','medieval era'],['Antike','ancient history']] },
      { type: 'select', id: 'lighting', label: 'Lichtsetzung', modes: ['photo', 'video'], hasManual: true, options: [['Bitte wählen',''],['Cinematic (Dramatisch)','dramatic cinematic lighting'],['Soft Window Light','soft natural window light'],['Golden Hour','golden hour sunlight'],['Volumetrisch (Nebel)','volumetric god rays'],['Neon (Cyberpunk)','neon cyan and magenta lighting'],['Dark / Moody','dark moody low-key lighting'],['Studio Softbox','professional studio softbox'],['Rembrandt','Rembrandt lighting'],['Hartes Sonnenlicht','harsh sunlight']] },
      { type: 'select', id: 'weather', label: 'Wetter / Atmosphäre', modes: ['photo', 'video'], hasManual: true, options: [['Bitte wählen',''],['Sonnig Klar','clear sunny sky'],['Regnerisch','heavy rain'],['Gewitter','stormy lightning'],['Schnee','heavy snow'],['Neblig','thick fog'],['Bewölkt','overcast sky'],['Staubig','dusty atmosphere']] },
      
      { type: 'header', label: 'High-End Physics & Optics', icon: 'fa-microchip', modes: ['photo', 'video'] },
      { type: 'select', id: 'detailLevel', label: 'Detailgrad (Fidelity)', desc: 'Pixeldichte und KI-Glättung', modes: ['photo', 'video'], options: [['Standard',''],['8K RAW / High Fidelity','8k raw photo, extreme detail, no smoothing, uncompressed'],['4K Sharp','4k sharp focus'],['Soft / Painterly','soft painterly style']] },
      { type: 'select', id: 'skinPhysics', label: 'Hautoberfläche', desc: 'Lichtverhalten auf Haut', modes: ['photo', 'video'], options: [['Standard',''],['Sub-surface scattering (SSS)','subsurface scattering, translucent skin, realistic epidermis'],['Porcelain (Glatt)','porcelain skin'],['Rough / Weathered','rough weathered skin texture']] },
      { type: 'select', id: 'microDetails', label: 'Mikro-Details', desc: 'Erhöht Realismus', modes: ['photo', 'video'], options: [['Standard',''],['Pores & Vellus Hair','visible pores, vellus hair, natural skin texture imperfections'],['Perfect Skin','airbrushed perfect skin']] },
      { type: 'select', id: 'sensorPhysics', label: 'Sensor-Physik', desc: 'Bildrauschen & Realismus', modes: ['photo', 'video'], options: [['Digital Clean',''],['CMOS Mobile Noise','cctv footage, phone camera noise, raw sensor data'],['Zero Denoising','zero denoising, grainy texture, authentic iso noise'],['Film Grain','heavy film grain']] },
      { type: 'select', id: 'opticsLogic', label: 'Optik / Fokus', desc: 'Tiefenschärfe Simulation', modes: ['photo', 'video'], options: [['Standard',''],['24mm Wide / f/8 Deep Focus','24mm lens, f/8 aperture, deep depth of field, everything in focus'],['85mm Portrait / f/1.8 Bokeh','85mm lens, f/1.8 aperture, creamy bokeh background'],['Macro / Shallow','macro lens, shallow depth of field']] },
      { type: 'select', id: 'lightingLogic', label: 'Lichtlogik (Flash)', desc: 'Vermeidet KI-Glow', modes: ['photo', 'video'], options: [['Standard',''],['Direct Neutral Flash','direct neutral white flash, harsh shadows, amateur photography'],['No Studio / Natural','no studio lighting, ambient light only'],['Pro Studio','professional studio lighting setup']] },
      { type: 'select', id: 'colorFidelity', label: 'Farbtreue', desc: 'Sättigung & Grading', modes: ['photo', 'video'], options: [['Standard RGB',''],['Raw Tones / Flat','raw color tones, flat profile, low contrast, desaturated'],['Vivid / Instagram','vivid colors, high saturation, instagram filter'],['Monochrome','black and white, monochrome']] },

      { type: 'header', label: 'Tech Specs (Kamera)', icon: 'fa-camera', modes: ['photo', 'video'] },
      { type: 'select', id: 'aspectRatio', label: 'Format (Aspect Ratio)', desc: 'Bestimmt die Auflösung.', modes: ['photo', 'video'], options: [['16:9 (Kino breit)','16:9'],['9:16 (TikTok/Reel)','9:16'],['1:1 (Instagram/Square)','1:1'],['21:9 (Ultrawide)','21:9'],['4:3 (TV Klassisch)','4:3'],['3:4 (Portrait)','3:4'],['2.35:1 (Anamorphic)','2.35:1']] },
      { type: 'select', id: 'viewAngle', label: 'Kamerawinkel', desc: 'Perspektive der Aufnahme.', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Augenhöhe (Neutral)','eye-level shot'],['Froschperspektive (Low Angle)','low angle shot looking up'],['Vogelperspektive (High Angle)','high angle shot looking down'],['Top-Down (Draufsicht)','top-down drone view'],['Over-the-Shoulder','over-the-shoulder shot'],['Dutch Angle (Schräg)','dutch angle dynamic shot'],['POV (Ego)','first-person POV shot'],['Makro (Close-Up)','extreme macro close-up'],['Weitwinkel','wide angle shot'],['Fischauge','fisheye lens effect'],['Tele (Zoom)','telephoto compression'],['Selfie','selfie shot']] },
      { type: 'select', id: 'filmStock', label: 'Film Look / Analog', desc: 'Simuliert analoges Filmmaterial.', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Digital Clean (8K)','digital crisp 8k'],['Kodak Portra 400','Kodak Portra 400 film grain'],['Cinestill 800T (Nacht)','Cinestill 800T halation'],['Fujifilm Velvia','Fujifilm Velvia 50'],['Kodak Tri-X (B&W)','Kodak Tri-X 400 black and white'],['Technicolor (Vintage)','vintage Technicolor'],['Bleach Bypass','bleach bypass gritty'],['VHS (Glitch)','VHS tape artifacting'],['Polaroid','Polaroid instant photo'],['IMAX (70mm)','IMAX 70mm film quality']] },
      { type: 'select', id: 'renderEngine', label: 'Render Stil (Digital)', desc: 'Für nicht-fotorealistische Stile.', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Fotorealistisch (Raw)','photorealistic raw photo'],['Unreal Engine 5','Unreal Engine 5 render'],['Octane Render','Octane 3D render'],['Pixar / Disney','Pixar 3D animation style'],['Anime (Modern)','modern anime style'],['Ölgemälde','classic oil painting'],['Aquarell','watercolor painting'],['Concept Art','digital concept art'],['Vector Art','flat vector art'],['Pixel Art','retro pixel art']] },
      
      { type: 'header', label: 'Video Settings', icon: 'fa-film', modes: ['video'] },
      { type: 'select', id: 'cameraMotion', label: 'Kamerabewegung', modes: ['video'], options: [['Statisch (Stativ)','static tripod shot'],['Sanfter Zoom In','slow zoom in'],['Zoom Out','slow zoom out'],['Pan Rechts','smooth pan right'],['Pan Links','smooth pan left'],['Tracking Shot (Verfolgung)','dolly tracking shot'],['Handheld (Wackelig)','handheld shaky camera'],['FPV Drohne (Schnell)','fast FPV drone flight'],['Orbit (Kreisfahrt)','circular orbit shot']] },
      { type: 'select', id: 'fps', label: 'Framerate', modes: ['video'], options: [['24 FPS (Cinematic)','24'],['30 FPS (Standard)','30'],['60 FPS (Smooth)','60']] },
      { type: 'select', id: 'duration', label: 'Dauer', modes: ['video'], options: [['5 Sekunden','5s'],['10 Sekunden','10s']] },
      { type: 'select', id: 'loop', label: 'Loop', modes: ['video'], options: [['Nein','false'],['Ja','true']] }
    ];

    const debouncedUpdateGen = debounce(updateGenSummary, 300);

    function setGenMode(mode) {
        genMode = mode;
        document.getElementById('modePhoto').className = mode === 'photo' ? 'btn btn-primary' : 'btn btn-secondary';
        document.getElementById('modeVideo').className = mode === 'video' ? 'btn btn-primary' : 'btn btn-secondary';
        renderGenForm();
    }

    function renderGenForm() {
        const container = document.getElementById('gen-controls');
        container.innerHTML = '';
        
        let currentCard = null;

        genConfig.forEach(field => {
            if (!field.modes.includes(genMode)) return;

            if (field.type === 'header') {
                if(currentCard) container.appendChild(currentCard);
                currentCard = document.createElement('div');
                currentCard.className = 'card';
                currentCard.innerHTML = `<div class="card-title"><i class="fa-solid ${field.icon}"></i> ${field.label}</div>`;
                return;
            }

            if(!currentCard) { currentCard = document.createElement('div'); currentCard.className = 'card'; }

            const group = document.createElement('div');
            if(field.parent) group.dataset.parent = field.parent;

            if (field.type === 'checkbox') {
                group.className = 'toggle-wrapper';
                group.innerHTML = `<input type="checkbox" id="${field.id}" ${field.default?'checked':''} onchange="handleGenVisibility()"><label for="${field.id}">${field.label}</label>`;
            } else if (field.type === 'button') {
                group.innerHTML = `<button class="btn btn-primary" id="${field.id}" onclick="${field.action}" style="width:100%; justify-content:center; margin-top:5px; margin-bottom:15px; font-weight:bold;">${field.label}</button>`;
            } else {
                let html = `<label>${field.label}`;
                if(field.desc) html += ` <span class="field-desc">${field.desc}</span>`;
                html += `</label>`;
                
                if (field.type === 'select') {
                    const opts = field.options.map(o => `<option value="${o[1]}">${o[0]}</option>`).join('');
                    html += `<select id="${field.id}" onchange="debouncedUpdateGen()">${opts}</select>`;
                    // NEW: Manual input for Environment fields
                    if (field.hasManual) {
                        html += `<input type="text" id="${field.id}_manual" class="manual-input" placeholder="Manuelle Ergänzung / Spezifikation..." oninput="debouncedUpdateGen()">`;
                    }
                } else if (field.type === 'textarea') {
                    html += `<textarea id="${field.id}" placeholder="${field.placeholder||''}" oninput="debouncedUpdateGen()" style="min-height:60px"></textarea>`;
                } else {
                    html += `<input type="text" id="${field.id}" placeholder="${field.placeholder||''}" oninput="debouncedUpdateGen()">`;
                }
                group.innerHTML = html;
            }
            currentCard.appendChild(group);
        });
        if(currentCard) container.appendChild(currentCard);
        handleGenVisibility();
        updateGenSummary();
    }

    function handleGenVisibility() {
        genConfig.forEach(f => {
            if(f.parent) {
                const parentEl = document.getElementById(f.parent);
                const dependentEls = document.querySelectorAll(`[data-parent="${f.parent}"]`);
                dependentEls.forEach(el => {
                    const parentActive = parentEl && parentEl.checked;
                    const parentGroup = parentEl.closest('[data-parent]'); 
                    let parentVisible = true;
                    if(parentGroup && parentGroup.style.display === 'none') {
                        parentVisible = false;
                    }
                    if(parentActive && parentVisible) {
                         el.style.display = 'block';
                    } else {
                        el.style.display = 'none';
                    }
                });
            }
        });
        debouncedUpdateGen();
    }

    function getVal(id) { 
        const el = document.getElementById(id); 
        if(!el) return '';
        const manualEl = document.getElementById(id + '_manual');
        let baseVal = el.value;
        let manualVal = manualEl ? manualEl.value.trim() : '';
        
        if (manualVal) {
            return baseVal ? `${baseVal} (Note: ${manualVal})` : manualVal;
        }
        return baseVal;
    }

function updateGenSummary() {
        const join = (...args) => args.filter(Boolean).join(', ');
        let parts = [];

        const basePrompt = document.getElementById('quickBotResult')?.value.trim();
        if(basePrompt) {
            parts.push(`BASE CONCEPT: ${basePrompt}`);
        }

        if(document.getElementById('describePerson')?.checked) {
             const isCeleb = document.getElementById('useCelebrity')?.checked && getVal('celebrityName');
             let pText = "";
             if (isCeleb) {
                pText = `SUBJECT: ${getVal('celebrityName')}`;
             } else {
                pText = `SUBJECT: ${join(getVal('ageGroup'), getVal('ethnicity'), getVal('gender'), getVal('bodyType'))}`;
             }
             
             // Wir holen uns den normalen Kleidungs-Wert und den Bikini-Zusatz
             let currentClothing = getVal('clothing');
             let bStyle = getVal('bikiniStyle');

             // Wenn ein spezieller Bikini-Style gewählt wurde UND oben Bikini eingestellt ist, 
             // überschreiben oder ergänzen wir den Text für die KI
             if (currentClothing.includes('bikini') && bStyle) {
                 currentClothing = bStyle; 
             }

             const extras = join(
                 currentClothing ? `wearing ${currentClothing}` : '',
                 getVal('hairColor') || getVal('hairStyle') ? `Hair: ${getVal('hairColor')} ${getVal('hairStyle')}` : '',
                 getVal('expression') ? `Mood: ${getVal('expression')}` : ''
             );
             
             if(extras) pText += ` (${extras})`;
             if(getVal('action')) pText += ` ACTION: ${getVal('action')}`;
             parts.push(pText);
        }

        if(document.getElementById('describeAnimal')?.checked) {
             parts.push(`ANIMAL: ${join(getVal('animalAppearance'), getVal('animalType'), getVal('animalAction'))}`);
        }

        if(document.getElementById('describeObject')?.checked) {
             parts.push(`OBJECT: ${join(getVal('objectMaterial'), getVal('objectCategory'), getVal('objectDesc'))}`);
        }

        const env = join(getVal('location'), getVal('sceneType'), getVal('era'), getVal('weather'), getVal('lighting'));
        if(env) parts.push(`SETTING: ${env}`);

        const tech = join(getVal('viewAngle'), getVal('filmStock'), getVal('detailLevel'), getVal('opticsLogic'));
        if(tech) parts.push(`STYLE: ${tech}`);
        
        if(getVal('aspectRatio')) parts.push(`FORMAT: ${getVal('aspectRatio')}`);

        const el = document.getElementById('rawPrompt');
        if (el) el.innerText = parts.join('\n') || "Warte auf Input...";
    }

        

    function randomizeForm() {
        genConfig.forEach(f => {
            if(!f.modes.includes(genMode) || f.type !== 'select') return;
            const el = document.getElementById(f.id);
            if(el && f.options.length > 1) {
                el.value = f.options[Math.floor(Math.random() * (f.options.length - 1)) + 1][1];
            }
            // Clear manual inputs on randomize
            const manualEl = document.getElementById(f.id + '_manual');
            if(manualEl) manualEl.value = '';
        });
        updateGenSummary();
    }

    // --- LM STUDIO API CALLS (AUTO-CONNECT & STRICT JSON) ---
    async function fetchLocalAI(promptText, customSystemPrompt = null) {
        let baseUrl = document.getElementById('apiUrl').value.trim();
        if (!baseUrl) baseUrl = HARDCODED_URL;
        
        baseUrl = baseUrl.replace(/\/$/, "");
        const url = `${baseUrl}/chat/completions`;

        const fallbackSystemPrompt = `
You are an expert AI Prompt Engineer. Your task is to output strictly and only valid JSON.
Do not output markdown code blocks. Do not add any conversational text before or after the JSON.
Every value inside the JSON must be written in English.`;

        const systemContent = customSystemPrompt || fallbackSystemPrompt;

        const requestBody = {
            model: "local-model", 
            messages: [
                { role: "system", content: systemContent },
                { role: "user", content: promptText }
            ],
            temperature: 0.1, // Sehr niedrig für JSON-Stabilität
            stream: false
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer lm-studio'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            if (data.choices && data.choices[0]) {
                return data.choices[0].message.content;
            } else {
                throw new Error("Leere Antwort vom lokalen Modell.");
            }

        } catch (e) {
            console.error("LM Studio Fehler:", e);
            throw new Error(`Konnte nicht mit LM Studio auf ${baseUrl} verbinden. Ist der Server gestartet und CORS aktiviert? (${e.message})`);
        }
    }

    window.runQuickBot = async function() {
        const btn = document.getElementById('btnQuickBot');
        const idea = document.getElementById('quickBotIdea').value.trim();
        const model = document.getElementById('quickBotModel').value;
        const resultArea = document.getElementById('quickBotResult');
        const lmUrl = document.getElementById('apiUrl')?.value.trim() || HARDCODED_URL;
        
        if(!idea) {
            showToast("Bitte gib zuerst eine Idee ein!", true);
            return;
        }
        
        btn.innerHTML = '<span class="spinner" style="display:inline-block;"></span> Generiere...';
        btn.disabled = true;
        
        const sysPrompt = "Du bist ein Experte für Bild-Prompts. Übersetze die Idee des Nutzers in einen simplen, effektiven englischen Bild-Prompt. Konzentriere dich auf das Subjekt, die Umgebung und die Grundstimmung. Antworte NUR mit dem englischen Prompt, ohne Erklärungen, ohne markdown Formatierung.";
        
        try {
            const response = await fetch(BACKEND_API_URL + '/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goal: idea,
                    model: model,
                    system_prompt: sysPrompt,
                    lm_url: lmUrl
                })
            });
            
            if (!response.ok) throw new Error("API Fehler");
            const data = await response.json();
            
            let generatedPrompt = data.optimized_goal.trim();
            if(generatedPrompt.startsWith('"') && generatedPrompt.endsWith('"')) {
                generatedPrompt = generatedPrompt.slice(1, -1);
            }
            
            resultArea.value = generatedPrompt;
            showToast("Basis-Prompt generiert!");
            debouncedUpdateGen();
        } catch (e) {
            console.error(e);
            showToast("Fehler bei der Generierung.", true);
        }
        
        btn.innerHTML = '⚡ Basis-Prompt generieren';
        btn.disabled = false;
    };

    async function callLocalAI() {
        const btn = document.getElementById('optimizeAiBtn');
        const spinner = document.getElementById('aiSpinner');
        btn.disabled = true; spinner.style.display = 'inline-block';
        
        const context = document.getElementById('rawPrompt').innerText;
        const autoBotLevel = document.getElementById('autoBotLevel').value;
        const model = document.getElementById('modelSelectMain').value;
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;
        
        const systemPrompt = `Du bist ein Experte für das Optimieren von Bild-Prompts für Diffusionsmodelle (wie Stable Diffusion / Midjourney). Deine Aufgabe ist es, den bereitgestellten Prompt des Nutzers zu verbessern, ohne jedoch den Kern, die Komposition oder den Charakter der ursprünglichen Szene zu verändern.

Halte dich strikt an folgende Regeln:

1. KEIN OVER-ENGINEERING (Kein Text-Rauschen): Erfinde keine unnötigen neuen Bildelemente, Kleidungsstücke oder Hintergrunddetails hinzu, die der Nutzer nicht genannt hat.
2. STRUKTUR: Ordne den optimierten Prompt streng nach dem Prinzip: [Subjekt] -> [Aktion/Pose] -> [Umgebung/Hintergrund] -> [Kamera-Spezifikationen/Licht].
3. SPRACHE: Übersetze die Szene komplett ins Englische, da Bild-KIs das präziser verarbeiten können.
4. KEINE WIDERSPRÜCHLICHEN NEGATIVES: Halte den Negative Prompt sauber und fokussiert auf Qualität und Anatomie. Liste dort KEINE Kleidungsstücke oder Objekte auf, die einfach nur nicht im Bild sein sollen.
5. FOKUS AUF REALISMUS: Nutze präzise Kamera-Begriffe statt schwammiger Wörter wie "photorealistic".

Ausgabe-Format:
Du musst die Antwort als valides JSON-Objekt zurückgeben. Das JSON MUSS folgende Struktur haben:
{
  "workflow_meta": {
    "intent": "Brief description of the scene in English",
    "style_category": "e.g., Cinematic, Cyberpunk, Photorealistic"
  },
  "prompts": {
    "positive_prompt": "Der optimierte englische Prompt gemäß Strukturregeln",
    "negative_prompt": "Ein sauberer, effektiver Negative Prompt gemäß Negative-Regeln"
  },
  "generation_parameters": {
    "aspect_ratio": "Extract or guess best ratio (e.g., 16:9)",
    "suggested_width": 1024,
    "suggested_height": 1024,
    "cfg_scale": 7.0,
    "steps": 30,
    "sampler_name": "DPM++ 2M Karras"
  }
}`;

            // Auto Bot Streaming
            const consoleDiv = document.getElementById('autoBotConsole');
            const logDiv = document.getElementById('autoBotLog');
            const statusSpan = document.getElementById('autoBotStatus');
            
            consoleDiv.style.display = 'block';
            logDiv.innerHTML = '';
            statusSpan.innerText = 'Running...';
            statusSpan.style.color = 'var(--warning)';
            
            try {
                const response = await fetch(BACKEND_API_URL + '/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        goal: context,
                        model: model,
                        system_prompt: systemPrompt,
                        lm_url: lmUrl,
                        level: autoBotLevel
                    })
                });
                
                if (!response.ok) throw new Error("API Fehler");
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let buffer = "";
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop(); // Keep incomplete chunk in buffer
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '');
                            try {
                                const payload = JSON.parse(dataStr);
                                if (payload.event === 'log' || payload.event === 'experts' || payload.event === 'draft' || payload.event === 'review') {
                                    const logEntry = document.createElement('div');
                                    logEntry.innerHTML = `<span style="color:#64748b;">[AutoBot]</span> ${payload.message}`;
                                    logDiv.appendChild(logEntry);
                                    logDiv.scrollTop = logDiv.scrollHeight;
                                } else if (payload.event === 'final') {
                                    const logEntry = document.createElement('div');
                                    logEntry.innerHTML = `<span style="color:var(--success);">[AutoBot]</span> ${payload.message}`;
                                    logDiv.appendChild(logEntry);
                                    logDiv.scrollTop = logDiv.scrollHeight;
                                    
                                    statusSpan.innerText = 'Completed';
                                    statusSpan.style.color = 'var(--success)';
                                    
                                    const res = extractJSON(payload.content);
                                    document.getElementById('codeBlock').textContent = JSON.stringify(res, null, 2);
                                    Prism.highlightElement(document.getElementById('codeBlock'));
                                    showToast("Auto Bot JSON erfolgreich generiert!");
                                }
                            } catch (err) {
                                console.error("Error parsing SSE JSON:", err);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(e.message);
                showToast("Fehler: " + e.message, true); 
                statusSpan.innerText = 'Failed';
                statusSpan.style.color = 'var(--danger)';
            }
            btn.disabled = false; spinner.style.display = 'none';
    }

    
    function convertToProse(type, val) {
        if(!val) return "";
        const map = {
            'low angle': 'captured from a low angle to emphasize dominance',
            'high angle': 'seen from a high angle, making the subject appear smaller',
            'neon': 'bathed in vibrant, colorful neon lights',
            'cinematic': 'with dramatic, high-contrast cinematic lighting',
            '8k raw': 'captured in incredible detail with realistic textures',
            'f/1.4': 'featuring a shallow depth of field with a soft, blurred background',
            '16:9': 'framed in a wide cinematic aspect ratio'
        };
        for (const k in map) {
            if (val.toLowerCase().includes(k)) return map[k];
        }
        return val; 
    }

    function generateLocalJSON() {
        const aspectRatio = getVal('aspectRatio') || "16:9";
        const res = getResolutionFromAspect(aspectRatio);
        
        const join = (...args) => args.filter(Boolean).join(', ');

        const quickBotBase = document.getElementById('quickBotResult')?.value.trim();

        let subject = "";
        if(document.getElementById('useCelebrity')?.checked && getVal('celebrityName')) {
             subject = getVal('celebrityName');
        } else {
             subject = join(getVal('ageGroup'), getVal('ethnicity'), getVal('gender'), getVal('bodyType'));
        }
        const clothes = getVal('clothing');
        const action = getVal('action');
        const location = getVal('location');
        const lighting = getVal('lighting');
        const style = getVal('sceneType');

        let additionalElementsTech = [];

        if (document.getElementById('describeAnimal')?.checked) {
            const animal = join(getVal('animalAppearance'), getVal('animalType'));
            const animAction = getVal('animalAction');
            if (animal) {
                additionalElementsTech.push(animal + (animAction ? ` (${animAction})` : ""));
            }
        }

        if (document.getElementById('describeObject')?.checked) {
            const obj = join(getVal('objectMaterial'), getVal('objectCategory'));
            const objDesc = getVal('objectDesc');
            if (obj || objDesc) {
                const fullObj = join(obj, objDesc);
                additionalElementsTech.push(fullObj);
            }
        }
        
        const techStr = join(
            quickBotBase,
            subject, 
            clothes ? `wearing ${clothes}` : '', 
            action,
            additionalElementsTech.join(", "), 
            location, lighting, style,
            getVal('filmStock'), getVal('opticsLogic'), getVal('detailLevel'),
            "8k uhd, dslr, high quality", `--ar ${aspectRatio.replace(':','-')}`
        );

        const json = {
            "workflow_meta": { 
                "intent": action || "Portrait or generic generated scene",
                "style_category": style || "Photorealistic / Generic"
            },
            "prompts": {
                "positive_prompt": techStr,
                "negative_prompt": "worst quality, low resolution, deformed, bad anatomy, bad hands, text, watermark, missing fingers, extra digit"
            },
            "generation_parameters": {
                "aspect_ratio": aspectRatio,
                "suggested_width": res.w,
                "suggested_height": res.h,
                "cfg_scale": 7.0,
                "steps": 30,
                "sampler_name": "DPM++ 2M Karras"
            },
            "advanced_nodes": {
                "recommended_loras": ["add_detail", "more_cinematic_lighting"],
                "controlnet_hints": []
            }
        };
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
                statusText.innerText = "Offline (HTTP Fehler)";
                statusDot.style.color = "var(--danger)";
            }
        } catch (e) {
            statusText.innerText = "Offline / CORS Fehler";
            statusDot.style.color = "var(--danger)";
        }
        statusDot.classList.remove("pulse-animation");
    }

    /* =========================================
       MODULE 3: NANO SUITE LOGIC 
       ========================================= */
    const nanoState = {
        char: { desc: '', action: '', mode: 'story', weight: 100 },
        face: { op: 'swap', detail: '' },
        obj:  { action: 'add', what: '', physics: 'standard', strength: 75, scope: 'inpaint' }, 
        bg:   { mode: 'change', prompt: '' },
        cine: { 
            cam: 'alexa', lens: 'arri_sig', focal: '35mm', aperture: 'f2.8', 
            scene: '', engine: 'dalle', ratio: '--ar 16:9', moves: [], mode: 'new',
            preserve: { identity: true, outfit: false, composition: false },
            editOps: { contrast: 30, saturation: -10, blurBG: 25, sharpenSubject: 20, rotateDutch: 8, grain: 10, coolHighlights: 10, deepenShadows: 20 }
        }
    };

    function initNano() {
        const debouncedUpdateNano = debounce(updateNanoPrompts, 300);
        
        document.querySelectorAll('[data-nano]').forEach(el => {
            el.addEventListener('input', (e) => {
                const [cat, field] = el.dataset.nano.split('.');
                nanoState[cat][field] = e.target.value;
                
                // Reset preset selector if user manually inputs action or what prompt
                if(cat === 'obj' && (field === 'action' || field === 'what')) {
                    const selector = document.getElementById('editPresetSelector');
                    if (selector) selector.value = "";
                    const descEl = document.getElementById('editPresetDesc');
                    if (descEl) descEl.innerText = "";
                }
                
                debouncedUpdateNano();
            });
        });

        document.querySelectorAll('#cine-chips .chip').forEach(chip => {
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                const val = chip.dataset.cam;
                if(chip.classList.contains('active')) nanoState.cine.moves.push(val);
                else nanoState.cine.moves = nanoState.cine.moves.filter(x => x !== val);
                debouncedUpdateNano();
            });
        });
    }

    function updateNanoScope(scope) {
        nanoState.obj.scope = scope;
        updateNanoPrompts();
    }

    window.applyEditPreset = function() {
        const preset = document.getElementById('editPresetSelector').value;
        const actionSelect = document.querySelector('[data-nano="obj.action"]');
        const whatInput = document.querySelector('[data-nano="obj.what"]');
        const descEl = document.getElementById('editPresetDesc');

        if (!preset) {
            actionSelect.value = "add";
            whatInput.value = "";
            descEl.innerText = "";
            nanoState.obj.action = "add";
            nanoState.obj.what = "";
            updateNanoPrompts();
            return;
        }

        let action = "add";
        let what = "";
        let desc = "";

        switch (preset) {
            case 'kleidung':
                action = "alter";
                what = "Zieh der Person vom Referenzbild einen schwarzen Anzug und eine gelbe Krawatte an.";
                desc = "Erklärung: Kleidung von Models oder Portraits kann einfach virtuell angepasst werden.";
                break;
            case 'add_obj':
                action = "add";
                what = "Füge einen Hai in den Pool hinzu.";
                desc = "Erklärung: Bestehende Fotos können mit neuen Objekten erweitert werden, ohne das Bild zu verfälschen.";
                break;
            case 'change_obj':
                action = "replace";
                what = "Ändere die zwei Büsten im Bild zu Stormtrooper-Statuen.";
                desc = "Erklärung: Beliebige Objekte lassen sich durch andere ersetzen.";
                break;
            case 'remove_obj':
                action = "remove";
                what = "Entferne bitte alle Menschen aus diesem Urlaubsfoto.";
                desc = "Erklärung: Ungewollte Personen oder Dinge lassen sich nahtlos löschen.";
                break;
            case 'style':
                action = "alter";
                what = "Erstelle das Bild im Stil eines handgezeichneten Comics.";
                desc = "Erklärung: Je nachdem, welcher Stil gefragt ist, kann das Bild sofort umgewandelt werden.";
                break;
        }
        
        actionSelect.value = action;
        whatInput.value = what;
        descEl.innerText = desc;
        
        nanoState.obj.action = action;
        nanoState.obj.what = what;
        
        // Trigger prompt generation
        updateNanoPrompts();
    };
    
    function updateCineMode(mode) {
        nanoState.cine.mode = mode;
        updateNanoPrompts();
    }

    // 2. SMART CAMERA LOGIC
    function getCameraModifiers(ci) {
        let mods = [];
        if (ci.aperture === 'f1.4' || ci.aperture === 'f2.8') mods.push("shallow depth of field, creamy bokeh");
        if (ci.focal.includes('14mm')) mods.push("ultra wide angle, fisheye distortion");
        if (ci.cam === 'alexa') mods.push("ARRI color science, rich blacks");
        return mods.join(", ");
    }

    function updateNanoPrompts() {
        const h = (t) => `<span style="color:var(--success); font-weight:bold;">${t||'[...]'}</span>`;
        
        const c = nanoState.char;
        let charTxt = "";
        if (globalPromptStyle === 'tech') {
            const wVal = (c.weight / 100).toFixed(2);
            if (c.mode === 'story') charTxt = `Image of ${h(c.desc)} performing ${h(c.action)}. **Reference:** Face ID Match. **Weight:** --cw ${wVal}`;
            else if (c.mode === 'pose') charTxt = `**ControlNet Pose:** OpenPose Transfer to ${h(c.desc)}. Action: ${h(c.action)}. --sw ${wVal}`;
            else charTxt = `**Character Sheet:** ${h(c.desc)}. Front view, Side view, Back view. Neutral lighting.`;
        } else {
            charTxt = `A consistent character study of ${h(c.desc)}, shown ${h(c.action)}. The facial features match the reference perfectly.`;
        }
        document.getElementById('out-char').innerHTML = charTxt;

        document.getElementById('out-face').innerHTML = `Operation: ${nanoState.face.op}, Target: ${h(nanoState.face.detail)}`;

        const o = nanoState.obj;
        const denoise = (o.strength / 100).toFixed(2);
        let editPrompt = "";
        if (globalPromptStyle === 'tech') {
            if (o.scope === 'inpaint') {
                editPrompt = `**STABLE DIFFUSION (Inpaint):**\n(Masked) ${o.action === 'remove' ? 'empty background' : h(o.what)}, high quality --denoise ${denoise}`;
            } else {
                editPrompt = `**STABLE DIFFUSION (Img2Img):**\n${h(o.what)} --strength ${denoise}`;
            }
        } else {
            if (o.scope === 'inpaint') {
                editPrompt = `Please modify the selected area. ${o.action === 'remove' ? 'Remove the object completely and fill with background' : `Insert a ${h(o.what)} that blends seamlessly`}.`;
            } else {
                editPrompt = `Transform the entire image to appear as ${h(o.what)}, maintaining the original composition.`;
            }
        }
        document.getElementById('out-obj').innerHTML = editPrompt;
        
        // Hide metadata container when displaying live local fast-gen
        const metaEl = document.getElementById('out-obj-meta');
        if (metaEl) metaEl.style.display = 'none';

        document.getElementById('out-bg').innerHTML = `Background: ${nanoState.bg.mode}, Prompt: ${h(nanoState.bg.prompt)}`;

        const ci = nanoState.cine;
        document.getElementById('out-cine-tech').innerHTML = renderCineTech(ci);
        document.getElementById('out-cine-scene').innerHTML = renderCineScene(ci);
        
        // Finales Feld nur aktualisieren, wenn wir NICHT im AI-Mode sind (sonst überschreibt die Live-Summary das KI JSON)
        const currentContent = document.getElementById('out-cine-final').textContent;
        if (!currentContent.startsWith('{')) {
            document.getElementById('out-cine-final').textContent = renderCineFinal(ci);
        }
    }

    function engineSupportsEdit(engine) {
      return (engine === 'flow' || engine === 'dalle' || engine === 'sd_img2img' || engine === 'mj_remix' || engine === 'firefly');
    }

    function validateCine(ci) {
      const issues = [];
      if (ci.mode === 'edit' && !engineSupportsEdit(ci.engine)) issues.push(`Engine "${ci.engine}" does not support edits.`);
      if (ci.mode === 'edit' && (!ci.editOps || Object.keys(ci.editOps).length === 0)) issues.push("No edit operations set.");
      return issues;
    }

    function renderCineTech(ci) {
        const issues = validateCine(ci);
        const tech = [];
        tech.push(`<span style="color:#e2e8f0">MODE:</span> <span style="color:#fff">${ci.mode.toUpperCase()}</span>`);
        tech.push(`<span style="color:#e2e8f0">ENGINE:</span> <span style="color:#fff">${ci.engine}</span>`);
        tech.push(`<span style="color:#e2e8f0">RIG:</span> <span style="color:#fff">${ci.cam} + ${ci.lens}</span>`);
        if(ci.moves.length > 0) {
            tech.push(`<span style="color:#e2e8f0">SHOT:</span> <span style="color:#a5b4fc">${ci.moves.join(", ")}</span>`);
        }
        tech.push(`<span style="color:#e2e8f0">OPS:</span> <span style="color:#a5b4fc">contrast ${ci.editOps.contrast}, blur ${ci.editOps.blurBG}%, rotate ${ci.editOps.rotateDutch}</span>`);
        if (issues.length) tech.push(`<span style="color:#f87171">⚠ ${issues.join(" | ")}</span>`);
        return tech.join(" | ");
    }

    function renderCineScene(ci) {
        return ci.scene ? `<b>SCENE INTENTION:</b> ${ci.scene}` : "<i>(No scene description provided)</i>";
    }

    // 3. OPTIMIERTE PROMPT GENERATION (Fallback / Live)
    function renderCineFinal(ci) {
        if (ci.mode === 'edit') {
            return `[EDIT INSTRUCTION] Modify the uploaded image to match: ${ci.scene}. 
Camera Rig: ${ci.cam} with ${ci.lens}. 
Lighting/Style: ${getCameraModifiers(ci)}. 
Aspect Ratio: ${ci.ratio.replace('--ar ', '')}`;
        } else {
            const techTags = getCameraModifiers(ci);
            return `${ci.scene || "cinematic scene"}, ${techTags}, ${ci.cam} footage, ${ci.lens}, cinematic lighting --ar ${ci.ratio.replace('--ar ','')}`;
        }
    }

    function updateRes() {
        const mode = document.getElementById('res-mode').value;
        let p = "";
        if(mode === 'restore') p = "Photo Restoration: Remove scratches, dust, and fold marks. Sharpen facial details, reduce noise.";
        else if(mode === 'colorize') p = "Colorization: Authentic historical colorization. Convert B&W to color.";
        else p = "Upscale & Enhance: Increase resolution to 4k. Hallucinate missing details in textures.";
        document.getElementById('out-res').innerHTML = p;
    }

    async function optimizeEditPrompt() {
        const btn = document.getElementById('optimizeEditBtn');
        const spinner = document.getElementById('editSpinner');
        btn.disabled = true; spinner.style.display = 'inline-block';

        const o = nanoState.obj;
        const denoise = (o.strength / 100).toFixed(2);
        
        const rawContext = `Aktion: ${o.action}
Prompt (Was soll entstehen): ${o.what}
Scope: ${o.scope} (Inpaint oder Global)
Denoising Strength: ${denoise}
Licht-Physik Integration: ${o.physics}`;
        
        const useAutoBot = document.getElementById('useAutoBotEdit').checked;
        const model = document.getElementById('modelSelectEdit').value;
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;

        const systemPrompt = `Du bist ein Experte für das Optimieren von Inpainting- und Image-Editing-Prompts für Bildgeneratoren (wie Stable Diffusion / Midjourney).
Deine Aufgabe ist es, den Änderungswunsch des Nutzers (Hinzufügen, Entfernen, Ersetzen oder Stil ändern) in ein englisches Prompting-Format zu übersetzen.

Mache einen fundamentalen Unterschied abhängig von der Bearbeitungsmethode (Scope):

1. WENN METHODE = "inpaint" (Inpainting / Masken-Modus):
- Die Bild-KI verändert NUR den maskierten Bereich. Der Prompt darf sich AUSSCHLIESSLICH auf das beziehen, was INNERHALB der Maske entstehen, verschwinden oder ersetzt werden soll.
- FÜR ERSETZEN (Swap/Replace): Beschreibe im Prompt NUR das NEUE Objekt, das anstelle des alten Objekts erscheinen soll (z.B. wenn der Pullover durch einen roten Pullover ersetzt wird, beschreibe nur den roten Pullover). Beschreibe NIEMALS Gesicht, Person oder Hintergrund außerhalb der Maske.
- FÜR STIL ÄNDERN (Alter): Wenn nur der Stil eines Teilbereichs geändert wird, beschreibe das Subjekt im neuen Stil im Detail (z.B. "cybernetic arm" statt echtem Arm).
- Beschreibe NIEMALS Details außerhalb der Maske (z.B. Kopf, Gesicht, Kleidung oder Hintergrund), da dies die KI dazu zwingt, diese Elemente fälschlicherweise in den maskierten Bereich zu zeichnen!

2. WENN METHODE = "global" (Globales Img2Img):
- Die Bild-KI verändert das gesamte Bild. Um das ursprüngliche Bild maximal beizubehalten, MUSS der Prompt die bestehenden Elemente beschreiben und explizit anweisen, diese nicht zu verändern.
- FÜR ERSETZEN (Swap/Replace) & HINZUFÜGEN (Insert): Verwende exakte Erhaltungs-Regeln: "preserving the original composition, keeping the exact background, subject identity, clothing, pose, and environment completely unchanged from the source image, with the only modification being [ÄNDERUNG]".
- FÜR STIL ÄNDERN (Alter) (z.B. Anime, Comic): Da sich der Stil des gesamten Bildes ändern soll, weise die KI an, die Konturen, Komposition und Personen-Identität beizubehalten, aber das Rendering zu ändern: "Redraw the entire original scene in [NEUER STIL] style, preserving the exact composition, pose, subject identity (the girl's face, hair, and clothing), and background structures from the source image".

Allgemeine Regeln:
- Sprache: Immer auf Englisch antworten.
- Licht & Physik: Integriere die Licht-Physik ("${o.physics}") passend (z.B. "accurate lighting reflections", "matching shadows").
- Denoising Strength: Nimm Rücksicht darauf, dass eine Denoising Strength von "${denoise}" verwendet wird. Je höher dieser Wert, desto aggressiver muss der Prompt auf den Erhalt des Originals pochen.

Ausgabe-Format:
Gib das Ergebnis als valides JSON-Objekt zurück:
{
  "edit_workflow": {
    "intent": "Short summary of the edit goal in English",
    "physics_integration": "How the lighting and shadows should merge in English"
  },
  "prompts": {
    "technical_prompt": "Technical rendering keywords for the edit (e.g., matching noise, seamless integration)",
    "scene_prompt": "Prompt focusing ONLY on the change or the overall preserved scene description in English",
    "final_prompt": "The final integrated English prompt to be entered into the generator"
  }
}`;

        function applyEditResult(res) {
            const p = res.prompts?.final_prompt || "";
            const tech = res.prompts?.technical_prompt || "";
            const intent = res.edit_workflow?.intent || "";
            const integration = res.edit_workflow?.physics_integration || "";
            
            const metaEl = document.getElementById('out-obj-meta');
            if (metaEl) {
                metaEl.innerHTML = `
                    <b>Ziel:</b> ${intent}<br>
                    <b>Integration:</b> ${integration}<br>
                    <b>Tech:</b> ${tech}
                `;
                metaEl.style.display = 'block';
            }
            
            document.getElementById('out-obj').innerHTML = `<span style="color:var(--success); font-weight:bold;">${p}</span>`;
        }

        const autoBotLevel = document.getElementById('autoBotLevelEdit').value;
            // Auto Bot Streaming
            const consoleDiv = document.getElementById('autoBotConsoleEdit');
            const logDiv = document.getElementById('autoBotLogEdit');
            const statusSpan = document.getElementById('autoBotStatusEdit');
            
            consoleDiv.style.display = 'block';
            logDiv.innerHTML = '';
            statusSpan.innerText = 'Running...';
            statusSpan.style.color = 'var(--warning)';
            
            try {
                const response = await fetch(BACKEND_API_URL + '/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        goal: rawContext,
                        model: model,
                        system_prompt: systemPrompt,
                        lm_url: lmUrl,
                        level: autoBotLevel
                    })
                });
                
                if (!response.ok) throw new Error("API Fehler");
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let buffer = "";
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop();
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '');
                            try {
                                const payload = JSON.parse(dataStr);
                                if (payload.event === 'log' || payload.event === 'experts' || payload.event === 'draft' || payload.event === 'review') {
                                    const logEntry = document.createElement('div');
                                    logEntry.innerHTML = `<span style="color:#64748b;">[AutoBot]</span> ${payload.message}`;
                                    logDiv.appendChild(logEntry);
                                    logDiv.scrollTop = logDiv.scrollHeight;
                                } else if (payload.event === 'final') {
                                    const logEntry = document.createElement('div');
                                    logEntry.innerHTML = `<span style="color:var(--success);">[AutoBot]</span> ${payload.message}`;
                                    logDiv.appendChild(logEntry);
                                    logDiv.scrollTop = logDiv.scrollHeight;
                                    
                                    statusSpan.innerText = 'Completed';
                                    statusSpan.style.color = 'var(--success)';
                                    
                                    const res = extractJSON(payload.content);
                                    applyEditResult(res);
                                    showToast("Edit Auto Bot Prompt erfolgreich generiert!");
                                }
                            } catch (err) {
                                console.error("Error parsing SSE JSON:", err);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(e.message);
                showToast("Fehler: " + e.message, true); 
                statusSpan.innerText = 'Failed';
                statusSpan.style.color = 'var(--danger)';
            }
            btn.disabled = false; spinner.style.display = 'none';
    }

    async function optimizeCinePrompt() {
        const btn = document.getElementById('optimizeCineBtn');
        const spinner = document.getElementById('cineSpinner');
        btn.disabled = true; spinner.style.display = 'inline-block';

        const ci = nanoState.cine;
        const rawContext = `Mode: ${ci.mode === 'edit' ? "EDIT EXISTING IMAGE" : "NEW GENERATION"}\nScene: ${ci.scene || "Not specified"}\nCamera: ${ci.cam}, Lens: ${ci.lens}\nSettings: ${ci.focal}, ${ci.aperture}\nFraming: ${ci.moves.join(', ')}`;
        
        const autoBotLevel = document.getElementById('autoBotLevelCine').value;
        const model = document.getElementById('modelSelectCine').value;
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;

        const systemPrompt = `Du bist ein Experte für das Optimieren von Bild-Prompts für Diffusionsmodelle (wie Stable Diffusion / Midjourney). Deine Aufgabe ist es, den bereitgestellten Prompt des Nutzers zu verbessern, ohne jedoch den Kern, die Komposition oder den Charakter der ursprünglichen Szene zu verändern.

Halte dich strikt an folgende Regeln:

1. KEIN OVER-ENGINEERING (Kein Text-Rauschen): Erfinde keine unnötigen neuen Bildelemente, Kleidungsstücke oder Hintergrunddetails hinzu, die der Nutzer nicht genannt hat.
2. STRUKTUR: Ordne den optimierten Prompt streng nach dem Prinzip: [Subjekt] -> [Aktion/Pose] -> [Umgebung/Hintergrund] -> [Kamera-Spezifikationen/Licht].
3. SPRACHE: Übersetze die Szene komplett ins Englische, da Bild-KIs das präziser verarbeiten können.
4. KEINE WIDERSPRÜCHLICHEN NEGATIVES: Halte den Negative Prompt sauber und fokussiert auf Qualität und Anatomie. Liste dort KEINE Kleidungsstücke oder Objekte auf, die einfach nur nicht im Bild sein sollen.
5. FOKUS AUF REALISMUS: Nutze präzise Kamera-Begriffe statt schwammiger Wörter wie "photorealistic".

Ausgabe-Format:
Du musst die Antwort als valides JSON-Objekt zurückgeben. Das JSON MUSS folgende Struktur haben:
{
  "cinema_workflow": {
    "intent": "Short summary of the visual goal",
    "rig_details": "Camera and lens configuration string, combining the camera model and lens choice with focal length and aperture",
    "light_setup": "Lighting and atmospheric description in high cinematic detail (e.g. volumetric neon key light, Rembrandt fill, soft golden rim light)"
  },
  "prompts": {
    "technical_prompt": "Prompt focused on camera technicalities, film stock emulation, grain, color grading, and lens effects",
    "scene_prompt": "Prompt focused on the character description, environment, mood, and weather",
    "final_prompt": "Integrated cinematic prompt combining technical and scene aspects with aspect ratio parameters (e.g., --ar 16:9)"
  }
}`;
        
        function applyCineResult(res) {
            document.getElementById('out-cine-tech').innerHTML = `
                <b>Intent:</b> ${res.cinema_workflow?.intent || ""}<br>
                <b>Rig:</b> ${res.cinema_workflow?.rig_details || ""}<br>
                <b>Lighting:</b> ${res.cinema_workflow?.light_setup || ""}
            `;
            document.getElementById('out-cine-scene').innerText = res.prompts?.scene_prompt || "";
            document.getElementById('out-cine-final').textContent = JSON.stringify(res, null, 2);
            Prism.highlightElement(document.getElementById('out-cine-final'));
        }

            // Auto Bot Streaming
            const consoleDiv = document.getElementById('autoBotConsoleCine');
            const logDiv = document.getElementById('autoBotLogCine');
            const statusSpan = document.getElementById('autoBotStatusCine');
            
            consoleDiv.style.display = 'block';
            logDiv.innerHTML = '';
            statusSpan.innerText = 'Running...';
            statusSpan.style.color = 'var(--warning)';
            
            try {
                const response = await fetch(BACKEND_API_URL + '/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        goal: rawContext,
                        model: model,
                        system_prompt: systemPrompt,
                        lm_url: lmUrl,
                        level: autoBotLevel
                    })
                });
                
                if (!response.ok) throw new Error("API Fehler");
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let buffer = "";
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop(); // Keep incomplete chunk in buffer
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '');
                            try {
                                const payload = JSON.parse(dataStr);
                                if (payload.event === 'log' || payload.event === 'experts' || payload.event === 'draft' || payload.event === 'review') {
                                    const logEntry = document.createElement('div');
                                    logEntry.innerHTML = `<span style="color:#64748b;">[AutoBot]</span> ${payload.message}`;
                                    logDiv.appendChild(logEntry);
                                    logDiv.scrollTop = logDiv.scrollHeight;
                                } else if (payload.event === 'final') {
                                    const logEntry = document.createElement('div');
                                    logEntry.innerHTML = `<span style="color:var(--success);">[AutoBot]</span> ${payload.message}`;
                                    logDiv.appendChild(logEntry);
                                    logDiv.scrollTop = logDiv.scrollHeight;
                                    
                                    statusSpan.innerText = 'Completed';
                                    statusSpan.style.color = 'var(--success)';
                                    
                                    const res = extractJSON(payload.content);
                                    applyCineResult(res);
                                    showToast("Cinema Auto Bot JSON erfolgreich generiert!");
                                }
                            } catch (err) {
                                console.error("Error parsing SSE JSON:", err);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(e.message);
                showToast("Fehler: " + e.message, true); 
                statusSpan.innerText = 'Failed';
                statusSpan.style.color = 'var(--danger)';
            }
            btn.disabled = false; spinner.style.display = 'none';
    }

    const cineData = {
        shotSize: {
            title: "Shot Size & Framing",
            desc: "Wie viel vom Subjekt ist im Bild zu sehen?",
            items: [
                { id: "extreme-long-shot", label: "Extreme Long Shot", desc: "Subjekt winzig, Landschaft dominiert.", promptTag: "extreme long shot, massive landscape" },
                { id: "long-shot", label: "Long Shot / Full Body", desc: "Ganze Person von Kopf bis Fuß sichtbar.", promptTag: "full body shot, long shot" },
                { id: "medium-shot", label: "Medium Shot", desc: "Schnitt ab Hüfte. Standard für Portraits.", promptTag: "medium shot, waist up portrait" },
                { id: "close-up", label: "Close Up", desc: "Nur Kopf und Schultern. Fokus auf Gesicht.", promptTag: "close up portrait, detailed face" },
                { id: "extreme-close-up", label: "Macro / Detail", desc: "Winziges Detail füllt das Bild (Auge, Insekt).", promptTag: "macro photography, extreme close up on [detail]" }
            ]
        },
        cameraAngle: {
            title: "Camera Angle & Perspective",
            desc: "Aus welcher Höhe schaut die Kamera?",
            items: [
                { id: "eye-level", label: "Eye Level", desc: "Neutrale Augenhöhe.", promptTag: "eye level shot, straight on view" },
                { id: "low-angle", label: "Low Angle", desc: "Blick von unten nach oben. Wirkt mächtig/heldenhaft.", promptTag: "low angle shot, looking up at subject, worm's eye view" },
                { id: "high-angle", label: "High Angle", desc: "Blick von oben herab. Subjekt wirkt klein.", promptTag: "high angle shot, looking down from above" },
                { id: "top-down", label: "Top Down / Overhead", desc: "Senkrecht von oben (Vogelperspektive, Flat Lay).", promptTag: "top down view, directly above, flat lay composition" }
            ]
        },
        focusAndMotion: {
            title: "Focus, Depth & Motion",
            desc: "Wie sind Schärfe und Bewegung im Standbild dargestellt?",
            items: [
                { id: "shallow-depth", label: "Bokeh / Shallow Depth", desc: "Unscharfer Hintergrund, Subjekt scharf isoliert.", promptTag: "shallow depth of field, bokeh background, sharp focus on subject" },
                { id: "deep-focus", label: "Deep Focus", desc: "Alles von vorne bis hinten ist scharf.", promptTag: "deep focus, sharp background, everything in focus" },
                { id: "frozen-action", label: "Frozen Action", desc: "Eingefrorene Bewegung, hohe Verschlusszeit.", promptTag: "frozen action shot, high shutter speed, mid-air" },
                { id: "motion-blur", label: "Motion Blur / Long Exposure", desc: "Verwischte Bewegung durch Langzeitbelichtung.", promptTag: "long exposure, motion blur streaks, sense of speed" }
            ]
        },
        lighting: {
            title: "Lighting & Mood",
            desc: "Die wichtigste Zutat für Stimmung in Bildern.",
            items: [
                { id: "golden-hour", label: "Golden Hour", desc: "Warmes, weiches Licht bei Sonnenauf-/untergang.", promptTag: "golden hour lighting, warm soft light, sunset glow" },
                { id: "cinematic-dark", label: "Cinematic / Moody", desc: "Dunkel, dramatisch, starke Schatten (Chiaroscuro).", promptTag: "cinematic lighting, moody, dramatic shadows, chiaroscuro" },
                { id: "softbox", label: "Soft / Studio Light", desc: "Weiches, schmeichelhaftes Licht ohne harte Schatten.", promptTag: "soft studio lighting, diffused light, flattering" },
                { id: "neon-noir", label: "Neon / Cyberpunk", desc: "Bunte Neonlichter in dunkler Umgebung.", promptTag: "neon lighting, cyberpunk atmosphere, colored gels" },
                { id: "natural-light", label: "Natural Window Light", desc: "Realistisches Tageslicht, das durch ein Fenster fällt.", promptTag: "natural window light, documentary style" }
            ]
        },
        aesthetics: {
            title: "Aesthetics & Composition",
            desc: "Spezielle visuelle Stile und Anordnungen.",
            items: [
                { id: "symmetry", label: "Symmetrical Center", desc: "Perfekt mittig und symmetrisch (Wes Anderson Stil).", promptTag: "centered composition, symmetrical balance" },
                { id: "film-grain", label: "Analog Film Look", desc: "Sieht aus wie ein echtes Foto auf Film, nicht digital.", promptTag: "analog film photography, film grain, vintage photo look" },
                { id: "candid", label: "Candid / Documentary", desc: "Ungestellter Schnappschuss-Look, authentisch.", promptTag: "candid street photography, raw, documentary style, unposed" },
                { id: "minimalist", label: "Minimalist / Negative Space", desc: "Sehr wenig Inhalt, viel leerer Raum.", promptTag: "minimalist composition, lots of negative space, clean" },
                { id: "pov", label: "First Person POV", desc: "Aus den Augen des Betrachters.", promptTag: "first person POV, looking at hands" }
            ]
        }
    };

    function initCineModule() {
        const container = document.getElementById('chip-container');
        const infoPanel = document.getElementById('selection-info');
        const infoTitle = document.getElementById('info-title');
        const infoDesc = document.getElementById('info-desc');
        const infoEx = document.getElementById('info-example');
        
        const debouncedUpdateNano = debounce(updateNanoPrompts, 300);

        container.innerHTML = "";

        for (const [categoryName, categoryData] of Object.entries(cineData)) {
            const catDiv = document.createElement('div');
            catDiv.className = 'cine-category';
            
            const title = document.createElement('div');
            title.className = 'cine-cat-title';
            title.innerText = categoryData.title; 
            catDiv.appendChild(title);

            const wrapper = document.createElement('div');
            wrapper.className = 'chip-wrapper';

            categoryData.items.forEach(item => { 
                const btn = document.createElement('button');
                btn.className = 'cine-chip';
                btn.innerText = item.label;
                btn.setAttribute('type', 'button'); 
                btn.dataset.cam = item.label; 
                
                btn.addEventListener('click', (e) => {
                    const isActive = btn.classList.contains('active');
                    btn.classList.toggle('active');

                    const val = item.label;
                    if (!isActive) {
                        nanoState.cine.moves.push(val);
                        infoTitle.innerText = `💡 ${item.label}`;
                        infoDesc.innerText = item.desc;
                        infoEx.innerText = `Prompt Tag: "${item.promptTag}"`; 
                         infoPanel.classList.add('visible');
                    } else {
                        nanoState.cine.moves = nanoState.cine.moves.filter(x => x !== val);
                    }
                    debouncedUpdateNano();
                });
 
                wrapper.appendChild(btn);
            });
 
            catDiv.appendChild(wrapper);
            container.appendChild(catDiv);
        }
    }
 
    /* =========================================
       VEO 3.1 PRO STUDIO INTEGRATION
       ========================================= */
    window.switchCineSub = function(tabId) {
        const rigBtn = document.getElementById('subTabCineBtn');
        const veoBtn = document.getElementById('subTabVeoBtn');
        const camDirBtn = document.getElementById('subTabCamDirBtn');
        const rigContent = document.getElementById('cineRigContent');
        const veoContent = document.getElementById('veoStudioContent');
        const camDirContent = document.getElementById('cameraDirectorContent');
        
        if(rigBtn) rigBtn.style.background = 'transparent';
        if(veoBtn) veoBtn.style.background = 'transparent';
        if(camDirBtn) camDirBtn.style.background = 'transparent';
        
        if(rigContent) rigContent.style.display = 'none';
        if(veoContent) veoContent.style.display = 'none';
        if(camDirContent) camDirContent.style.display = 'none';

        if (tabId === 'cine-rig') {
            if(rigBtn) rigBtn.style.background = 'var(--primary)';
            if(rigContent) rigContent.style.display = 'grid';
        } else if (tabId === 'veo-studio') {
            if(veoBtn) veoBtn.style.background = 'var(--primary)';
            if(veoContent) veoContent.style.display = 'flex';
        } else if (tabId === 'camera-director') {
            if(camDirBtn) camDirBtn.style.background = 'var(--primary)';
            if(camDirContent) camDirContent.style.display = 'grid';
            if(window.renderCamDirectorPrompts) window.renderCamDirectorPrompts();
        }
    };

    window.getVeoFields = function() {
        return {
            Subjekt: document.getElementById('veo_subject').value.trim() || "[LEER]",
            Aktion: document.getElementById('veo_action').value.trim() || "[LEER]",
            FX: document.getElementById('veo_fx').value.trim() || "[LEER]",
            Setting: document.getElementById('veo_setting').value.trim() || "[LEER]",
            Kamera: document.getElementById('veo_camera').value.trim() || "[LEER]",
            Audio: document.getElementById('veo_sound').value.trim() || "[LEER]"
        };
    };

    window.applyVeoSuggestion = function(encodedText, btnElement) {
        const text = decodeURIComponent(encodedText);
        const lines = text.split('\n');
        
        lines.forEach(line => {
            const lowerLine = line.toLowerCase();
            const extractValue = (keyword) => {
                let idx = lowerLine.indexOf(keyword + ':');
                if (idx !== -1) {
                    let val = line.substring(lowerLine.indexOf(keyword + ':') + keyword.length + 1);
                    return val.replace(/\*\*/g, '').replace(/^-?\s*/, '').trim();
                }
                return null;
            };

            let subj = extractValue('subjekt'); if(subj) document.getElementById('veo_subject').value = subj;
            let act = extractValue('aktion');   if(act) document.getElementById('veo_action').value = act;
            let fx = extractValue('fx');        if(fx) document.getElementById('veo_fx').value = fx;
            let set = extractValue('setting');  if(set) document.getElementById('veo_setting').value = set;
            let cam = extractValue('kamera');   if(cam) document.getElementById('veo_camera').value = cam;
            let aud = extractValue('audio');    if(aud) document.getElementById('veo_sound').value = aud;
        });

        btnElement.innerText = "✅ Erfolgreich eingefügt!";
        btnElement.style.background = "var(--success)";
        btnElement.disabled = true;
    };

    window.generateVeoPrompt = async function() {
        const aiBtn = document.getElementById('veoAiBtn');
        const spinner = document.getElementById('veoSpinner');
        const vals = getVeoFields();
        
        if (vals.Subjekt === "[LEER]" && vals.Aktion === "[LEER]") {
            showToast("Mindestens Subjekt und Aktion müssen ausgefüllt sein!", true);
            return;
        }

        aiBtn.disabled = true;
        spinner.style.display = 'inline-block';
        document.getElementById('veo-output-container').style.display = 'none';

        vals.Stil = document.getElementById('veo_style').value;
        const autoBotLevel = document.getElementById('autoBotLevelVeo').value;
        const model = document.getElementById('modelSelectVeo').value;
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;

        const systemPrompt = `Du bist ein professioneller Prompt-Engineer für die High-End Video-KI 'Veo 3.1'.
Deine Aufgabe ist es, die strukturierten Stichpunkte des Nutzers in einen einzigen, fließenden, hochgradig beschreibenden englischen Absatz zu verwandeln.

Befolge beim Schreiben zwingend diese erzählerische Struktur:
1. Beginne mit dem visuellen Stil und der Kamera (z.B. "Photorealistic cinematic tracking shot of...").
2. Beschreibe das Subjekt und seine physische Aktion.
3. Integriere die Umweltinteraktion (wie Staub, Lichtbrechung, Physik).
4. Beende den Prompt mit dem Sound Design (z.B. "...accompanied by the sound of heavy breathing").

REGELN:
- Verwende professionelle Kamera- und Beleuchtungs-Terminologie.
- Vermeide Klischees.
- Antworte AUSSCHLIESSLICH mit dem finalen englischen Text. Keine Begrüßung, keine Bestätigung.`;

        const structuredInput = `Bitte erstelle einen nahtlosen Veo 3.1 Prompt aus diesen Elementen:
- Subjekt: ${vals.Subjekt}
- Aktion/Bewegung: ${vals.Aktion}
- Umwelt/Effekte: ${vals.FX}
- Setting/Beleuchtung: ${vals.Setting}
- Kameraführung: ${vals.Kamera}
- Sound Design: ${vals.Audio}
- Ästhetischer Stil: ${vals.Stil}`;

            // Auto Bot mode
            const consoleDiv = document.getElementById('autoBotConsoleVeo');
            const logDiv = document.getElementById('autoBotLogVeo');
            const statusSpan = document.getElementById('autoBotStatusVeo');
            
            consoleDiv.style.display = 'block';
            logDiv.innerHTML = '';
            statusSpan.innerText = 'Running...';
            statusSpan.style.color = 'var(--warning)';
            
            try {
                const response = await fetch(BACKEND_API_URL + '/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        goal: structuredInput,
                        model: model,
                        system_prompt: systemPrompt,
                        lm_url: lmUrl,
                        level: autoBotLevel
                    })
                });
                
                if (!response.ok) throw new Error("API Fehler");
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let buffer = "";
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop();
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const dataStr = line.replace('data: ', '');
                            try {
                                const payload = JSON.parse(dataStr);
                                if (payload.event === 'log' || payload.event === 'experts' || payload.event === 'draft' || payload.event === 'review') {
                                    const logEntry = document.createElement('div');
                                    logEntry.innerHTML = `<span style="color:#64748b;">[AutoBot]</span> ${payload.message}`;
                                    logDiv.appendChild(logEntry);
                                    logDiv.scrollTop = logDiv.scrollHeight;
                                } else if (payload.event === 'final') {
                                    const logEntry = document.createElement('div');
                                    logEntry.innerHTML = `<span style="color:var(--success);">[AutoBot]</span> ${payload.message}`;
                                    logDiv.appendChild(logEntry);
                                    logDiv.scrollTop = logDiv.scrollHeight;
                                    
                                    statusSpan.innerText = 'Completed';
                                    statusSpan.style.color = 'var(--success)';
                                    
                                    let cleanContent = payload.content.replace(/^["']|["']$/g, '').replace(/^(Here is the prompt:|Prompt:)/i, '').trim();
                                    document.getElementById('veoFinalPrompt').innerText = cleanContent;
                                    document.getElementById('veo-output-container').style.display = 'block';
                                    showToast("Veo Auto Bot Prompt erfolgreich erstellt!");
                                }
                            } catch (err) {
                                console.error("Error parsing SSE JSON:", err);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(e);
                showToast("Fehler: " + e.message, true);
                statusSpan.innerText = 'Failed';
                statusSpan.style.color = 'var(--danger)';
            } finally {
                aiBtn.disabled = false;
                spinner.style.display = 'none';
            }
    };

    window.copyVeoToClipboard = function() {
        navigator.clipboard.writeText(document.getElementById('veoFinalPrompt').innerText);
        showToast("Veo 3.1 Prompt in die Zwischenablage kopiert! 📋");
    };

    window.askVeoAdv = async function() {
        const input = document.getElementById('veoAdvInput');
        const chat = document.getElementById('veoChatBox');
        const btn = document.getElementById('veoAdvBtn');
        const q = input.value.trim();
        if (!q) return;

        chat.innerHTML += `<div class="msg user" style="padding:10px 14px; border-radius:8px; line-height:1.4; max-width:90%; background:var(--primary); color:white; align-self:flex-end;">${q}</div>`;
        input.value = "";
        chat.scrollTop = chat.scrollHeight;
        
        btn.disabled = true;
        const tempId = "load-" + Date.now();
        chat.innerHTML += `<div class="msg ai" id="${tempId}" style="padding:10px 14px; border-radius:8px; line-height:1.4; max-width:90%; background:var(--bg-input); border:1px solid var(--border-color); align-self:flex-start; color:var(--text-main);"><em>Ich überlege...</em></div>`;
        chat.scrollTop = chat.scrollHeight;

        const currentVals = getVeoFields();
        const model = document.getElementById('modelSelectVeo').value;
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;
        
        const copilotInst = `Du bist ein erfahrener Veo 3.1 Regie-Copilot. Der Nutzer plant ein KI-Video.
Aktuelle Formular-Felder: ${JSON.stringify(currentVals)}. 

Deine Aufgabe:
Liefere passend zur Idee des Nutzers sofort anwendbare, kreative Stichpunkte für die [LEER] gebliebenen Felder. 
Antworte zwingend in dieser Struktur (auf Deutsch):

💡 **Mein Vorschlag für dich:**
- **Subjekt:** (Dein Vorschlag)
- **Aktion:** (Dein Vorschlag)
- **FX:** (Dein Vorschlag)
- **Setting:** (Dein Vorschlag)
- **Kamera:** (Dein Vorschlag)
- **Audio:** (Dein Vorschlag)

(Lasse Felder weg, die der Nutzer bereits ausgefüllt hat, es sei denn, er fragt nach einer Überarbeitung).
Sei präzise, filmisch und extrem kreativ. Keine langen Erklärungen, nur direkte Inspiration!`;

        try {
            const res = await fetch(BACKEND_API_URL + '/api/optimize', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    goal: q,
                    model: model,
                    system_prompt: copilotInst,
                    lm_url: lmUrl
                })
            });
            if (!res.ok) throw new Error("API Fehler");
            const data = await res.json();
            
            let reply = data.optimized_goal || "Ich konnte leider keine Antwort formulieren.";
            
            const loadEl = document.getElementById(tempId);
            if (loadEl) loadEl.remove();
            
            let formattedReply = reply.trim()
                .replace(/\n/g, "<br>")
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            
            let encodedReply = encodeURIComponent(reply);
            let autoFillBtn = `<br><button class="btn-autofill" onclick="applyVeoSuggestion('${encodedReply}', this)" style="background:var(--primary); color:white; border:none; padding:8px 12px; border-radius:4px; margin-top:10px; cursor:pointer; font-size:0.85rem; font-weight:bold;">⚡ Formular damit füllen</button>`;
            
            chat.innerHTML += `<div class="msg ai" style="padding:10px 14px; border-radius:8px; line-height:1.4; max-width:90%; background:var(--bg-input); border:1px solid var(--border-color); align-self:flex-start; color:var(--text-main);">${formattedReply}${autoFillBtn}</div>`;
            chat.scrollTop = chat.scrollHeight;
            
        } catch (e) { 
            const loadEl = document.getElementById(tempId);
            if (loadEl) loadEl.remove();
            chat.innerHTML += `<div class="msg ai" style="padding:10px 14px; border-radius:8px; line-height:1.4; max-width:90%; background:var(--bg-input); border:1px solid var(--border-color); align-self:flex-start; color:var(--danger);">Server-Verbindung fehlgeschlagen. Läuft der Server auf Port 5080?</div>`; 
        } finally {
            btn.disabled = false;
        }
    };

    /* =========================================
       BOOTSTRAP
       ========================================= */
    window.onload = () => {
        let savedUrl = localStorage.getItem('lm_studio_url');
        if(!savedUrl || savedUrl === "") {
            savedUrl = HARDCODED_URL;
        }
        document.getElementById('apiUrl').value = savedUrl;
        
        updateKeyStatus();
        // Set interval to check status periodically
        setInterval(updateKeyStatus, 15000);
        renderGenForm(); 
        initNano(); 
        initCineModule(); 
        updateNanoPrompts();
        updateRes(); 
        switchTab('gen'); 
        
        if(window.initCameraDirector) {
            window.initCameraDirector();
        }
    };

    /* =========================================
       AI CAMERA DIRECTOR INTEGRATION
       ========================================= */
    const cameraPrompts = [
        // --- PAN / TILT ---
        { id: "static_shot", category: "pan_tilt", title: "Static shot", prompt: "locked-off static shot. Movement: hold one fixed camera position for the full clip. Speed: still and steady. Framing: keep the same angle, height, lens distance and composition. End: finish with the same framing and camera position.", anim: "static" },
        { id: "pan_right", category: "pan_tilt", title: "Pan right", prompt: "pan right. Movement: rotate the camera horizontally from left to right from one fixed point. Speed: smooth constant rotation. Framing: keep the horizon level while new space enters from the right side of the frame. End: settle on a clear final composition.", anim: "pan-right" },
        { id: "pan_left", category: "pan_tilt", title: "Pan left", prompt: "pan left. Movement: rotate the camera horizontally from right to left from one fixed point. Speed: smooth constant rotation. Framing: keep the horizon level while new space enters from the left side of the frame. End: settle on a clear final composition.", anim: "pan-left" },
        { id: "whip_pan_right", category: "pan_tilt", title: "Whip pan right", prompt: "whip pan right. Movement: rotate rapidly from the starting direction toward a new target on the right. Speed: fast snap with brief motion blur during the rotation. Framing: begin on one readable composition and land on a second readable target. End: settle into a sharp final frame.", anim: "whip-pan-right" },
        { id: "whip_pan_left", category: "pan_tilt", title: "Whip pan left", prompt: "whip pan left. Movement: rotate rapidly from the starting direction toward a new target on the left. Speed: fast snap with brief motion blur during the rotation. Framing: begin on one readable composition and land on a second readable target. End: settle into a sharp final frame.", anim: "whip-pan-left" },
        { id: "tilt_up", category: "pan_tilt", title: "Tilt up", prompt: "tilt up. Movement: rotate the camera upward from one fixed point. Speed: smooth constant tilt. Framing: keep the vertical subject or architecture centered as the frame travels upward. End: land on the upper target.", anim: "tilt-up" },
        { id: "tilt_down", category: "pan_tilt", title: "Tilt down", prompt: "tilt down. Movement: rotate the camera downward from one fixed point. Speed: smooth constant tilt. Framing: keep the vertical subject or architecture centered as the frame travels downward. End: land on the lower target.", anim: "tilt-down" },

        // --- ZOOM / LENS ---
        { id: "slow_zoom_in", category: "zoom_lens", title: "Slow zoom in", prompt: "slow zoom in. Movement: slowly increase lens focal length toward a tighter frame. Speed: gradual and even. Framing: keep the main visual target readable as it becomes larger in frame. End: finish on a stable tighter composition.", anim: "zoom-in-slow" },
        { id: "slow_zoom_out", category: "zoom_lens", title: "Slow zoom out", prompt: "slow zoom out. Movement: slowly decrease lens focal length toward a wider frame. Speed: gradual and even. Framing: keep the main visual target readable as more surrounding space appears. End: finish on a stable wider composition.", anim: "zoom-out-slow" },
        { id: "fast_zoom_in", category: "zoom_lens", title: "Fast zoom in", prompt: "fast zoom in. Movement: quickly increase lens focal length toward the main visual target. Speed: quick decisive zoom. Framing: keep the target centered or clearly readable during the scale change. End: finish on a stable tighter composition.", anim: "zoom-in-fast" },
        { id: "fast_zoom_out", category: "zoom_lens", title: "Fast zoom out", prompt: "fast zoom out. Movement: quickly decrease lens focal length away from the main visual target. Speed: quick decisive zoom. Framing: keep the target readable as the surrounding space appears. End: finish on a stable wider composition.", anim: "zoom-out-fast" },
        { id: "crash_zoom_in", category: "zoom_lens", title: "Crash zoom in", prompt: "crash zoom in. Movement: snap the lens rapidly toward the main visual target. Speed: very fast and punchy. Framing: keep the target readable through the sudden scale change. End: land on a bold tighter composition.", anim: "crash-in" },
        { id: "crash_zoom_out", category: "zoom_lens", title: "Crash zoom out", prompt: "crash zoom out. Movement: snap the lens rapidly away from the main visual target. Speed: very fast and punchy. Framing: keep the target readable as the surrounding space appears. End: land on a bold wider composition.", anim: "crash-out" },

        // --- DOLLY / TRACK ---
        { id: "dolly_in", category: "dolly_track", title: "Dolly in", prompt: "dolly in. Movement: move the camera physically forward in a straight line toward the main subject. Speed: smooth controlled push. Framing: keep camera height, lens direction and subject position consistent while distance closes. End: finish in a tighter composition.", anim: "dolly-in" },
        { id: "dolly_out", category: "dolly_track", title: "Dolly out", prompt: "dolly out. Movement: move the camera physically backward in a straight line away from the main subject. Speed: smooth controlled retreat. Framing: keep lens direction and camera height consistent while more environment enters frame. End: finish in a wider composition.", anim: "dolly-out" },
        { id: "tracking_shot", category: "dolly_track", title: "Tracking shot", prompt: "tracking shot. Movement: move through the scene with the main subject. Speed: match the subject's pace. Framing: keep the subject consistently readable while the environment moves around them. End: maintain a clear moving composition.", anim: "tracking" },
        { id: "follow_shot", category: "dolly_track", title: "Follow shot / Over-the-shoulder", prompt: "follow shot from behind. Movement: move behind the subject along their route at shoulder height. Speed: match the subject's pace. Framing: keep the back, shoulder or head as the foreground guide while the route ahead stays readable. End: continue following with the subject leading the frame.", anim: "follow" },
        { id: "reverse_tracking", category: "dolly_track", title: "Reverse tracking", prompt: "reverse tracking shot. Movement: move backward in front of the walking subject. Speed: match the subject's forward pace. Framing: keep front-facing face and body framing stable as the background moves behind them. End: hold a clear front-facing moving composition.", anim: "reverse-track" },
        { id: "side_tracking", category: "dolly_track", title: "Side tracking", prompt: "side tracking shot. Movement: move parallel beside the subject along their direction of travel. Speed: match the subject's motion. Framing: keep the subject in side profile or three-quarter profile at a stable distance. End: continue the parallel movement with clear horizontal motion.", anim: "side-track" },
        { id: "low_tracking", category: "dolly_track", title: "Low tracking", prompt: "low tracking shot. Movement: move at ground or below-waist height alongside the subject's movement path. Speed: match the subject, footsteps or wheels. Framing: keep the low detail readable while the ground plane moves through frame. End: finish with the low perspective clearly maintained.", anim: "low-track" },
        { id: "vehicle_tracking", category: "dolly_track", title: "Vehicle tracking", prompt: "vehicle tracking shot. Movement: move with the vehicle along its route. Speed: match the vehicle's pace. Framing: keep the vehicle stable in frame while the road or environment moves past. End: maintain a clear moving vehicle composition.", anim: "vehicle-track" },
        { id: "chase_shot", category: "dolly_track", title: "Chase shot", prompt: "chase shot. Movement: follow a moving subject quickly along the action route. Speed: fast, reactive and physically close. Framing: keep the subject visible while allowing energetic reframing. End: stay connected to the subject in motion.", anim: "chase" },

        // --- PHYSICAL MOVES ---
        { id: "truck_right", category: "physical_moves", title: "Truck right", prompt: "truck right. Movement: move the camera physically to the right on a straight horizontal path. Speed: smooth constant lateral travel. Framing: keep the lens facing the same direction while the scene slides across frame. End: finish on a clean lateral composition.", anim: "truck-right" },
        { id: "truck_left", category: "physical_moves", title: "Truck left", prompt: "truck left. Movement: move the camera physically to the left on a straight horizontal path. Speed: smooth constant lateral travel. Framing: keep the lens facing the same direction while the scene slides across frame. End: finish on a clean lateral composition.", anim: "truck-left" },
        { id: "pedestal_up", category: "physical_moves", title: "Pedestal up", prompt: "pedestal up. Movement: move the entire camera vertically upward in a straight line. Speed: smooth constant lift. Framing: keep the lens level and pointed in the same direction during the vertical move. End: finish with the higher framing clearly readable.", anim: "pedestal-up" },
        { id: "pedestal_down", category: "physical_moves", title: "Pedestal down", prompt: "pedestal down. Movement: move the entire camera vertically downward in a straight line. Speed: smooth constant descent. Framing: keep the lens level and pointed in the same direction during the vertical move. End: finish with the lower framing clearly readable.", anim: "pedestal-down" },
        { id: "slider_right", category: "physical_moves", title: "Slider right", prompt: "slider right. Movement: slide the camera a small distance to the right. Speed: slow controlled constant motion. Framing: keep foreground, subject and background layers readable as parallax shifts. End: finish on a refined composition with the new right-side angle visible.", anim: "slider-right" },
        { id: "slider_left", category: "physical_moves", title: "Slider left", prompt: "slider left. Movement: slide the camera a small distance to the left. Speed: slow controlled constant motion. Framing: keep foreground, subject and background layers readable as parallax shifts. End: finish on a refined composition with the new left-side angle visible.", anim: "slider-left" },
        { id: "push_past", category: "physical_moves", title: "Push past", prompt: "push past. Movement: move forward past a visible foreground object, edge or opening. Speed: smooth forward glide. Framing: let the foreground pass close to the lens while the space beyond becomes clearer. End: arrive inside or beyond the foreground layer.", anim: "push-past" },
        { id: "arc_right", category: "physical_moves", title: "Arc right", prompt: "arc right. Movement: move on a shallow curved path around the main subject toward the right side. Speed: smooth measured curve. Framing: keep distance, height and subject readability consistent while the angle changes. End: finish from a new right-side angle.", anim: "arc-right" },
        { id: "arc_left", category: "physical_moves", title: "Arc left", prompt: "arc left. Movement: move on a shallow curved path around the main subject toward the left side. Speed: smooth measured curve. Framing: keep distance, height and subject readability consistent while the angle changes. End: finish from a new left-side angle.", anim: "arc-left" },
        { id: "orbit_clockwise", category: "physical_moves", title: "Orbit clockwise", prompt: "clockwise orbit. Movement: circle clockwise around the main subject at a consistent radius. Speed: smooth controlled orbit. Framing: keep the subject centered while the background rotates around them. End: complete the intended arc or full circle with stable framing.", anim: "orbit-cw" },
        { id: "orbit_counterclockwise", category: "physical_moves", title: "Orbit counterclockwise", prompt: "counterclockwise orbit. Movement: circle counterclockwise around the main subject at a consistent radius. Speed: smooth controlled orbit. Framing: keep the subject centered while the background rotates around them. End: complete the intended arc or full circle with stable framing.", anim: "orbit-ccw" },

        // --- HUMAN CAMERA ---
        { id: "handheld_shot", category: "human_camera", title: "Handheld shot", prompt: "handheld shot. Movement: hold the camera at human operator height with natural body movement. Speed: responsive and organic. Framing: keep the subject readable while the frame has subtle sway and micro-adjustments. End: finish with a natural handheld composition.", anim: "handheld" },
        { id: "body_mounted", category: "human_camera", title: "Body-mounted camera", prompt: "body-mounted Snorricam. Movement: keep the camera fixed relative to the subject's torso or face while the subject moves. Speed: match the subject's body motion. Framing: keep the subject close, centered and facing the camera as the background moves around them. End: finish with the subject still locked in frame.", anim: "snorricam" },

        // --- DRONE / CRANE ---
        { id: "crane_up", category: "drone_crane", title: "Crane up", prompt: "crane up. Movement: travel smoothly upward through open space. Speed: slow controlled vertical lift. Framing: keep the subject or location readable as the camera rises. End: finish with the higher scale clearly visible.", anim: "crane-up" },
        { id: "crane_down", category: "drone_crane", title: "Crane down", prompt: "crane down. Movement: travel smoothly downward through open space. Speed: slow controlled vertical descent. Framing: keep the subject or location readable as the camera descends. End: finish with the lower subject or destination clearly visible.", anim: "crane-down" },
        { id: "drone_push_in", category: "drone_crane", title: "Drone push in", prompt: "drone push in. Movement: fly smoothly forward through open space toward the subject or destination. Speed: controlled aerial glide. Framing: keep the route and destination readable as the camera approaches. End: arrive at a closer aerial composition.", anim: "drone-push" },
        { id: "drone_pull_back", category: "drone_crane", title: "Drone pull back", prompt: "drone pull back. Movement: fly smoothly backward away from the subject or destination. Speed: controlled aerial retreat. Framing: keep the subject readable as more landscape appears. End: finish on a wider aerial composition.", anim: "drone-pull" },
        { id: "helicopter_shot", category: "drone_crane", title: "Helicopter shot", prompt: "helicopter-style aerial shot. Movement: move from high altitude along a broad gradual flight path. Speed: steady controlled aerial motion. Framing: keep the landscape or distant moving subject readable at wide scale. End: finish on a stable high-altitude composition.", anim: "helicopter" },

        // --- SPECIALS ---
        { id: "first_person_view", category: "specials", title: "First-person view", prompt: "first-person view. Movement: move forward at human eye height from the character's perspective. Speed: natural walking or reaching pace. Framing: use visible hands, arms or body edges as the viewer's physical reference. End: arrive at the next point of action from the same point of view.", anim: "fpv" },
        { id: "tilt_shift", category: "specials", title: "Tilt-shift", prompt: "tilt-shift miniature view. Movement: hold or glide from a high angled view over the scene. Speed: small precise movement. Framing: keep a narrow band of sharp focus across the key subject area with soft blur above and below. End: finish with the miniature-scale view intact.", anim: "tilt-shift" },
        { id: "infinite_zoom", category: "specials", title: "Infinite zoom", prompt: "infinite zoom. Movement: zoom continuously inward toward the exact center target. Speed: smooth accelerating zoom. Framing: keep the circular target centered as it expands. End: finish when the next visual world fills the frame.", anim: "infinite-zoom" },
        { id: "earth_zoom_out", category: "specials", title: "Earth zoom out", prompt: "earth zoom out. Movement: pull upward from the starting point through street, city, landscape and planet scale. Speed: rapid expanding zoom out. Framing: keep the original location centered as scale grows. End: finish on a planet-scale view with the starting point still implied at center.", anim: "earth-zoom" },
        { id: "time_lapse", category: "specials", title: "Time-lapse", prompt: "locked-camera time-lapse. Movement: hold one fixed camera position while time moves rapidly forward. Speed: fast time compression with a stable camera. Framing: keep the same composition and horizon as motion passes through the frame. End: finish from the same camera angle with visible passage of time.", anim: "timelapse" },
        { id: "pass_through_objects", category: "specials", title: "Pass-through objects", prompt: "pass-through movement. Movement: move forward toward a visible object, surface or barrier and continue into the space beyond. Speed: smooth centered glide. Framing: keep the opening or surface centered as the transition point. End: arrive inside the revealed space beyond.", anim: "pass-through" }
    ];

    const cameraCategories = [
        { id: "all", label: "Alle Bewegungen", desc: "Alle 45 Kameraeinstellungen im schnellen Zugriff." },
        { id: "pan_tilt", label: "Pan / Tilt (Schwenken/Neigen)", desc: "Kamerabewegung von einer fixen Position aus." },
        { id: "zoom_lens", label: "Zoom / Lens (Brennweite)", desc: "Verändern der Linsen-Brennweite und Fokusbereiche." },
        { id: "dolly_track", label: "Dolly / Track (Schienen)", desc: "Physisches Mitbewegen der Kamera auf einer Achse oder mit dem Motiv." },
        { id: "physical_moves", label: "Physical Moves (Slider/Bogen)", desc: "Slider-Fahrten, Pedestal Hubbewegungen, Kurven- und Orbitalfahrten." },
        { id: "human_camera", label: "Human Camera (Menschlich)", desc: "Handheld, Snorricam und organische Ergo-Perspektiven." },
        { id: "drone_crane", label: "Drone / Crane (Drohne/Kran)", desc: "Vertikale Kranfahrten und weite Luftaufnahmen im Raum." },
        { id: "specials", label: "Specials (Effekte)", desc: "Kreative Effekte wie FPV, Tilt-Shift, Zeitraffer oder Infinite Zooms." }
    ];

    let camDirCurrentCategory = "all";
    let camDirSearchQuery = "";
    let camDirSelectedMovementId = null;
    let camDirSelectedRatio = "--ar 16:9";

    window.initCameraDirector = function() {
        const categoryList = document.getElementById("category-list");
        if(!categoryList) return;
        
        categoryList.innerHTML = "";
        cameraCategories.forEach(cat => {
            const li = document.createElement("li");
            li.style.padding = "10px";
            li.style.cursor = "pointer";
            li.style.borderRadius = "6px";
            li.style.transition = "background 0.2s";
            li.style.display = "flex";
            li.style.alignItems = "center";
            li.style.gap = "10px";
            if(cat.id === camDirCurrentCategory) {
                li.style.background = "rgba(255,255,255,0.1)";
                li.style.borderLeft = "3px solid var(--primary)";
            }
            
            let iconClass = "fa-solid fa-video";
            if (cat.id === "all") iconClass = "fa-solid fa-border-all";
            else if (cat.id === "pan_tilt") iconClass = "fa-solid fa-rotate-right";
            else if (cat.id === "zoom_lens") iconClass = "fa-solid fa-magnifying-glass-plus";
            else if (cat.id === "dolly_track") iconClass = "fa-solid fa-code-merge";
            else if (cat.id === "physical_moves") iconClass = "fa-solid fa-arrows-up-down-left-right";
            else if (cat.id === "human_camera") iconClass = "fa-solid fa-face-smile";
            else if (cat.id === "drone_crane") iconClass = "fa-solid fa-helicopter";
            else if (cat.id === "specials") iconClass = "fa-solid fa-wand-magic-sparkles";

            li.innerHTML = `<i class="${iconClass}" style="color:var(--text-muted); width:20px; text-align:center;"></i> <span style="font-size:0.85rem;">${cat.label.split(" (")[0]}</span>`;
            li.addEventListener("click", () => {
                camDirCurrentCategory = cat.id;
                document.getElementById("current-category-title").textContent = cat.label;
                document.getElementById("current-category-desc").textContent = cat.desc;
                window.initCameraDirector(); // re-render categories
                window.renderCamDirectorPrompts();
            });
            categoryList.appendChild(li);
        });

        // Set up search
        const searchInput = document.getElementById("search-input");
        const clearBtn = document.getElementById("clear-search");
        if(searchInput && !searchInput.dataset.initialized) {
            searchInput.dataset.initialized = "true";
            searchInput.addEventListener("input", (e) => {
                camDirSearchQuery = e.target.value;
                clearBtn.style.display = camDirSearchQuery ? "block" : "none";
                window.renderCamDirectorPrompts();
            });
            clearBtn.addEventListener("click", () => {
                searchInput.value = "";
                camDirSearchQuery = "";
                clearBtn.style.display = "none";
                window.renderCamDirectorPrompts();
            });
            
            // Set up builder subject
            document.getElementById("builder-subject").addEventListener("input", window.updateCamDirBuilder);
            document.getElementById("builder-style").addEventListener("change", window.updateCamDirBuilder);
            
            // Aspect ratio buttons
            const ratioBtns = document.querySelectorAll("#aspect-ratio-selector .ratio-btn");
            ratioBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    ratioBtns.forEach(b => {
                        b.classList.remove("active");
                        b.style.background = "var(--bg-input)";
                    });
                    btn.classList.add("active");
                    btn.style.background = "var(--primary)";
                    camDirSelectedRatio = btn.getAttribute("data-ratio");
                    window.updateCamDirBuilder();
                });
            });
            
            // Copy button
            const copyBtn = document.getElementById("btn-copy-builder");
            copyBtn.addEventListener("click", () => {
                const output = document.getElementById("builder-output").value;
                if(output) {
                    navigator.clipboard.writeText(output).then(() => {
                        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Kopiert!';
                        setTimeout(() => {
                            copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> Kopieren';
                        }, 2000);
                    });
                }
            });
        }
        
        window.renderCamDirectorPrompts();
    };

    window.renderCamDirectorPrompts = function() {
        const grid = document.getElementById("prompt-grid");
        if(!grid) return;
        grid.innerHTML = "";
        
        const filtered = cameraPrompts.filter(item => {
            const matchesCat = camDirCurrentCategory === "all" || item.category === camDirCurrentCategory;
            const matchesSearch = item.title.toLowerCase().includes(camDirSearchQuery.toLowerCase()) || 
                                  item.prompt.toLowerCase().includes(camDirSearchQuery.toLowerCase());
            return matchesCat && matchesSearch;
        });

        document.getElementById("active-count").textContent = `${filtered.length} Prompt${filtered.length !== 1 ? 's' : ''}`;

        if(filtered.length === 0) {
            grid.innerHTML = `<div style="grid-column: span 3; text-align:center; padding:30px; color:var(--text-muted);">Keine Prompts gefunden.</div>`;
            return;
        }

        filtered.forEach(item => {
            const card = document.createElement("div");
            card.style.background = "rgba(0,0,0,0.2)";
            card.style.border = camDirSelectedMovementId === item.id ? "1px solid var(--primary)" : "1px solid var(--border-color)";
            card.style.borderRadius = "8px";
            card.style.padding = "15px";
            card.style.display = "flex";
            card.style.flexDirection = "column";
            card.style.cursor = "pointer";
            card.style.transition = "transform 0.2s, border 0.2s";
            
            card.onmouseover = () => card.style.transform = "translateY(-2px)";
            card.onmouseout = () => card.style.transform = "translateY(0)";
            
            const catLabel = cameraCategories.find(c => c.id === item.category)?.label.split(" (")[0] || item.category;
            
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-size:0.65rem; background:var(--bg-input); padding:2px 6px; border-radius:4px; color:var(--text-muted); text-transform:uppercase;">${catLabel}</span>
                    <button class="copy-direct" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;" title="Direkt kopieren"><i class="fa-solid fa-copy"></i></button>
                </div>
                <div class="camera-preview" data-anim="${item.anim}">
                    <div class="scene">
                        <div class="subject"></div>
                    </div>
                </div>
                <h3 style="margin:0 0 5px 0; font-size:1rem; color:var(--text-main);">${item.title}</h3>
                <p style="margin:0 0 15px 0; font-size:0.75rem; color:var(--text-muted); line-height:1.4; flex-grow:1;">${item.prompt.substring(0, 100)}...</p>
                <div style="text-align:right; margin-top:auto;">
                    <span style="font-size:0.7rem; color:var(--primary); font-weight:600;"><i class="fa-solid fa-plus-circle"></i> Anpassen</span>
                </div>
            `;
            
            card.querySelector('.copy-direct').addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(item.prompt);
                const icon = card.querySelector('.copy-direct i');
                icon.className = "fa-solid fa-check";
                icon.style.color = "var(--success)";
                setTimeout(() => {
                    icon.className = "fa-solid fa-copy";
                    icon.style.color = "var(--text-muted)";
                }, 2000);
            });
            
            card.addEventListener('click', () => {
                camDirSelectedMovementId = item.id;
                
                const moveCard = document.getElementById("selected-movement-card");
                moveCard.innerHTML = `
                    <div style="display:flex; justify-content:space-between;">
                        <div>
                            <h4 style="margin:0 0 5px 0; color:var(--text-main); font-size:0.9rem;">${item.title}</h4>
                            <p style="margin:0; font-size:0.75rem; color:var(--text-muted);">${item.prompt}</p>
                        </div>
                        <i class="fa-solid fa-xmark" style="cursor:pointer;" onclick="window.clearCamDirMovement(event)"></i>
                    </div>
                `;
                window.renderCamDirectorPrompts(); // update border highlight
                window.updateCamDirBuilder();
            });
            
            grid.appendChild(card);
        });
    };
    
    window.clearCamDirMovement = function(e) {
        if(e) e.stopPropagation();
        camDirSelectedMovementId = null;
        document.getElementById("selected-movement-card").innerHTML = `Keine Kamerabewegung ausgewählt. Wähle eine aus der Liste.`;
        window.renderCamDirectorPrompts();
        window.updateCamDirBuilder();
    };
    
    window.setSubject = function(text) {
        const sub = document.getElementById("builder-subject");
        if(sub) {
            sub.value = text;
            window.updateCamDirBuilder();
        }
    };
    
    window.updateCamDirBuilder = function() {
        const subject = document.getElementById("builder-subject").value.trim();
        const style = document.getElementById("builder-style").value;
        const movement = cameraPrompts.find(item => item.id === camDirSelectedMovementId);
        
        let parts = [];
        if(subject) parts.push(subject);
        if(movement) parts.push(movement.prompt);
        
        let finalPrompt = parts.join(", ");
        if(style) finalPrompt += `, ${style}`;
        if(camDirSelectedRatio) finalPrompt += ` ${camDirSelectedRatio}`;
        
        const output = document.getElementById("builder-output");
        const copyBtn = document.getElementById("btn-copy-builder");
        
        output.value = finalPrompt;
        
        if(finalPrompt.trim()) {
            copyBtn.disabled = false;
        } else {
            copyBtn.disabled = true;
        }
    };

    window.runCamDirAutoBot = async function() {
        const btn = document.getElementById('btnCamDirAutoBot');
        const outputField = document.getElementById('builder-output');
        const currentPrompt = outputField.value.trim();
        const model = document.getElementById('camDirAutoBotModel').value;
        const lmUrl = document.getElementById('apiUrl')?.value.trim() || HARDCODED_URL;
        
        if(!currentPrompt) {
            showToast("Bitte stelle zuerst einen Prompt im Baukasten zusammen!", true);
            return;
        }
        
        btn.innerHTML = '<span class="spinner" style="display:inline-block;"></span> Optimiere...';
        btn.disabled = true;
        
        const sysPrompt = "Du bist ein Regisseur für KI-Videogeneratoren wie VEO, Luma oder Runway. Optimiere den übergebenen Prompt so, dass er fließende Kamerabewegungen und hohe Konsistenz erzielt. Schreibe ihn in exzellentes 'Regie-Englisch' um, passend für Video-KIs. Ändere nicht das Hauptmotiv, sondern perfektioniere den Stil und den Ablauf. Antworte NUR mit dem fertigen Prompt, ohne Formatierung oder Erklärungen.";
        
        try {
            const response = await fetch(BACKEND_API_URL + '/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goal: currentPrompt,
                    model: model,
                    system_prompt: sysPrompt,
                    lm_url: lmUrl
                })
            });
            
            if (!response.ok) throw new Error("API Fehler");
            const data = await response.json();
            
            let optimizedPrompt = data.optimized_goal.trim();
            if(optimizedPrompt.startsWith('"') && optimizedPrompt.endsWith('"')) {
                optimizedPrompt = optimizedPrompt.slice(1, -1);
            }
            
            outputField.value = optimizedPrompt;
            showToast("Video-Prompt optimiert!");
        } catch (e) {
            console.error(e);
            showToast("Fehler bei der Optimierung.", true);
        }
        
        btn.innerHTML = '⚡ Optimiere Prompt';
        btn.disabled = false;
    };

    // Global UI Handler
    let wmCurrentFile = null;

    const wmDropzone = document.getElementById('wm-dropzone');
    const wmFileInput = document.getElementById('wm-file');
    if(wmDropzone && wmFileInput) {
        wmDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            wmDropzone.style.background = 'rgba(255, 255, 255, 0.1)';
            wmDropzone.style.borderColor = 'var(--primary)';
        });
        wmDropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            wmDropzone.style.background = 'rgba(0,0,0,0.2)';
            wmDropzone.style.borderColor = 'var(--border-color)';
        });
        wmDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            wmDropzone.style.background = 'rgba(0,0,0,0.2)';
            wmDropzone.style.borderColor = 'var(--border-color)';
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                wmCurrentFile = e.dataTransfer.files[0];
                handleWmFileSelect();
            }
        });
        wmFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                wmCurrentFile = e.target.files[0];
                handleWmFileSelect();
            }
        });
    }

    function handleWmFileSelect() {
        if(!wmCurrentFile) return;
        const container = document.getElementById('wm-preview-container');
        const imgOrig = document.getElementById('wm-img-original');
        const imgCleaned = document.getElementById('wm-img-cleaned');
        const downloadBtn = document.getElementById('wm-download-btn');
        
        imgOrig.src = URL.createObjectURL(wmCurrentFile);
        imgCleaned.src = "";
        downloadBtn.style.display = 'none';
        
        container.style.display = 'block';
        showToast("Bild geladen. Bereit zur Wasserzeichen-Entfernung.");
    }

    window.processWatermark = async function() {
        if (!wmCurrentFile) return;
        const btn = document.getElementById('wm-process-btn');
        btn.innerHTML = '<span class="spinner" style="display:inline-block;"></span> Verarbeite...';
        btn.disabled = true;

        const removeSynthid = document.getElementById('wm-remove-synthid')?.checked || false;

        const formData = new FormData();
        formData.append('file', wmCurrentFile);
        formData.append('remove_synthid', removeSynthid);

        try {
            const response = await fetch(BACKEND_API_URL + '/api/watermark/remove', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                let errorMsg = "API Fehler";
                try {
                    const data = await response.json();
                    if(data.error) errorMsg = data.error;
                } catch(e) {}
                throw new Error(errorMsg);
            }

            const blob = await response.blob();
            const cleanedUrl = URL.createObjectURL(blob);
            
            document.getElementById('wm-img-cleaned').src = cleanedUrl;
            
            const downloadBtn = document.getElementById('wm-download-btn');
            downloadBtn.href = cleanedUrl;
            downloadBtn.download = "cleaned_" + wmCurrentFile.name;
            downloadBtn.style.display = 'inline-flex';
            
            showToast("Wasserzeichen erfolgreich über Python-Backend entfernt!", false);
        } catch(e) {
            console.error(e);
            showToast("Fehler bei der Entfernung: " + e.message, true);
        }

        btn.innerHTML = '✨ Wasserzeichen entfernen';
        btn.disabled = false;
    };
