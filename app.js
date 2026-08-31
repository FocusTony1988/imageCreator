
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
    const BACKEND_API_URL = window.location.protocol === 'file:'
        ? 'https://imagecreator-t9dx.onrender.com'
        : '';
    let globalPromptStyle = 'tech'; 

    function switchTab(id) {
        const target = document.getElementById(id);
        if (!target) return;
        
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
        
        target.classList.add('active');
        const btn = Array.from(document.querySelectorAll('.nav-btn')).find(b => {
            const attr = b.getAttribute('onclick');
            return attr && attr.includes(id);
        });
        if (btn) btn.classList.add('active');
    }
    window.switchTab = switchTab;
    
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
      { type: 'select', id: 'quickBotModel', label: 'Modell für Auto-Bot', modes: ['photo', 'video'], options: [['Gemini 3.5 Flash Lite (Standard)', 'gemini-3.5-flash-lite'], ['Gemini 3.6 Flash', 'gemini-3.6-flash'], ['Gemini 3.5 Flash', 'gemini-3.5-flash'], ['Gemini 3.1 Flash Lite', 'gemini-3.1-flash-lite'], ['Gemini 2.5 Flash', 'gemini-2.5-flash'], ['LM Studio (Lokal)', 'lm-studio']] },
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
      { type: 'select', id: 'expression', label: 'Ausdruck', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Neutral/Cool','neutral cool expression'],['Intellektuell / Nachdenklich','intellectual thoughtful gaze, deep focused eyes'],['Verliebt/Romantisch','romantic loving gaze'],['Glücklich/Strahlend','happy beaming smile'],['Ernst/Fokussiert','serious focused look'],['Wütend/Intensiv','angry intense glare'],['Mystisch / Geheimnisvoll','mysterious enigmatic look, subtle smile'],['Traurig/Melancholisch','sad melancholic'],['Überrascht','surprised expression'],['Verträumt','dreamy look'],['Verführerisch','seductive gaze']] },
      { type: 'select', id: 'clothing', label: 'Kleidung', parent: 'describePerson', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Bikini / Swimwear','bikini swimwear'],['Casual (T-Shirt/Jeans)','casual t-shirt and jeans'],['Streetwear (Hoodie)','oversized hoodie streetwear'],['Business Anzug','tailored business suit'],['Abendkleid (Gala)','elegant evening gown'],['Lederjacke (Edgy)','black leather jacket'],['Sci-Fi Rüstung','futuristic sci-fi armor'],['Cyber-Suit (Carbon/Neon)','glowing neon cyberpunk suit, sleek carbon fiber'],['Techwear','cyberpunk techwear'],['Mittelalter Robe','medieval robes'],['Sportbekleidung','active sportswear'],['Seiden-Robe (Translucent)','flowing silk robe, translucent fabric'],['Haute Couture','avant-garde haute couture']] },
      
      { type: 'select', id: 'bikiniStyle', label: 'Bikini Schnitt & Style', parent: 'describePerson', modes: ['photo', 'video'], options: [
          ['Standard / Klassisch', ''],
          ['String Bikini (Schmal)', 'micro string bikini, cheeky cut'],
          ['Tanga / Thong Bikini (Fokus Rückseite)', 'thong bikini bottom, revealing cut'],
          ['Nasser Bikini (Sinnlicher Wet-Look)', 'wet translucent bikini, water droplets on skin'],
          ['Latex / Vinyl Bikini (Glänzend)', 'shiny metallic vinyl bikini, glossy finish'],
          ['Monokini (Tiefe Ausschnitte)', 'revealing cutout monokini'],
          ['High-Cut Vintage 80s Swimsuit', '80s high-cut swimsuit, glamorous beach cut']
      ] },
      
      { type: 'textarea', id: 'action', label: 'Handlung / Pose', parent: 'describePerson', modes: ['photo', 'video'], placeholder: 'Was macht die Person genau? (z.B. "sitzt am Fenster und trinkt Kaffee", "rennte durch den Regen")...' },
      
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
      { type: 'select', id: 'location', label: 'Ort (Location)', modes: ['photo', 'video'], hasManual: true, options: [['Bitte wählen',''],['Luxus-Apartment (Innen)','luxury modern apartment'],['Schlafzimmer (Gemütlich)','cozy bedroom'],['Küche (Chef)','professional kitchen'],['Badezimmer (Spa)','luxury spa bathroom'],['Büro (Wolkenkratzer)','skyscraper office'],['Cyberpunk Ramen-Bar / Gasse','neon-lit cyberpunk ramen bar, rain-soaked alley'],['Nachtclub (Neon)','neon nightclub'],['Gotische Kathedrale','gothic cathedral interior, stained glass window light'],['Dachterrasse (Penthouse Nacht)','futuristic neon penthouse rooftop terrace at night'],['U-Bahn Station (Verlassen)','subway tunnel with flickering fluorescent lights'],['Tropischer Strand','pristine tropical beach'],['Verschneite Berge','snowy mountain peak'],['Futuristisches Labor','sci-fi laboratory'],['Raumschiff','spaceship interior'],['New York Straße','busy NYC street'],['Tokio (Regen)','rainy Tokyo street'],['Waldlichtung','mystical forest glade'],['Wüste','vast desert dunes'],['Unterwasser Korallenriff','vibrant underwater coral reef with shimmering water caustic light'],['Weißes Studio (Clean)','clean white infinity studio']] },
      { type: 'select', id: 'era', label: 'Zeit / Ära', modes: ['photo', 'video'], hasManual: true, options: [['Bitte wählen',''],['Modern (Heute)','modern day'],['Nahe Zukunft (2030)','near future 2030'],['Cyberpunk Zukunft (2077)','year 2077 cyberpunk'],['Y2K (2000er)','early 2000s Y2K aesthetic'],['90er Jahre','1990s aesthetic'],['80er Jahre (Synthwave)','1980s synthwave style'],['70er Jahre (Retro)','1970s retro'],['60er Jahre','1960s style'],['Viktorianisch (1800s)','Victorian era'],['Mittelalter','medieval era'],['Antike','ancient history']] },
      { type: 'select', id: 'lighting', label: 'Lichtsetzung', modes: ['photo', 'video'], hasManual: true, options: [['Bitte wählen',''],['Cinematic (Dramatisch)','dramatic cinematic lighting'],['Soft Window Light','soft natural window light'],['Golden Hour (Abendlicht)','golden hour sunlight'],['Volumetrisch (God Rays)','intense volumetric god rays streaming through dust'],['Neon Split (Cyan & Magenta)','neon split lighting, dual tone cyan and magenta glow'],['Biolumineszent (Eigenlicht)','ethereal bioluminescent ambient light'],['Dark / Moody','dark moody low-key lighting'],['Studio Softbox','professional studio softbox'],['Rembrandt','Rembrandt lighting'],['Hartes Sonnenlicht','harsh sunlight']] },
      { type: 'select', id: 'weather', label: 'Wetter / Atmosphäre', modes: ['photo', 'video'], hasManual: true, options: [['Bitte wählen',''],['Sonnig Klar','clear sunny sky'],['Regnerisch (Nass)','heavy rain'],['Gewitter','stormy lightning'],['Schnee','heavy snow'],['Neblig','thick fog'],['Asche-Regen (Silent Hill)','falling volcanic ash, hazy dark atmosphere'],['Sandsturm','dense red sandstorm, hazy desert wind'],['Bewölkt','overcast sky'],['Staubig','dusty atmosphere']] },
      
      { type: 'header', label: 'High-End Physics & Optics', icon: 'fa-microchip', modes: ['photo', 'video'] },
      { type: 'select', id: 'detailLevel', label: 'Detailgrad (Fidelity)', desc: 'Pixeldichte und KI-Glättung', modes: ['photo', 'video'], options: [['Standard',''],['8K RAW / High Fidelity','8k raw photo, extreme detail, no smoothing, uncompressed'],['16K Ultra-RAW (Hyper-Detail)','16k uncompressed raw photo, hyper-detailed texture map'],['Mikroskopische Präzision (Macro Fidelity)','microscopic detail level, extreme texture precision'],['4K Sharp','4k sharp focus'],['Analog Soft-Focus (Traumhaft)','vintage soft diffusion filter, dreamy glow'],['Soft / Painterly','soft painterly style']] },
      { type: 'select', id: 'skinPhysics', label: 'Hautoberfläche', desc: 'Lichtverhalten auf Haut', modes: ['photo', 'video'], options: [['Standard',''],['Sub-surface scattering (SSS)','subsurface scattering, translucent skin, realistic epidermis'],['Epidermaler Glanz & Poren','subsurface skin scattering, natural epidermal sheen, realistic pores'],['Öl & Schweiß Glanz (Glossy Sweaty)','sweaty glossy skin texture, intense specular highlights'],['Porcelain (Glatt)','porcelain skin'],['Matte & Samtig (Velvet Finish)','matte velvet skin finish, soft touch texture'],['Sommersprossen & Hautmale','natural freckles, realistic skin pigmentation, beauty marks'],['Rough / Weathered','rough weathered skin texture']] },
      { type: 'select', id: 'microDetails', label: 'Mikro-Details', desc: 'Erhöht Realismus', modes: ['photo', 'video'], options: [['Standard',''],['Pores & Vellus Hair','visible pores, vellus hair, natural skin texture imperfections'],['Pfirsichflaum & Hautporen','vellus peach fuzz hair, micro skin pores, natural imperfections'],['Hautfalten & Ausdruckslinien','natural expression lines, subtle crow\'s feet, micro wrinkles'],['Irisfasern & Augenreflexion','microscopic iris filaments, vibrant eye catchlight reflections'],['Perfect Skin','airbrushed perfect skin']] },
      { type: 'select', id: 'vfxParticles', label: 'VFX & Partikel', desc: 'Partikel- & Atmos-Effekte', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Funkenflug (Floating Embers)','floating embers, glowing sparks, atmospheric heat'],['Raum-Staub (Floating Dust)','floating dust motes in light rays, atmospheric particles'],['Biolumineszenz (Sporen)','glowing bioluminescent spores, magical particles'],['Hitze-Flimmern (Mirage Shimmer)','refractive heat shimmer, mirage distortion, atmospheric heat haze'],['Lens Flare (Anamorph Blau)','cinematic lens flare, anamorphic blue glare'],['Schneegestöber (Backlit Snow)','swirling backlit snowflakes, icy air motes'],['Farbsäume / Prisma (Chromatic Aberration)','slight chromatic aberration, optical prism fringing, lens distortion'],['Rauch & Nebel (Volumetric Haze)','dense volumetric fog, atmospheric haze, smoke drift']] },
      { type: 'select', id: 'surfaceCondition', label: 'Oberflächen-Physik', desc: 'Feuchtigkeit & Textur', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Nass geregnet (Rain-Slicked)','rain-slicked wet surface, glossy water reflections'],['Tautropfen (Morning Dew)','glistening morning dew droplets, wet surface sheen'],['Schweiß & Glanz (Glistening Skin)','glistening skin sheen, subtle sweat droplets'],['Schlamm & Spritzer (Mud Splatters)','splattered mud droplets, gritty surface texture'],['Frost & Eiskristalle (Ice Crystals)','frost crystals, frozen texture, icy sheen'],['Spiegelnde Pfützen (Puddle Mirror)','mirror-like water puddle reflections, wet asphalt'],['Regentropfen auf Linse (Lens Droplets)','water droplets on camera lens, optical distortion']] },
      { type: 'select', id: 'lightingSetup', label: 'Licht-Architektur', desc: 'Lichtformung & Schatten', modes: ['photo', 'video'], options: [['Bitte wählen',''],['3-Punkt Studio (Key, Fill, Rim)','3-point studio lighting setup, balanced key and fill'],['Kantenlicht (Rim / Hair Light)','strong rim light, backlit silhouette, glowing edges'],['Volumetrisches Gegenlicht (Backlight)','intense volumetric backlighting, glowing silhouette edges'],['Kerzenlicht / Kamin (Warm Flame)','warm flickering candlelight, deep orange ambient glow'],['Chiaroscuro (Starker Kontrast)','chiaroscuro lighting, deep dramatic shadows, Caravaggio style'],['Gobo Jalousie-Schatten (Window Shadows)','gobo light modifier, Venetian blind shadow patterns'],['Neon Split (Cyan & Magenta)','neon split lighting, dual tone cyan and magenta glow'],['Butterfly Lighting (Beauty Key)','classic butterfly beauty lighting, flattering chin shadow']] },
      { type: 'select', id: 'sensorPhysics', label: 'Sensor-Physik', desc: 'Bildrauschen & Realismus', modes: ['photo', 'video'], options: [['Digital Clean',''],['Mittelformat CCD (Hasselblad Crisp)','medium format CCD sensor crispness, ultra dynamic range'],['CMOS Mobile Noise','cctv footage, phone camera noise, raw sensor data'],['Zero Denoising','zero denoising, grainy texture, authentic iso noise'],['Analog 35mm Grain (Kodak)','authentic 35mm film grain, analog texture'],['Analog 16mm Grain (Retro Cinema)','heavy 16mm vintage film grain, retro cinema noise'],['Film Grain','heavy film grain']] },
      { type: 'select', id: 'opticsLogic', label: 'Optik / Fokus', desc: 'Tiefenschärfe Simulation', modes: ['photo', 'video'], options: [['Standard',''],['24mm Wide / f/8 Deep Focus','24mm lens, f/8 aperture, deep depth of field, everything in focus'],['85mm Portrait / f/1.8 Bokeh','85mm lens, f/1.8 aperture, creamy bokeh background'],['Petzval Swirling Bokeh (Vintage Lens)','Petzval vintage lens, swirling background bokeh'],['Tilt-Shift (Miniatur-Effekt)','tilt-shift lens effect, miniature model depth of field'],['Split-Diopter (Doppel-Fokus)','split-diopter shot, dual focus foreground and background'],['Soft Focus Diffusion (Hasselblad Softar)','softar diffusion filter, creamy skin glow'],['Macro / Shallow','macro lens, shallow depth of field']] },
      { type: 'select', id: 'lightingLogic', label: 'Lichtlogik (Flash)', desc: 'Vermeidet KI-Glow', modes: ['photo', 'video'], options: [['Standard',''],['Direct Neutral Flash','direct neutral white flash, harsh shadows, amateur photography'],['Ring-Blitz (Fashion Ringlight)','fashion ringlight illumination, halo eye catchlights'],['Hard Direct Flash (90s Party Snap)','hard direct on-camera flash, stark shadows, 90s party snap'],['Soft Diffused Umbrella Flash','soft diffused strobe flash, gentle wrap-around light'],['No Studio / Natural','no studio lighting, ambient light only'],['Pro Studio','professional studio lighting setup']] },
      { type: 'select', id: 'colorFidelity', label: 'Farbtreue', desc: 'Sättigung & Grading', modes: ['photo', 'video'], options: [['Standard RGB',''],['Raw Tones / Flat','raw color tones, flat profile, low contrast, desaturated'],['KODAK Gold Warm Film Tones','warm Kodak Gold analog film tones, golden highlights'],['Fujifilm Velvia High-Vibrance','vibrant Fujifilm Velvia saturated landscape colors'],['Bleach Bypass (Gritty Matrix)','gritty bleach bypass color grading, desaturated high contrast'],['Technicolor 3-Strip (Retro Hollywood)','vibrant Technicolor 3-strip vintage color palette'],['Vivid / Instagram','vivid colors, high saturation, instagram filter'],['Monochrome','black and white, monochrome']] },
      
      { type: 'header', label: 'Tech Specs (Kamera)', icon: 'fa-camera', modes: ['photo', 'video'] },
      { type: 'select', id: 'aspectRatio', label: 'Format (Aspect Ratio)', desc: 'Bestimmt die Auflösung.', modes: ['photo', 'video'], options: [['16:9 (Kino breit)','16:9'],['9:16 (TikTok/Reel)','9:16'],['1:1 (Instagram/Square)','1:1'],['21:9 (Ultrawide)','21:9'],['4:3 (TV Klassisch)','4:3'],['3:4 (Portrait)','3:4'],['2.35:1 (Anamorphic)','2.35:1']] },
      { type: 'select', id: 'focalLength', label: 'Brennweite (Focal Length)', desc: 'Objektiv-Charakteristik', modes: ['photo', 'video'], options: [['Bitte wählen',''],['14mm Ultra-Wide (Dynamisch)','14mm ultra-wide lens, dynamic perspective distortion'],['35mm Storytelling (Reportage)','35mm prime lens, natural narrative perspective'],['50mm Nifty Fifty (Standard)','50mm standard lens, true to life human vision'],['85mm Portrait (Proportional)','85mm portrait lens, flattering compression'],['200mm Telephoto (Komprimiert)','200mm telephoto lens, background compression'],['Anamorphic 2x (Kino-Look)','2x anamorphic lens, oval bokeh, ultra-wide cinema ratio']] },
      { type: 'select', id: 'apertureDoF', label: 'Blende & Tiefenschärfe', desc: 'Hintergrund-Unschärfe', modes: ['photo', 'video'], options: [['Bitte wählen',''],['f/1.2 Hauchdünn (Razor Focus)','f/1.2 aperture, razor-thin depth of field, sharp focus on subject'],['f/1.8 Sanftes Bokeh (Creamy Bokeh)','f/1.8 aperture, creamy blurred background bokeh'],['f/2.8 Scharfes Subjekt (Separation)','f/2.8 aperture, clean subject separation'],['f/8 Durchgehend Scharf (Deep Focus)','f/8 aperture, deep focus, sharp background details']] },
      { type: 'select', id: 'composition', label: 'Bildkomposition (Framing)', desc: 'Perspektivischer Aufbau', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Drittel-Regel (Rule of Thirds)','rule of thirds composition'],['Symmetrisch Zentriert (Wes Anderson)','centered symmetrical composition, Wes Anderson style'],['Goldener Schnitt (Golden Ratio)','golden ratio spiral composition'],['Führungslinien (Leading Lines)','dynamic leading lines pointing to subject'],['Negativer Raum (Minimalismus)','minimalist composition, vast negative space'],['Rahmen im Rahmen (Frame-in-Frame)','frame within a frame composition']] },
      { type: 'select', id: 'colorGrading', label: 'Color Grading & Palette', desc: 'Farbstimmung & Look', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Teal & Orange (Hollywood)','Teal and Orange color grading, Hollywood blockbuster palette'],['Pastell-Ästhetik (Soft Pastel)','soft pastel color palette, gentle muted tones'],['Bleach Bypass (Fincher Gritty)','gritty bleach bypass color grading, desaturated high contrast'],['Monochrom + Akzent (Pop Color)','monochromatic black and white with vibrant color accent'],['Gedämpfte Erdtöne (Muted Earth)','muted organic earth tones, natural film palette'],['Cyberpunk RGB (Gesättigt)','saturated neon RGB color grading, high contrast']] },
      { type: 'select', id: 'viewAngle', label: 'Kamerawinkel', desc: 'Perspektive der Aufnahme.', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Augenhöhe (Neutral)','eye-level shot'],['Froschperspektive (Low Angle)','low angle shot looking up'],['Vogelperspektive (High Angle)','high angle shot looking down'],['Top-Down (Satellit / Drohne)','high-altitude satellite drone top-down view'],['Wurm-Perspektive (Ground Level)','extreme ground-level worm-eye view'],['Over-the-Shoulder','over-the-shoulder shot'],['Dutch Angle (Schräg Tilt)','dramatic canted dutch angle tilt shot'],['POV (Ego)','first-person POV shot'],['Makro (Close-Up)','extreme macro close-up'],['Weitwinkel','wide angle shot'],['Fischauge','fisheye lens effect'],['Tele (Zoom)','telephoto compression'],['Selfie','selfie shot']] },
      { type: 'select', id: 'renderEngine', label: 'Render Stil (Digital)', desc: 'Für nicht-fotorealistische Stile.', modes: ['photo', 'video'], options: [['Bitte wählen',''],['Fotorealistisch (Raw)','photorealistic raw photo'],['Unreal Engine 5','Unreal Engine 5 render'],['Octane Render','Octane 3D render'],['Pixar / Disney','Pixar 3D animation style'],['Anime (Modern)','modern anime style'],['Ölgemälde','classic oil painting'],['Aquarell','watercolor painting'],['Concept Art','digital concept art'],['Vector Art','flat vector art'],['Pixel Art','retro pixel art']] },
      
      { type: 'header', label: 'Video Settings', icon: 'fa-film', modes: ['video'] },
      { type: 'select', id: 'cameraMotion', label: 'Kamerabewegung', modes: ['video'], options: [['Statisch (Stativ)','static tripod shot'],['Sanfter Zoom In','slow zoom in'],['Zoom Out','slow zoom out'],['Pan Rechts','smooth pan right'],['Pan Links','smooth pan left'],['Tracking Shot (Verfolgung)','dolly tracking shot'],['Handheld (Wackelig)','handheld shaky camera'],['FPV Drohne (Schnell)','fast FPV drone flight'],['Orbit (Kreisfahrt)','circular orbit shot']] },
      { type: 'select', id: 'videoMotionEffect', label: 'Motion & Shutter Effekte', desc: 'Spezielle Video-Dynamik', modes: ['video'], options: [['Bitte wählen',''],['Slow-Motion (120 FPS)','slow-motion 120fps playback'],['Motion Blur (180° Shutter)','cinematic motion blur, 180 degree shutter angle'],['Zeitraffer (Time-lapse)','dramatic time-lapse sequence'],['Vertigo / Dolly Zoom','dolly zoom Vertigo effect, warping background']] },
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

        const env = join(getVal('location'), getVal('sceneType'), getVal('era'), getVal('weather'), getVal('lighting'), getVal('lightingSetup'));
        if(env) parts.push(`SETTING: ${env}`);

        const tech = join(
            getVal('viewAngle'), getVal('focalLength'), getVal('apertureDoF'), getVal('composition'),
            getVal('filmStock'), getVal('colorGrading'), getVal('vfxParticles'), getVal('surfaceCondition'),
            getVal('detailLevel'), getVal('opticsLogic'), getVal('videoMotionEffect')
        );
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

    window.setCopilotPreset = function(ideaText) {
        const el = document.getElementById('copilotIdea');
        if (el) {
            el.value = ideaText;
            el.focus();
        }
    };

    window.runCopilot = async function() {
        const btn = document.getElementById('btnRunCopilot');
        const idea = document.getElementById('copilotIdea')?.value.trim();
        const lmUrl = document.getElementById('apiUrl')?.value.trim() || HARDCODED_URL;
        const reasoningCard = document.getElementById('copilotReasoningCard');
        const reasoningText = document.getElementById('copilotReasoningText');

        if (!idea) {
            showToast("Bitte gib zuerst deine Idee in das Co-Pilot Feld ein!", true);
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="display:inline-block; margin-right:5px;"></span> Co-Pilot analysiert mit Gemini 3.5 Flash Lite...';

        try {
            const response = await fetch(BACKEND_API_URL + '/api/copilot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idea: idea,
                    lm_url: lmUrl
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Server Status ${response.status}`);
            }

            const data = await response.json();

            if (data.fields && typeof data.fields === 'object') {
                let configuredCount = 0;
                for (const [fieldId, val] of Object.entries(data.fields)) {
                    if (!val) continue;
                    const el = document.getElementById(fieldId);
                    if (!el) continue;

                    if (el.tagName === 'SELECT' && el.options) {
                        let matched = false;
                        const valLower = String(val).toLowerCase();
                        for (let opt of el.options) {
                            if (opt.value) {
                                const optLower = String(opt.value).toLowerCase();
                                if (optLower === valLower || optLower.includes(valLower) || valLower.includes(optLower)) {
                                    el.value = opt.value;
                                    matched = true;
                                    configuredCount++;
                                    break;
                                }
                            }
                        }
                        if (!matched) {
                            for (let opt of el.options) {
                                if (opt.text && String(opt.text).toLowerCase().includes(valLower)) {
                                    el.value = opt.value;
                                    matched = true;
                                    configuredCount++;
                                    break;
                                }
                            }
                        }
                    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                        el.value = val;
                        configuredCount++;
                    }
                }

                // Smart Person vs. Quickstart handling
                const personCheck = document.getElementById('describePerson');
                const quickBotIdeaEl = document.getElementById('quickBotIdea');
                const quickBotResultEl = document.getElementById('quickBotResult');

                const isPersonPresent = data.hasPerson === true;

                if (quickBotIdeaEl) quickBotIdeaEl.value = idea;
                if (quickBotResultEl && data.baseConcept) quickBotResultEl.value = data.baseConcept;

                if (isPersonPresent) {
                    if (personCheck) {
                        personCheck.checked = true;
                        personCheck.dispatchEvent(new Event('change'));
                    }
                    const actionEl = document.getElementById('action');
                    if (actionEl && (data.fields?.action || data.baseConcept)) {
                        actionEl.value = data.fields?.action || data.baseConcept;
                    }
                } else {
                    if (personCheck) {
                        personCheck.checked = false;
                        personCheck.dispatchEvent(new Event('change'));
                    }
                    // Leere Personen-Felder explizit
                    const personFieldIds = ['gender', 'ageGroup', 'ethnicity', 'bodyType', 'hairColor', 'hairStyle', 'eyeColor', 'expression', 'clothing', 'bikiniStyle', 'action'];
                    personFieldIds.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.value = '';
                    });
                }

                showToast(`✨ Co-Pilot hat ${configuredCount} Regler für dich optimiert!`);
            }

            if (data.reasoning) {
                if (reasoningCard && reasoningText) {
                    reasoningText.innerText = data.reasoning;
                    reasoningCard.style.display = 'block';
                }
            }

            updateGenSummary();
        } catch (e) {
            console.error("Co-Pilot Fehler:", e);
            showToast("Fehler beim Co-Pilot Aufruf: " + e.message, true);
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> ⚡ Dropdowns automatisch durch Co-Pilot einstellen';
    };

    // --- WHITE PAPER UX ENHANCEMENTS ---
    let currentExportFormat = 'mj'; // 'mj', 'flux', 'json', 'video'
    let lastGeneratedData = null;

    window.magicPolish = async function(textareaId) {
        const el = document.getElementById(textareaId);
        if (!el || !el.value.trim()) {
            showToast("Bitte gib zuerst einen Text zum Aufhübschen ein!", true);
            return;
        }

        const originalText = el.value.trim();
        showToast("✨ Magic Polish bereichert deine Idee mit Gemini 3.5 Flash Lite...");

        try {
            const response = await fetch(BACKEND_API_URL + '/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goal: originalText,
                    model: 'gemini-3.5-flash-lite',
                    system_prompt: 'Du bist ein meisterhafter KI-Prompt-Engineered. Bereichere die Idee des Nutzers mit stimmungsvollen, hochauflösenden Details und visuellen Adjektiven in Deutsch. Antworte in 1-2 Sätzen, flüssig und direkt ohne Markdown.'
                })
            });

            if (!response.ok) throw new Error("API-Fehler");
            const data = await response.json();
            if (data.optimized_goal) {
                el.value = data.optimized_goal.trim();
                showToast("✨ Idee erfolgreich aufgehübscht!");
                updateGenSummary();
            }
        } catch (e) {
            console.error(e);
            showToast("Fehler beim Aufhübschen.", true);
        }
    };

    window.selectVisualPreset = function(presetKey) {
        document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
        
        const presets = {
            cinematic: {
                focalLength: "85mm portrait lens, flattering compression",
                apertureDoF: "f/1.8 aperture, creamy blurred background bokeh",
                colorGrading: "Teal and Orange color grading, Hollywood blockbuster palette",
                sceneType: "cinematic realism",
                detailLevel: "8k raw photo, extreme detail, no smoothing, uncompressed"
            },
            cyberpunk: {
                focalLength: "2x anamorphic lens, oval bokeh, ultra-wide cinema ratio",
                lightingSetup: "neon split lighting, dual tone cyan and magenta glow",
                colorGrading: "saturated neon RGB color grading, high contrast",
                sceneType: "cyberpunk sci-fi",
                vfxParticles: "cinematic lens flare, anamorphic blue glare",
                surfaceCondition: "rain-slicked wet surface, glossy water reflections"
            },
            fantasy: {
                lightingSetup: "chiaroscuro lighting, deep dramatic shadows, Caravaggio style",
                vfxParticles: "glowing bioluminescent spores, magical particles",
                sceneType: "high fantasy",
                colorGrading: "muted organic earth tones, natural film palette"
            },
            fashion: {
                focalLength: "85mm portrait lens, flattering compression",
                apertureDoF: "f/1.8 aperture, creamy blurred background bokeh",
                lightingSetup: "3-point studio lighting setup, balanced key and fill",
                sceneType: "high fashion editorial",
                detailLevel: "8k raw photo, extreme detail, no smoothing, uncompressed"
            },
            vintage: {
                filmStock: "Kodak Portra 400 film grain",
                colorGrading: "soft pastel color palette, gentle muted tones",
                sensorPhysics: "heavy film grain",
                sceneType: "vintage retro aesthetic"
            }
        };

        const config = presets[presetKey];
        if (config) {
            let count = 0;
            for (const [id, val] of Object.entries(config)) {
                const el = document.getElementById(id);
                if (el && val && el.options) {
                    for (let opt of el.options) {
                        if (opt.value && opt.value.toLowerCase().includes(val.toLowerCase())) {
                            el.value = opt.value;
                            count++;
                            break;
                        }
                    }
                }
            }
            showToast(`🎨 Style Preset "${presetKey}" angewendet!`);
            updateGenSummary();
        }
    };

    window.setExportFormat = function(format) {
        currentExportFormat = format;
        document.querySelectorAll('.export-tab-btn').forEach(btn => btn.classList.remove('active'));
        const activeTab = document.getElementById(`tab-format-${format}`);
        if (activeTab) activeTab.classList.add('active');

        renderExportPayload();
    };

    function renderExportPayload() {
        const codeBlock = document.getElementById('codeBlock');
        if (!codeBlock) return;

        if (!lastGeneratedData) {
            codeBlock.innerText = "// Wähle Parameter oder nutze \"Local AI JSON Generate\"...";
            return;
        }

        const prompt = lastGeneratedData.prompts?.positive_prompt || lastGeneratedData.prompt || "";
        const ar = getVal('aspectRatio') || "16:9";

        if (currentExportFormat === 'mj') {
            codeBlock.innerText = `/imagine prompt: ${prompt.replace(/--ar [0-9:-]+/g, '').trim()} --ar ${ar} --v 6.1 --style raw`;
        } else if (currentExportFormat === 'flux') {
            codeBlock.innerText = `[FLUX / SDXL PROMPT]\n${prompt}\n\n[AUTOMATED AI NEGATIVE PROMPT (INVISIBLY APPLIED)]\n${lastGeneratedData.prompts?.negative_prompt || "worst quality, deformed, bad anatomy, text, watermark"}`;
        } else if (currentExportFormat === 'json') {
            codeBlock.innerText = JSON.stringify(lastGeneratedData, null, 2);
        } else if (currentExportFormat === 'video') {
            const motion = getVal('cameraMotion') || "slow tracking shot";
            codeBlock.innerText = `[VIDEO AI PROMPT (Veo / Sora / Kling)]\n${prompt}\nCamera Movement: ${motion}\nFramerate: ${getVal('fps') || '24'} fps`;
        }

        if (window.Prism) Prism.highlightElement(codeBlock);
    }

    window.saveToHistory = function(promptText) {
        if (!promptText) return;
        try {
            let history = JSON.parse(localStorage.getItem('nb_prompt_history') || '[]');
            history = history.filter(item => item !== promptText);
            history.unshift(promptText);
            if (history.length > 10) history = history.slice(0, 10);
            localStorage.setItem('nb_prompt_history', JSON.stringify(history));
            renderHistory();
        } catch (e) {
            console.error("History save error:", e);
        }
    };

    window.renderHistory = function() {
        const container = document.getElementById('historyList');
        if (!container) return;
        try {
            const history = JSON.parse(localStorage.getItem('nb_prompt_history') || '[]');
            if (history.length === 0) {
                container.innerHTML = '<span style="font-size:0.7rem; color:var(--text-muted);">Noch keine generierten Prompts im Verlauf.</span>';
                return;
            }

            container.innerHTML = history.map((item, idx) => `
                <div class="history-item" onclick="restoreFromHistory(${idx})">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:85%;">${item}</span>
                    <i class="fa-solid fa-arrow-rotate-left" style="color:var(--primary); font-size:0.75rem;" title="Prompt wiederherstellen"></i>
                </div>
            `).join('');
        } catch (e) {
            console.error("History render error:", e);
        }
    };

    window.restoreFromHistory = function(idx) {
        try {
            const history = JSON.parse(localStorage.getItem('nb_prompt_history') || '[]');
            if (history[idx]) {
                lastGeneratedData = {
                    workflow_meta: { intent: "Restored from history" },
                    prompts: { positive_prompt: history[idx], negative_prompt: "worst quality, low resolution, deformed" }
                };
                renderExportPayload();
                showToast("Prompt aus Verlauf wiederhergestellt!");
            }
        } catch (e) {
            console.error(e);
        }
    };

    window.clearHistory = function() {
        localStorage.removeItem('nb_prompt_history');
        renderHistory();
        showToast("Verlauf geleert.");
    };

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
        const useAutoBot = true; // Always use Auto Bot Streaming
        const model = document.getElementById('modelSelectMain').value;
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;
        
        const systemPrompt = `Du bist der KI-Hauptarchitekt für Bildgeneratoren (Midjourney, Stable Diffusion, Flux). Deine Aufgabe ist es, aus einer Benutzeridee einen exzellenten, hochpräzisen Positiv- und Negativ-Prompt zu erstellen.

INTELLIGENTE ADAPTIVE REGEL-ANALYSE (Kontext-Sensitivität):

1. WENN STIL = FOTOREALISMUS / CINEMATIC / DOKU / REALISTISCHE SZENE:
   - Schalte zu 100% auf den "Physics-First" Modus!
   - Kausalität & Spurenbildung: Beschreibe Einschlagstäler, Schneewälle, Ruß, Brechungen, Druckwellen und Alterungsspuren (z.B. "impact trench in snow", "charred debris field").
   - Maßstab & Proportionen: Setze mathematisch exakte Größenverhältnisse und reale Kameraoptiken (z.B. 28mm wide angle, f/2.8).
   - Thermodynamik & Elemente: Physikalisch korrekter Rauch, Hitzeverformung, komprimierter Schnee.
   - Prompt-Hygiene: Vermeide CGI-Floskeln ("epic", "hyperrealistic"), nutze "documentary style", "photojournalism", "natural lighting", "realistic physics".

2. WENN STIL = KÜNSTLERISCH / ANIME / FANTASY / CARTOON / ILLUSTRATION / SURREALISMUS:
   - Schalte auf den "Style-First & Aesthetic Harmony" Modus!
   - Erhalte die künstlerische Freiheit und den spezifischen Zeichen-/Animationsstil (z.B. Studio Ghibli, 2D vector art, watercolor, cel shading, high fantasy).
   - Erzwinge KEINEN realistischen Kameraschmutz, Poren oder Fotojournalismus-Keywords, die den Kunststil verfälschen würden!
   - Optimiere stattdessen Komposition, Farbpaletten-Harmonie, Linienführung, dynamische Lichtstimmung und Stil-Konsistenz.

3. WENN STIL = BEAUTY / FASHION / STUDIO PORTRAIT:
   - Balanciere saubere Studio-Ästhetik (Subsurface Scattering, Catchlights, Rembrandt-Lighting) ohne übertriebene Schmutzspuren.

Gib das Ergebnis IMMER im folgenden JSON-Format zurück (ohne Markdown Code Blocks):
{
  "workflow_meta": {
    "intent": "Kurze Zusammenfassung der Idee",
    "style_category": "Erkannte Kategorie (z.B. Physics-Based Photorealism ODER Stylized Anime / Fantasy Art)",
    "physics_focus_points": ["Angewandte Regeln (z.B. Kausalität & Optik ODER Stil-Harmonie & Farbpalette)"]
  },
  "prompts": {
    "positive_prompt": "Vollständiger Positiv-Prompt auf Englisch. Beginnt mit Stil/Medium, gefolgt von Subjekt, Aktion, Komposition, Licht und modellspezifischen Parametern.",
    "negative_prompt": "Maßgeschneiderter Negativ-Prompt, der Qualitätsprobleme filtert, ohne den gewünschten Kunst- oder Fotostil zu verfälschen"
  },
  "generation_parameters": {
    "aspect_ratio": "16:9",
    "cfg_scale": 5.0,
    "steps": 35,
    "sampler_name": "DPM++ 2M Karras"
  }
}`;

        if (!useAutoBot) {
            // Standard Single Call Optimization
            try {
                const response = await fetch(BACKEND_API_URL + '/api/optimize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        goal: context,
                        model: model,
                        system_prompt: systemPrompt,
                        lm_url: lmUrl
                    })
                });
                
                if (!response.ok) throw new Error("API Fehler");
                const data = await response.json();
                const jsonStr = data.optimized_goal;
                
                const res = extractJSON(jsonStr);
                document.getElementById('codeBlock').textContent = JSON.stringify(res, null, 2);
                Prism.highlightElement(document.getElementById('codeBlock'));
                showToast("KI JSON erfolgreich generiert!");
                btn.disabled = false; spinner.style.display = 'none';
            } catch(e) { 
                console.error(e.message);
                showToast("Fehler: " + e.message, true); 
                btn.disabled = false; spinner.style.display = 'none';
            }
        } else {
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
                        level: document.getElementById('autoBotLevel').value
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
                                    lastGeneratedData = res;
                                    renderExportPayload();
                                    if (res.prompts?.positive_prompt) {
                                        saveToHistory(res.prompts.positive_prompt);
                                    }
                                    document.getElementById('codeBlock').textContent = JSON.stringify(res, null, 2);
                                    Prism.highlightElement(document.getElementById('codeBlock'));
                                    showToast("Auto Bot JSON & Multimodaler Output generiert!");
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
            location, lighting, getVal('lightingSetup'), style,
            getVal('composition'), getVal('focalLength'), getVal('apertureDoF'),
            getVal('filmStock'), getVal('colorGrading'), getVal('vfxParticles'), getVal('surfaceCondition'),
            getVal('opticsLogic'), getVal('detailLevel'), getVal('videoMotionEffect'),
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
        lastGeneratedData = json;
        renderExportPayload();
        saveToHistory(techStr);
        showToast("Static JSON & Multimodaler Output generiert!");
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
        
        const useAutoBot = true; // Always use Auto Bot Streaming
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

        if (!useAutoBot) {
            try {
                const response = await fetch(BACKEND_API_URL + '/api/optimize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        goal: rawContext,
                        model: model,
                        system_prompt: systemPrompt,
                        lm_url: lmUrl
                    })
                });
                
                if (!response.ok) throw new Error("API Fehler");
                const data = await response.json();
                const jsonStr = data.optimized_goal;
                
                const res = extractJSON(jsonStr);
                applyEditResult(res);
                showToast("Edit-KI Prompt erfolgreich generiert!");
                btn.disabled = false; spinner.style.display = 'none';
            } catch(e) { 
                console.error(e.message);
                showToast("Fehler: " + e.message, true); 
                btn.disabled = false; spinner.style.display = 'none';
            }
        } else {
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
                        level: document.getElementById('autoBotLevelEdit').value
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
    }

    function setNanoValue(path, value) {
        if (!value) return;
        const el = document.querySelector(`[data-nano="${path}"]`);
        if (el) {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const parts = path.split('.');
        if (parts.length === 2 && window.nanoState && window.nanoState[parts[0]]) {
            window.nanoState[parts[0]][parts[1]] = value;
        }
    }

    async function optimizeCinePrompt(mode = 't2v') {
        const btnT2v = document.getElementById('optimizeCineBtn');
        const btnI2v = document.getElementById('optimizeCineI2vBtn');
        const spinnerT2v = document.getElementById('cineSpinner');
        const spinnerI2v = document.getElementById('cineI2vSpinner');

        if (mode === 'i2v') {
            if (btnI2v) btnI2v.disabled = true;
            if (spinnerI2v) spinnerI2v.style.display = 'inline-block';
        } else {
            if (btnT2v) btnT2v.disabled = true;
            if (spinnerT2v) spinnerT2v.style.display = 'inline-block';
        }

        const sceneInputVal = document.querySelector('[data-nano="cine.scene"]')?.value || nanoState.cine.scene || "";
        nanoState.cine.scene = sceneInputVal;

        const ci = nanoState.cine;
        let jsonContext = "";
        if (uploadedCineJson) {
            jsonContext = `\nJSON Context from Uploaded File:\n${JSON.stringify(uploadedCineJson, null, 2)}`;
        }

        const aspectRatioVal = document.querySelector('[data-nano="cine.ratio"]')?.value || nanoState.cine.ratio || "--ar 16:9";
        nanoState.cine.ratio = aspectRatioVal;

        const rawContext = `Generation Mode: ${mode.toUpperCase()} (${mode === 'i2v' ? 'Image-to-Video Animation for Uploaded Image' : 'Standalone Text-to-Video / Text-to-Image Generation'})\nScene Description (German/English): ${sceneInputVal}\nCamera Rig: ${ci.cam}, Lens: ${ci.lens}\nSettings: ${ci.focal}, ${ci.aperture}\nFraming/Moves: ${ci.moves.join(', ')}\nAspect Ratio Parameter: ${aspectRatioVal}${jsonContext}`;
        
        const useAutoBot = true; // Always use Auto Bot Streaming
        const model = document.getElementById('modelSelectCine').value;
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;

        let systemPrompt = "";
        if (mode === 'i2v') {
            systemPrompt = `Du bist ein hochspezialisierter Image-to-Video (I2V) Prompt Architect für KIs wie Veo 3.1, Runway Gen-3, Luma Dream Machine und Kling AI.
Deine Aufgabe ist es, für ein BEREITS VORLIEGENDES STARTBILD den perfekten Kamera- und Bewegungs-Prompt zu generieren.

STRIKTE IMAGE-TO-VIDEO REGELN:
1. NIEMALS DAS AUSSEHEN DER ANWESENDEN PERSONEN ODER OBJEKTE BESCHREIBEN: Vermeide jegliche Farbbeschreibungen oder Aussehensdetails (das Hochgeladene Bild zeigt es bereits!).
2. NUR KAMERA & BEWEGUNG BESCHREIBEN: Fokussiere dich zu 100% auf die Kamerabewegung (Camera movement), die Bewegung des Subjekts ab Sekunde 0 (Subject motion), Umwelt-Physik (Environment physics, lighting dynamics, particles) und Sound Design.
3. PRÄZISE WEGMARKEN: Nutze professionelle Kamera-Begriffe (z.B. "Slow steady push-in", "Arc left", "Pan right matching subject pace").

Ausgabe-Format (AUSSCHLIESSLICH dieses JSON zurückgeben):
{
  "cinema_workflow": {
    "intent": "Image-to-Video Motion Animation for Uploaded Reference Image",
    "rig_details": "Camera setup: ${ci.cam} with ${ci.lens} (${ci.focal}, ${ci.aperture})",
    "light_setup": "Volumetric light shift, environmental particles, and dynamic shadows"
  },
  "prompts": {
    "technical_prompt": "Camera movement trajectory: ${ci.moves.join(', ') || 'Slow push-in'}. Shutter speed and motion blur specs.",
    "scene_prompt": "Subject motion: [Aktion]. Environment physics: [Partikel, Licht, Rauch]. Sound design: [Audio].",
    "final_prompt": "Camera movement: ${ci.moves.join(', ') || 'Slow push-in'}. Subject motion: Action starts immediately. Environment physics: Dynamic lighting and particle drift. Sound design: Atmospheric audio."
  }
}`;
        } else {
            systemPrompt = `Du bist ein Experte für das Optimieren von Text-to-Video / Text-to-Image Prompts für Diffusionsmodelle (wie Midjourney, Flux, Veo 3.1).
Deine Aufgabe ist es, einen vollständigen, bildgewaltigen Prompt für eine Neu-Generierung zu erstellen.

STRIKTE TEXT-TO-VIDEO REGELN:
1. STRUKTUR: [Subjekt/Charakter] -> [Aktion/Pose] -> [Umgebung/Atmosphäre] -> [Kamera-Rig/Licht].
2. ASPECT RATIO PFLICHT: Füge am Ende von 'final_prompt' ZWINGEND den Parameter '${aspectRatioVal}' an!

Ausgabe-Format (AUSSCHLIESSLICH dieses JSON zurückgeben):
{
  "cinema_workflow": {
    "intent": "Full Text-to-Video / Text-to-Image Standalone Generation",
    "rig_details": "${ci.cam} with ${ci.lens} (${ci.focal}, ${ci.aperture})",
    "light_setup": "Cinematic lighting setup with deep contrast and volumetric haze"
  },
  "prompts": {
    "technical_prompt": "Camera framing: ${ci.moves.join(', ') || 'Static framing'}. Lens & film stock emulation specs.",
    "scene_prompt": "Detailed subject description, clothes, expression, environment and weather.",
    "final_prompt": "Cinematic shot of [Subject], [Action], [Environment], shot on ${ci.cam} with ${ci.lens} ${ci.focal} ${ci.aperture}, ${aspectRatioVal}"
  }
}`;
        }
        
        function applyCineResult(res) {
            document.getElementById('out-cine-tech').innerHTML = `
                <b>Mode:</b> ${mode.toUpperCase()} (${mode === 'i2v' ? 'Image-to-Video Motion' : 'Text-to-Video Full Gen'})<br>
                <b>Intent:</b> ${res.cinema_workflow?.intent || ""}<br>
                <b>Rig:</b> ${res.cinema_workflow?.rig_details || ""}<br>
                <b>Lighting:</b> ${res.cinema_workflow?.light_setup || ""}
            `;
            document.getElementById('out-cine-scene').innerText = res.prompts?.scene_prompt || "";
            document.getElementById('out-cine-final').textContent = JSON.stringify(res, null, 2);
            if (window.Prism) Prism.highlightElement(document.getElementById('out-cine-final'));
        }

        if (!useAutoBot) {
            // Standard Single Call Optimization
            try {
                const response = await fetch(BACKEND_API_URL + '/api/optimize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        goal: rawContext,
                        model: model,
                        system_prompt: systemPrompt,
                        lm_url: lmUrl
                    })
                });
                
                if (!response.ok) throw new Error("API Fehler");
                const data = await response.json();
                const jsonStr = data.optimized_goal;
                
                const res = extractJSON(jsonStr);
                applyCineResult(res);
                showToast(`Cinema-KI JSON (${mode.toUpperCase()}) erfolgreich generiert!`);
            } catch(e) { 
                console.error(e.message);
                showToast("Fehler: " + e.message, true); 
            } finally {
                if (btnT2v) btnT2v.disabled = false;
                if (btnI2v) btnI2v.disabled = false;
                if (spinnerT2v) spinnerT2v.style.display = 'none';
                if (spinnerI2v) spinnerI2v.style.display = 'none';
            }
        } else {
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
                        level: document.getElementById('autoBotLevelCine').value
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
                                    showToast(`Cinema Auto Bot JSON (${mode.toUpperCase()}) erfolgreich generiert!`);
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
            } finally {
                if (btnT2v) btnT2v.disabled = false;
                if (btnI2v) btnI2v.disabled = false;
                if (spinnerT2v) spinnerT2v.style.display = 'none';
                if (spinnerI2v) spinnerI2v.style.display = 'none';
            }
        }
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
        const veoEditBtn = document.getElementById('subTabVeoEditBtn');
        const camDirBtn = document.getElementById('subTabCamDirBtn');
        const rigContent = document.getElementById('cineRigContent');
        const veoContent = document.getElementById('veoStudioContent');
        const veoEditContent = document.getElementById('veoEditContent');
        const camDirContent = document.getElementById('cameraDirectorContent');
        
        if(rigBtn) rigBtn.style.background = 'transparent';
        if(veoBtn) veoBtn.style.background = 'transparent';
        if(veoEditBtn) veoEditBtn.style.background = 'transparent';
        if(camDirBtn) camDirBtn.style.background = 'transparent';
        
        if(rigContent) rigContent.style.display = 'none';
        if(veoContent) veoContent.style.display = 'none';
        if(veoEditContent) veoEditContent.style.display = 'none';
        if(camDirContent) camDirContent.style.display = 'none';

        if (tabId === 'cine-rig') {
            if(rigBtn) rigBtn.style.background = 'var(--primary)';
            if(rigContent) rigContent.style.display = 'grid';
        } else if (tabId === 'veo-studio') {
            if(veoBtn) veoBtn.style.background = 'var(--primary)';
            if(veoContent) veoContent.style.display = 'flex';
        } else if (tabId === 'veo-edit') {
            if(veoEditBtn) veoEditBtn.style.background = 'var(--primary)';
            if(veoEditContent) veoEditContent.style.display = 'grid';
            if(window.initVeoEditModule) window.initVeoEditModule();
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

    window.updateVeoModeHighlight = function() {
        const mode = document.getElementById('veoModeSelect')?.value || 't2v';
        const t2vBtn = document.getElementById('veoAiBtn');
        const i2vBtn = document.getElementById('veoI2vBtn');

        if (mode === 'i2v') {
            if (i2vBtn) {
                i2vBtn.style.transform = 'scale(1.05)';
                i2vBtn.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.6)';
            }
            if (t2vBtn) {
                t2vBtn.style.transform = 'scale(1)';
                t2vBtn.style.boxShadow = 'none';
            }
        } else {
            if (t2vBtn) {
                t2vBtn.style.transform = 'scale(1.05)';
                t2vBtn.style.boxShadow = '0 0 15px rgba(99, 102, 241, 0.6)';
            }
            if (i2vBtn) {
                i2vBtn.style.transform = 'scale(1)';
                i2vBtn.style.boxShadow = 'none';
            }
        }
    };

    window.generateVeoPrompt = async function(forcedMode) {
        const aiBtn = document.getElementById('veoAiBtn');
        const i2vBtn = document.getElementById('veoI2vBtn');
        const spinner = document.getElementById('veoSpinner');
        const i2vSpinner = document.getElementById('veoI2vSpinner');
        
        const mode = forcedMode || document.getElementById('veoModeSelect')?.value || 't2v';
        const vals = getVeoFields();
        
        if (vals.Subjekt === "[LEER]" && vals.Aktion === "[LEER]") {
            showToast("Mindestens Subjekt und Aktion müssen ausgefüllt sein!", true);
            return;
        }

        if (mode === 'i2v') {
            if (i2vBtn) i2vBtn.disabled = true;
            if (i2vSpinner) i2vSpinner.style.display = 'inline-block';
        } else {
            if (aiBtn) aiBtn.disabled = true;
            if (spinner) spinner.style.display = 'inline-block';
        }
        
        document.getElementById('veo-output-container').style.display = 'none';

        vals.Stil = document.getElementById('veo_style').value;
        const useAutoBot = true; // Always use Auto Bot Streaming
        const model = document.getElementById('modelSelectVeo').value;
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;

        const systemPrompt = mode === 'i2v' ? `STRIKTE ROLLE: Du bist ein universeller, multimodaler Prompt-Engineer für IMAGE-TO-VIDEO (I2V) KI-Videogeneratoren (Veo 3.1, Runway Gen-3, Luma Dream Machine, Kling AI, Sora).

MULTIMODALES GEDANKEN-MODELL (ALLE MOTIVE: PERSONEN, VEHIKEL, DRONEN, SHAMPOO-FLASCHEN, ESSEN, LANDSCHAFTEN, CHRACTER, ANIME):
Egal was der Nutzer eingegeben hat (Auto, Mensch, Produktflasche, Drache, Landschaft, Gebäude, Mahlzeit): Stelle dir vor, genau dieses Foto existiert bereits als fertiges Startbild!

DEINE AUFGABE:
Erstelle einen reinen ANIMATIONS- & KAMERABFEHL, um genau dieses vorliegende Foto (egal welches Motiv) flüssig und realistisch zu animieren.

UNIVERSAL-REGELN FÜR I2V (MULTIMODAL):
1. KAMERA ZUERST: Starte den Prompt IMMER mit der Kamerabewegung (z.B. "Camera movement: slow push-in shot...", "orbiting camera shot...", "tracking shot...").
2. STRIKTE NORM FÜR DAS MOTIV (KEINE OPTIK-WIEDERHOLUNG): Verwende für das Hauptmotiv NUR das neutrale Wort (z.B. "the subject", "the person", "the product", "the vehicle"). Es ist STRENGSTENS VERBOTEN, Farbadjektive, Lackierungen oder optische Merkmale (wie 'matte-black', 'blue LEDs', 'red dress', 'gold') im gesamten Prompt zu erwähnen, selbst wenn der Nutzer sie im Formular stehen hat!
3. DYNAMIK & PHYSIK PASSEND ZUM MOTIV:
   - Bei Personen/Charakteren: Mimikwechsel, Gestik, Haarwehen im Wind, Blickrichtung.
   - Bei Produkten/Flaschen: Wasserperlen, die heruntertropfen, Flüssigkeitsspritzer, rotierendes Studio-Licht.
   - Bei Vehikeln/Objekten: Fahrt, Funken, Hitzeflimmern, Reifen-Spin, Staub.
   - Bei Landschaften/Architektur: Ziehende Wolken, Lichtwechsel, flackernde Neonschilder, Laub im Wind.
4. SOUND DESIGN: Ergänze das perfekt zum Motiv passende natürliche Sound-Design.

EXAKTES PROMPT-FORMAT:
"Camera movement: [Kamerabewegung]. Subject motion: [Exakte Bewegung/Animation des neutralen Motivs]. Environment physics and particles: [Bewegte Umwelt, Lichtwechsel & Partikel]. Sound design: [Natürlicher Ton/Sounds]."

Antworte AUSSCHLIESSLICH mit diesem englischen I2V Prompt. Keine Begrüßung.` 
: `Du bist ein professioneller Prompt-Engineer für die High-End Video-KI 'Veo 3.1' (Text-to-Video).
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

        const structuredInput = mode === 'i2v' ? `MODUS: UNIVERSAL IMAGE-TO-VIDEO (Stelle dir das vorliegende Foto dieses Motivs vor und erstelle NUR den Befehl, um genau dieses Foto zum Leben zu erwecken)
- Hauptmotiv im vorliegenden Foto: ${vals.Subjekt}
- Auszuführende Bewegung/Animation: ${vals.Aktion}
- Umwelt-Dynamik, Physik & Licht: ${vals.FX}
- Setting-Entwicklung: ${vals.Setting}
- Kamerabewegung: ${vals.Kamera}
- Sound Design: ${vals.Audio}`
: `MODUS: TEXT-TO-VIDEO (Erstelle das Bild und die Szene komplett neu)
- Subjekt: ${vals.Subjekt}
- Aktion/Bewegung: ${vals.Aktion}
- Umwelt/Effekte: ${vals.FX}
- Setting/Beleuchtung: ${vals.Setting}
- Kameraführung: ${vals.Kamera}
- Sound Design: ${vals.Audio}
- Ästhetischer Stil: ${vals.Stil}`;

        if (!useAutoBot) {
            try {
                const response = await fetch(BACKEND_API_URL + '/api/optimize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        goal: structuredInput,
                        model: model,
                        system_prompt: systemPrompt,
                        lm_url: lmUrl
                    })
                });
                
                if (!response.ok) throw new Error("API Fehler");
                const data = await response.json();
                
                let cleanContent = data.optimized_goal.replace(/^["']|["']$/g, '').replace(/^(Here is the prompt:|Prompt:)/i, '').trim();
                document.getElementById('veoFinalPrompt').innerText = cleanContent;
                document.getElementById('veo-output-container').style.display = 'block';
                showToast("Veo Prompt erfolgreich erstellt!");
            } catch (e) {
                console.error(e);
                showToast("Fehler: " + e.message, true);
            } finally {
                aiBtn.disabled = false;
                spinner.style.display = 'none';
            }
        } else {
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
                        level: document.getElementById('autoBotLevelVeo').value
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
                if (aiBtn) aiBtn.disabled = false;
                if (i2vBtn) i2vBtn.disabled = false;
                if (spinner) spinner.style.display = 'none';
                if (i2vSpinner) i2vSpinner.style.display = 'none';
            }
        }
    };

    window.copyVeoToClipboard = function() {
        navigator.clipboard.writeText(document.getElementById('veoFinalPrompt').innerText);
        showToast("Veo 3.1 Prompt in die Zwischenablage kopiert! 📋");
    };

    /* =========================================
       MODULE: VIDEO BEARBEITEN (V2V & EDITING PRESETS)
       ========================================= */
    const veoEditPresets = {
        cam_angle: {
            title: "1. 🎥 Camera angle change (Kamerawinkel ändern)",
            descDe: "Erstelle diese Szene aus einem neuen Kamerawinkel neu. Behalte Hauptmotiv, Aktion und wichtige Details konsistent.",
            templateEn: "Recreate this scene from a {cam_angle}. Keep {subject}, {action}, and {details} consistent. Adjust lighting, shadows, and background perspective to match the new angle.",
            templateDe: "Erstelle diese Szene aus einem {cam_angle} neu. Behalte {subject}, {action} und {details} konsistent. Passe Beleuchtung, Schatten und Hintergrundperspektive an den neuen Winkel an.",
            exampleEn: "Recreate this scene from a low-angle hero shot. Keep the speaker, action, and outfit consistent. Adjust the lighting, shadows, and background perspective to match the new angle.",
            exampleDe: "Erstelle diese Szene aus einem Low-Angle-Hero-Shot neu. Behalte den Sprecher, die Aktion und die Kleidung konsistent. Passe Beleuchtung, Schatten und Hintergrundperspektive an den neuen Winkel an.",
            fields: [
                { id: "cam_angle", label: "Neuer Kamerawinkel / Perspektive", placeholder: "z.B. low-angle hero shot" },
                { id: "subject", label: "Hauptmotiv (das unverändert bleibt)", placeholder: "z.B. the speaker" },
                { id: "action", label: "Aktion / Bewegung", placeholder: "z.B. the action" },
                { id: "details", label: "Wichtige Details (Outfit, Gesicht)", placeholder: "z.B. the outfit and face" }
            ],
            defaults: { cam_angle: "low-angle hero shot", subject: "the speaker", action: "the action", details: "the outfit and face" }
        },
        outfit: {
            title: "2. 👕 Outfit change (Outfit ändern)",
            descDe: "Ändere das Outfit der Person in einen neuen Stil, während Gesicht, Körperform und Bewegung exakt erhalten bleiben.",
            templateEn: "Change {subject}'s outfit into {new_outfit}. Keep {keep_details} unchanged. Make the outfit move naturally with the body. Match the lighting and shadows of the original video.",
            templateDe: "Ändere {subject}'s Outfit in {new_outfit}. Behalte {keep_details} unverändert. Lass das Outfit natürlich mit dem Körper mitbewegen. Passe Beleuchtung und Schatten an das Originalvideo an.",
            exampleEn: "Change my outfit into a black luxury streetwear look. Keep my face, body shape, pose, and movement unchanged. Make the outfit move naturally with the body. Match the lighting and shadows of the original video.",
            exampleDe: "Ändere mein Outfit in einen schwarzen Luxury-Streetwear-Look. Behalte mein Gesicht, meine Körperform, Pose und Bewegung unverändert. Lass das Outfit natürlich mit dem Körper mitbewegen. Passe Beleuchtung und Schatten an das Originalvideo an.",
            fields: [
                { id: "subject", label: "Person / Model", placeholder: "z.B. my, the person's" },
                { id: "new_outfit", label: "Neuer Outfit-Stil", placeholder: "z.B. a black luxury streetwear look" },
                { id: "keep_details", label: "Unveränderliche Details", placeholder: "z.B. face, body shape, pose, and movement" }
            ],
            defaults: { subject: "my", new_outfit: "a black luxury streetwear look", keep_details: "face, body shape, pose, and movement" }
        },
        obj_remove: {
            title: "3. 🗑️ Object removal (Objekt entfernen)",
            descDe: "Entferne ein ungewolltes Objekt aus dem Video und fülle den Raum natürlich mit dem umgebenden Hintergrund auf.",
            templateEn: "Remove {obj_to_remove} from this video. Fill the space naturally using the surrounding {bg_context}. Keep {keep_details} unchanged. Make the edit clean and realistic.",
            templateDe: "Entferne {obj_to_remove} aus diesem Video. Fülle den Raum natürlich mit dem umgebenden {bg_context}. Behalte {keep_details} unverändert. Mache den Schnitt sauber und realistisch.",
            exampleEn: "Remove the water bottle from this video. Fill the space naturally using the surrounding table and background. Keep the person, lighting, and camera movement unchanged. Make the edit clean and realistic.",
            exampleDe: "Entferne die Wasserflasche aus diesem Video. Fülle den Raum natürlich mit dem umgebenden Tisch und Hintergrund. Behalte die Person, Beleuchtung und Kamerabewegung unverändert. Mache den Schnitt sauber und realistisch.",
            fields: [
                { id: "obj_to_remove", label: "Zu entfernendes Objekt", placeholder: "z.B. the water bottle" },
                { id: "bg_context", label: "Umgebender Hintergrund / Kontext", placeholder: "z.B. table and background" },
                { id: "keep_details", label: "Unveränderliche Elemente", placeholder: "z.B. the person, lighting, and camera movement" }
            ],
            defaults: { obj_to_remove: "the water bottle", bg_context: "surrounding table and background", keep_details: "the person, lighting, and camera movement" }
        },
        bg_replace: {
            title: "4. 🏙️ Background replacement (Hintergrund ersetzen)",
            descDe: "Ersetze die Umgebung durch einen völlig neuen Ort, während Hauptmotiv, Beleuchtung und Winkel exakt angepasst werden.",
            templateEn: "Replace the background with {new_location}. Keep {subject} exactly the same. Match the lighting, shadows, and camera angle so it looks real. Do not change {keep_details}.",
            templateDe: "Ersetze den Hintergrund durch {new_location}. Behalte {subject} exakt gleich. Passe Beleuchtung, Schatten und Kamerawinkel so an, dass es real wirkt. Ändere nicht {keep_details}.",
            exampleEn: "Replace the background with a modern podcast studio. Keep the speaker exactly the same. Match the lighting, shadows, and camera angle so it looks real. Do not change the face, clothing, voice, or lip movement.",
            exampleDe: "Ersetze den Hintergrund durch ein modernes Podcast-Studio. Behalte den Sprecher exakt gleich. Passe Beleuchtung, Schatten und Kamerawinkel so an, dass es real wirkt. Ändere nicht Gesicht, Kleidung, Stimme oder Lippenbewegung.",
            fields: [
                { id: "new_location", label: "Neuer Ort / Hintergrund", placeholder: "z.B. a modern podcast studio" },
                { id: "subject", label: "Hauptmotiv / Sprecher", placeholder: "z.B. the speaker" },
                { id: "keep_details", label: "Geschützte Details", placeholder: "z.B. face, clothing, voice, or lip movement" }
            ],
            defaults: { new_location: "a modern podcast studio", subject: "the speaker", keep_details: "the face, clothing, voice, or lip movement" }
        },
        obj_replace: {
            title: "5. 🔄 Object replacement (Objekt ersetzen)",
            descDe: "Tausche ein bestimmtes Objekt im Video gegen ein neues aus, inklusive realistischer Schatten und Reflexionen.",
            templateEn: "Replace {old_obj} with {new_obj}. Keep the same camera angle and lighting. Make {new_obj} match the scene with realistic shadows, reflections, and movement. Do not change {keep_details}.",
            templateDe: "Ersetze {old_obj} durch {new_obj}. Behalte denselben Kamerawinkel und dieselbe Beleuchtung. Lass {new_obj} mit realistischen Schatten, Reflexionen und Bewegungen in die Szene passen. Ändere nicht {keep_details}.",
            exampleEn: "Replace the plastic cup with a glowing glass cube. Keep the same camera angle and lighting. Make the cube match the scene with realistic shadows, reflections, and movement. Do not change the person or background.",
            exampleDe: "Ersetze den Plastikbecher durch einen leuchtenden Glaskubus. Behalte denselben Kamerawinkel und dieselbe Beleuchtung. Lass den Kubus mit realistischen Schatten, Reflexionen und Bewegungen in die Szene passen. Ändere nicht die Person oder den Hintergrund.",
            fields: [
                { id: "old_obj", label: "Altes Objekt (wird ersetzt)", placeholder: "z.B. the plastic cup" },
                { id: "new_obj", label: "Neues Objekt", placeholder: "z.B. a glowing glass cube" },
                { id: "keep_details", label: "Unveränderte Elemente", placeholder: "z.B. the person or background" }
            ],
            defaults: { old_obj: "the plastic cup", new_obj: "a glowing glass cube", keep_details: "the person or background" }
        },
        style_transfer: {
            title: "6. 🎨 Style transfer (Stilübertragung)",
            descDe: "Wende einen künstlerischen oder nostalgischen Film-Look auf das Video an, inklusive Textur, Korn und Farbton.",
            templateEn: "Apply a {style} look to this video. Add {style_details}, {color_tone}, and {texture}. Keep {subject} unchanged. Do not change {keep_details}.",
            templateDe: "Wende einen {style}-Look auf dieses Video an. Füge {style_details}, {color_tone} und {texture} hinzu. Behalte {subject} unverändert. Ändere nicht {keep_details}.",
            exampleEn: "Apply a 1970s film look to this video. Add soft grain, warm colour tone, and vintage lens texture. Keep the speaker unchanged. Do not change the face, clothing, or background.",
            exampleDe: "Wende einen 1970er-Film-Look auf dieses Video an. Füge weiches Korn, warmen Farbton und Vintage-Linsen-Textur hinzu. Behalte den Sprecher unverändert. Ändere nicht Gesicht, Kleidung oder Hintergrund.",
            fields: [
                { id: "style", label: "Stil / Ära", placeholder: "z.B. 1970s film" },
                { id: "style_details", label: "Stil-Details", placeholder: "z.B. soft grain" },
                { id: "color_tone", label: "Farbton / Color Tone", placeholder: "z.B. warm colour tone" },
                { id: "texture", label: "Textur", placeholder: "z.B. vintage lens texture" },
                { id: "subject", label: "Hauptmotiv", placeholder: "z.B. the speaker" },
                { id: "keep_details", label: "Unveränderte Details", placeholder: "z.B. face, clothing, or background" }
            ],
            defaults: { style: "1970s film", style_details: "soft grain", color_tone: "warm colour tone", texture: "vintage lens texture", subject: "the speaker", keep_details: "the face, clothing, or background" }
        },
        product_ad: {
            title: "7. 📢 Product ad edit (Produktwerbung bearbeiten)",
            descDe: "Verwandle ein einfaches Produktvideo in einen professionellen High-End Werbespot.",
            templateEn: "Edit this product video into a premium ad for {product_name}. Keep the product's {product_features} unchanged. Add {bg_style}, {lighting_style}, and {camera_move}. Make the product look realistic and high-quality.",
            templateDe: "Bearbeite dieses Produktvideo zu einer Premium-Werbung für {product_name}. Behalte {product_features} des Produkts unverändert. Füge {bg_style}, {lighting_style} und {camera_move} hinzu. Lass das Produkt realistisch und hochwertig aussehen.",
            exampleEn: "Edit this product video into a premium ad for a smartwatch. Keep the product's shape, colour, logo, and screen unchanged. Add a clean black studio background, soft spotlighting, and slow close-up camera movement. Make the product look realistic and high-quality.",
            exampleDe: "Bearbeite dieses Produktvideo zu einer Premium-Werbung für eine Smartwatch. Behalte Form, Farbe, Logo und Bildschirm des Produkts unverändert. Füge einen sauberen schwarzen Studio-Hintergrund, weiches Spotlicht und langsame Nahaufnahme-Kamerabewegung hinzu. Lass das Produkt realistisch und hochwertig aussehen.",
            fields: [
                { id: "product_name", label: "Produktname / Marke", placeholder: "z.B. a smartwatch" },
                { id: "product_features", label: "Geschützte Merkmale", placeholder: "z.B. shape, colour, logo, and screen" },
                { id: "bg_style", label: "Hintergrundstil", placeholder: "z.B. a clean black studio background" },
                { id: "lighting_style", label: "Beleuchtungsstil", placeholder: "z.B. soft spotlighting" },
                { id: "camera_move", label: "Kamerabewegung", placeholder: "z.B. slow close-up camera movement" }
            ],
            defaults: { product_name: "a smartwatch", product_features: "shape, colour, logo, and screen", bg_style: "a clean black studio background", lighting_style: "soft spotlighting", camera_move: "slow close-up camera movement" }
        },
        action_fx: {
            title: "8. ⚡ Action effects (Aktionseffekte)",
            descDe: "Füge visuelle Effekte (Funken, Magie, Rauch, Blitze) an einem exakten Zeitpunkt der Bewegung hinzu.",
            templateEn: "Add {vfx} to this video when {action_trigger}. The effect should start exactly when {timing}. Keep {keep_details} unchanged. Make the effect match the motion naturally.",
            templateDe: "Füge {vfx} zu diesem Video hinzu, wenn {action_trigger}. Der Effekt soll genau dann starten, wenn {timing}. Behalte {keep_details} unverändert. Lass den Effekt natürlich zur Bewegung passen.",
            exampleEn: "Add neon sparks to this video when the skateboard lands. The effect should start exactly when the wheels touch the ground. Keep the skateboarder, background, and camera movement unchanged. Make the effect match the motion naturally.",
            exampleDe: "Füge Neon-Funken zu diesem Video hinzu, wenn das Skateboard landet. Der Effekt soll genau dann starten, wenn die Räder den Boden berühren. Behalte den Skateboarder, Hintergrund und Kamerabewegung unverändert. Lass den Effekt natürlich zur Bewegung passen.",
            fields: [
                { id: "vfx", label: "Visueller Effekt (VFX)", placeholder: "z.B. neon sparks" },
                { id: "action_trigger", label: "Auslösende Aktion", placeholder: "z.B. the skateboard lands" },
                { id: "timing", label: "Exakter Zeitpunkt (Timing-Detail)", placeholder: "z.B. the wheels touch the ground" },
                { id: "keep_details", label: "Unveränderte Elemente", placeholder: "z.B. the skateboarder, background, and camera movement" }
            ],
            defaults: { vfx: "neon sparks", action_trigger: "the skateboard lands", timing: "the wheels touch the ground", keep_details: "the skateboarder, background, and camera movement" }
        },
        face_protect: {
            title: "9. 👤 Face and identity protection (Gesicht und Identität schützen)",
            descDe: "Schütze das Gesicht und die Identität einer Person zu 100%, während nur spezifische Dinge verändert werden.",
            templateEn: "Keep {subject}'s face exactly the same as the original video. Do not change {facial_features}. Only edit {edit_target}.",
            templateDe: "Behalte {subject}'s Gesicht exakt wie im Originalvideo. Ändere nicht {facial_features}. Bearbeite nur {edit_target}.",
            exampleEn: "Keep my face exactly the same as the original video. Do not change my eyes, nose, mouth, skin tone, hair, or facial expression. Only edit the background and lighting.",
            exampleDe: "Behalte mein Gesicht exakt wie im Originalvideo. Ändere nicht meine Augen, Nase, Mund, Hautton, Haare oder den Gesichtsausdruck. Bearbeite nur den Hintergrund und die Beleuchtung.",
            fields: [
                { id: "subject", label: "Person / Model", placeholder: "z.B. my" },
                { id: "facial_features", label: "Geschützte Gesichtsmerkmale", placeholder: "z.B. my eyes, nose, mouth, skin tone, hair, or facial expression" },
                { id: "edit_target", label: "Was allein bearbeitet werden soll", placeholder: "z.B. the background and lighting" }
            ],
            defaults: { subject: "my", facial_features: "my eyes, nose, mouth, skin tone, hair, or facial expression", edit_target: "the background and lighting" }
        },
        cine_upgrade: {
            title: "10. 🎬 Cinematic upgrade (Cinematischer Upgrade)",
            descDe: "Werte ein beliebiges Alltags-Video optisch auf Hollywood-Kino-Niveau mit warmem Licht und Luxus-Stimmung auf.",
            templateEn: "Edit this video into a cinematic clip. Keep {subject} unchanged. Improve the lighting to look like {lighting_style}. Add {cinematic_elements}. Do not change {keep_details}.",
            templateDe: "Bearbeite dieses Video zu einem cinematischen Clip. Behalte {subject} unverändert. Verbessere die Beleuchtung, sodass sie wie {lighting_style} aussieht. Füge {cinematic_elements} hinzu. Ändere nicht {keep_details}.",
            exampleEn: "Edit this video into a cinematic clip. Keep my face and outfit unchanged. Improve the lighting to look like warm sunset light. Add slow camera movement, soft contrast, and a calm luxury mood. Do not change the background or my body movement.",
            exampleDe: "Bearbeite dieses Video zu einem cinematischen Clip. Behalte mein Gesicht und Outfit unverändert. Verbessere die Beleuchtung, sodass sie wie warmes Sonnenuntergangslicht aussieht. Füge langsame Kamerabewegung, weichen Kontrast und eine ruhige Luxury-Stimmung hinzu. Ändere nicht den Hintergrund oder meine Körperbewegung.",
            fields: [
                { id: "subject", label: "Unverändertes Hauptmotiv", placeholder: "z.B. my face and outfit" },
                { id: "lighting_style", label: "Neuer Beleuchtungsstil", placeholder: "z.B. warm sunset light" },
                { id: "cinematic_elements", label: "Kamera-, Farb- & Stimmungs-Elemente", placeholder: "z.B. slow camera movement, soft contrast, and a calm luxury mood" },
                { id: "keep_details", label: "Unveränderte Details", placeholder: "z.B. the background or my body movement" }
            ],
            defaults: { subject: "my face and outfit", lighting_style: "warm sunset light", cinematic_elements: "slow camera movement, soft contrast, and a calm luxury mood", keep_details: "the background or my body movement" }
        }
    };

    let veoEditInitialized = false;

    window.initVeoEditModule = function() {
        if (veoEditInitialized) return;
        veoEditInitialized = true;
        window.applyVeoEditPreset();
    };

    window.applyVeoEditPreset = function() {
        const key = document.getElementById('veoEditPresetSelect')?.value || 'cam_angle';
        const preset = veoEditPresets[key];
        if (!preset) return;

        // Render info box
        document.getElementById('veoEditTitle').innerText = preset.title;
        document.getElementById('veoEditDescDe').innerText = preset.descDe;
        document.getElementById('veoEditTemplateEn').innerText = preset.templateEn;
        document.getElementById('veoEditExample').innerHTML = `<strong>Beispiel:</strong> ${preset.exampleDe}`;

        // Render input fields
        const container = document.getElementById('veoEditInputsContainer');
        if (container) {
            container.innerHTML = '';

            preset.fields.forEach(field => {
                const fieldWrapper = document.createElement('div');
                fieldWrapper.innerHTML = `
                    <label style="font-size: 0.78rem; color: #cbd5e1; font-weight: 600; margin-bottom: 4px; display: block;">
                        ${field.label}:
                    </label>
                    <input type="text" id="veoEditField_${field.id}" placeholder="${field.placeholder}" value="${preset.defaults[field.id] || ''}" style="width: 100%; padding: 8px 12px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 6px; font-size: 0.82rem;">
                `;
                container.appendChild(fieldWrapper);
            });
        }

        const outContainer = document.getElementById('veoEditOutputContainer');
        if (outContainer) outContainer.style.display = 'none';
    };

    window.loadVeoEditExampleValues = function() {
        const key = document.getElementById('veoEditPresetSelect')?.value || 'cam_angle';
        const preset = veoEditPresets[key];
        if (!preset) return;

        preset.fields.forEach(field => {
            const input = document.getElementById(`veoEditField_${field.id}`);
            if (input && preset.defaults[field.id]) {
                input.value = preset.defaults[field.id];
            }
        });
        showToast("Beispielwerte geladen! 💡");
    };

    window.generateVeoEditPrompt = function() {
        const key = document.getElementById('veoEditPresetSelect')?.value || 'cam_angle';
        const preset = veoEditPresets[key];
        if (!preset) return;

        let promptEn = preset.templateEn;
        let promptDe = preset.templateDe;

        preset.fields.forEach(field => {
            const val = document.getElementById(`veoEditField_${field.id}`)?.value.trim() || field.placeholder;
            promptEn = promptEn.replace(`{${field.id}}`, val);
            promptDe = promptDe.replace(`{${field.id}}`, val);
        });

        document.getElementById('veoEditFinalPromptEn').innerText = promptEn;
        document.getElementById('veoEditFinalPromptDe').innerText = promptDe;
        document.getElementById('veoEditOutputContainer').style.display = 'block';

        showToast("Video Editing Prompt erfolgreich generiert! ✂️🎬");
    };

    window.askVeoEditAdv = async function() {
        const inputEl = document.getElementById('veoEditAdvInput');
        const userText = inputEl?.value.trim();
        if (!userText) {
            showToast("Bitte gib eine Idee oder Änderungswunsch ein!", true);
            return;
        }

        const chatBox = document.getElementById('veoEditChatBox');
        const btn = document.getElementById('veoEditAdvBtn');
        const spinner = document.getElementById('veoEditAdvSpinner');

        // Add user message to chat
        const userMsg = document.createElement('div');
        userMsg.style.cssText = "padding: 8px 12px; border-radius: 8px; line-height: 1.4; max-width: 90%; background: var(--primary); align-self: flex-end; color: white; font-size: 0.8rem;";
        userMsg.innerText = userText;
        chatBox.appendChild(userMsg);
        chatBox.scrollTop = chatBox.scrollHeight;
        inputEl.value = '';

        if (btn) btn.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';

        const lmUrl = document.getElementById('apiUrl')?.value.trim() || HARDCODED_URL;

        const systemPrompt = `Du bist ein hochspezialisierter KI-Regisseur und Copilot für Video-zu-Video Editing (Gemini 3.5 / Veo 3.1 / Runway Gen-3 / Sora).
Nutzer-Wunsch: "${userText}"

Deine Aufgabe:
Wähle aus den folgenden 10 Kategorien GENAU EINE aus, die am besten zum Nutzer-Wunsch passt:
1. "cam_angle": Kamerawinkel / Perspektive ändern (Camera angle change)
2. "outfit": Outfit / Kleidung ändern (Outfit change)
3. "obj_remove": Objekt / Gegenstand / störende Person entfernen (Object removal)
4. "bg_replace": Hintergrund / Ort komplett ersetzen (Background replacement)
5. "obj_replace": Ein Objekt gegen ein anderes austauschen (Object replacement)
6. "style_transfer": Künstlerischer Stil / Epoche / Filmlook (Style transfer)
7. "product_ad": Werbespot / Produktwerbung bearbeiten (Product ad edit)
8. "action_fx": Visuelle Effekte / VFX / Funken / Rauch bei Aktion (Action effects)
9. "face_protect": Gesicht & Identität schützen, nur Umfeld ändern (Face protection)
10. "cine_upgrade": Allgemeiner cinematische Aufwertung / Licht-Upgrade (Cinematic upgrade)

Antworte STRIKT mit folgendem JSON-Format (kein Markdown drumherum, nur valides JSON):
{
  "preset": "EXAKTE_KEY_OBEN",
  "explanation": "Kurze freundliche deutsche Erklärung für den Nutzer, was ausgewählt und eingestellt wurde.",
  "fields": {
    // Fülle HIER ALLE benötigten Feld-Variablen in präzisem ENGLISCH aus, die für diese gewählte Kategorie nötig sind:
    // cam_angle: "cam_angle", "subject", "action", "details"
    // outfit: "subject", "new_outfit", "keep_details"
    // obj_remove: "obj_to_remove", "bg_context", "keep_details"
    // bg_replace: "new_location", "subject", "keep_details"
    // obj_replace: "old_obj", "new_obj", "keep_details"
    // style_transfer: "style", "style_details", "color_tone", "texture", "subject", "keep_details"
    // product_ad: "product_name", "product_features", "bg_style", "lighting_style", "camera_move"
    // action_fx: "vfx", "action_trigger", "timing", "keep_details"
    // face_protect: "subject", "facial_features", "edit_target"
    // cine_upgrade: "subject", "lighting_style", "cinematic_elements", "keep_details"
  }
}`;

        try {
            const resp = await fetch(BACKEND_API_URL + '/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goal: userText,
                    model: 'gemini-3.5-flash-lite',
                    system_prompt: systemPrompt,
                    lm_url: lmUrl
                })
            });

            if (!resp.ok) throw new Error("Fehler beim Abrufen der KI-Antwort");

            const data = await resp.json();
            const jsonRes = extractJSON(data.optimized_goal);

            if (jsonRes && jsonRes.preset && veoEditPresets[jsonRes.preset]) {
                // 1. Change Preset Dropdown
                const selectEl = document.getElementById('veoEditPresetSelect');
                if (selectEl) selectEl.value = jsonRes.preset;

                // 2. Apply Preset Layout & Fields
                window.applyVeoEditPreset();

                // 3. Fill in generated field values into inputs
                if (jsonRes.fields) {
                    Object.keys(jsonRes.fields).forEach(fKey => {
                        const inputField = document.getElementById(`veoEditField_${fKey}`);
                        if (inputField) inputField.value = jsonRes.fields[fKey];
                    });
                }

                // 4. Generate Output Prompt
                window.generateVeoEditPrompt();

                // 5. Add AI response to Chat
                const aiMsg = document.createElement('div');
                aiMsg.style.cssText = "padding: 10px 12px; border-radius: 8px; line-height: 1.4; max-width: 95%; background: var(--bg-input); border: 1px solid var(--border-color); align-self: flex-start; color: var(--text-main); font-size: 0.8rem;";
                aiMsg.innerHTML = `🤖 <strong>Copilot:</strong> ${jsonRes.explanation || "Kategorie wurde gewählt und alle Felder befüllt!"}`;
                chatBox.appendChild(aiMsg);
                chatBox.scrollTop = chatBox.scrollHeight;

                showToast("KI Copilot hat Kategorie gewählt & alle Felder optimiert! ✨");
            } else {
                throw new Error("Ungültiges KI-Format empfangen");
            }
        } catch (err) {
            console.error(err);
            const errMsg = document.createElement('div');
            errMsg.style.cssText = "padding: 8px 12px; border-radius: 8px; line-height: 1.4; max-width: 90%; background: rgba(239,68,68,0.2); border: 1px solid #ef4444; align-self: flex-start; color: #fca5a5; font-size: 0.8rem;";
            errMsg.innerText = `Fehler: ${err.message}`;
            chatBox.appendChild(errMsg);
            showToast("Fehler bei KI-Verarbeitung", true);
        } finally {
            if (btn) btn.disabled = false;
            if (spinner) spinner.style.display = 'none';
        }
    };

    // --- VISION IMAGE TO VIDEO HANDLERS ---
    let uploadedVisionBase64 = null;

    function processVisionFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            showToast("Bitte nur Bilddateien (JPG, PNG, WebP) hochladen!", true);
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            uploadedVisionBase64 = e.target.result;
            const imgEl = document.getElementById('visionImagePreview');
            const previewContainer = document.getElementById('visionImagePreviewContainer');
            const btnRun = document.getElementById('btnRunVision');
            const label = document.getElementById('visionUploadLabel');

            if (imgEl) imgEl.src = uploadedVisionBase64;
            if (previewContainer) previewContainer.style.display = 'block';
            if (btnRun) btnRun.style.display = 'block';
            if (label) label.innerText = `Bild geladen: ${file.name}`;
            
            showToast("Bild erfolgreich geladen! Gemini Flash Lite Vision steht bereit. 👁️");
        };
        reader.readAsDataURL(file);
    }

    window.handleVisionImageUpload = function(event) {
        const file = event.target.files[0];
        if (file) processVisionFile(file);
    };

    // Attach Drag & Drop listeners
    document.addEventListener('DOMContentLoaded', () => {
        setupDragAndDrop();
    });

    function setupDragAndDrop() {
        const dropZone = document.getElementById('visionDropZone');
        if (!dropZone) return;

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.style.borderColor = 'var(--accent)';
                dropZone.style.background = 'rgba(16, 185, 129, 0.15)';
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.style.borderColor = 'var(--primary)';
                dropZone.style.background = 'rgba(30, 41, 59, 0.4)';
            }, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                processVisionFile(files[0]);
            }
        }, false);
    }
    setTimeout(setupDragAndDrop, 500);

    // --- CINEMA EDIT VISION & JSON HANDLERS ---
    let uploadedCineBase64 = null;
    let uploadedCineJson = null;

    function processCineFile(file) {
        if (!file) return;

        if (file.name.endsWith('.json') || file.type === 'application/json') {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    uploadedCineJson = JSON.parse(e.target.result);
                    uploadedCineBase64 = null;
                    const btnRun = document.getElementById('btnRunCineVision');
                    const btnI2vDirect = document.getElementById('btnRunCineI2vDirect');
                    const label = document.getElementById('cineUploadLabel');
                    if (btnRun) btnRun.style.display = 'inline-block';
                    if (btnI2vDirect) btnI2vDirect.style.display = 'inline-block';
                    if (label) label.innerText = `JSON geladen: ${file.name}`;
                    showToast("JSON-Datei geladen! Gemini 3.5 Flash Lite bereit. 📄✨");
                } catch (err) {
                    showToast("Fehlerhafte JSON-Datei!", true);
                }
            };
            reader.readAsText(file);
        } else if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                uploadedCineBase64 = e.target.result;
                uploadedCineJson = null;
                const imgEl = document.getElementById('cineVisionPreview');
                const previewContainer = document.getElementById('cineVisionPreviewContainer');
                const btnRun = document.getElementById('btnRunCineVision');
                const btnI2vDirect = document.getElementById('btnRunCineI2vDirect');
                const label = document.getElementById('cineUploadLabel');

                if (imgEl) imgEl.src = uploadedCineBase64;
                if (previewContainer) previewContainer.style.display = 'block';
                if (btnRun) btnRun.style.display = 'inline-block';
                if (btnI2vDirect) btnI2vDirect.style.display = 'inline-block';
                if (label) label.innerText = `Bild geladen: ${file.name}`;

                showToast("Referenzbild geladen! Image-to-Video & Vision bereit. 👁️🎬");
            };
            reader.readAsDataURL(file);
        } else {
            showToast("Bitte ein Bild (JPG/PNG) oder eine JSON-Datei hochladen!", true);
        }
    }

    window.handleCineVisionUpload = function(event) {
        const file = event.target.files[0];
        if (file) processCineFile(file);
    };

    window.clearCineVisionImage = function() {
        uploadedCineBase64 = null;
        uploadedCineJson = null;
        const input = document.getElementById('cineVisionInput');
        const previewContainer = document.getElementById('cineVisionPreviewContainer');
        const btnRun = document.getElementById('btnRunCineVision');
        const btnI2vDirect = document.getElementById('btnRunCineI2vDirect');
        const label = document.getElementById('cineUploadLabel');

        if (input) input.value = '';
        if (previewContainer) previewContainer.style.display = 'none';
        if (btnRun) btnRun.style.display = 'none';
        if (btnI2vDirect) btnI2vDirect.style.display = 'none';
        if (label) label.innerText = 'Bild / JSON hierhin ziehen oder wählen';
    };

    window.runCineVisionAnalysis = async function() {
        if (!uploadedCineBase64 && !uploadedCineJson) {
            showToast("Bitte zuerst ein Bild oder eine JSON hochladen!", true);
            return;
        }

        const btnRun = document.getElementById('btnRunCineVision');
        const spinner = document.getElementById('cineVisionSpinner');
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;

        if (btnRun) btnRun.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';

        showToast("Gemini 3.5 Flash Lite analysiert Motiv & stellt Kamera-Rig ein... 👁️🎬");

        try {
            const resp = await fetch(`${BACKEND_API_URL}/api/analyze-cine-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: uploadedCineBase64,
                    json_data: uploadedCineJson,
                    lm_url: lmUrl
                })
            });

            const data = await resp.json();

            if (resp.ok && data) {
                // 1. Auto-fill Scene Description & sync nanoState
                if (data.scene_description) {
                    setNanoValue('cine.scene', data.scene_description);
                }

                // 2. Auto-set Virtual Rig Dropdowns
                if (data.rig) {
                    if (data.rig.camera) setNanoValue('cine.camera', data.rig.camera);
                    if (data.rig.lens) setNanoValue('cine.lens', data.rig.lens);
                    if (data.rig.focal) setNanoValue('cine.focal', data.rig.focal);
                    if (data.rig.aperture) setNanoValue('cine.aperture', data.rig.aperture);
                }

                // 3. Trigger prompt preview update ONLY (do not auto-trigger AI optimization)
                updateNanoPrompts();

                showToast(`Vision & Auto-Rig abgeschlossen! (${data.identified_concept || 'Konzept erkannt'}) – Passe deine Einstellungen an & klicke auf 'KI Prompt Generieren'. 🎬✨`);
            } else {
                showToast("Fehler bei Vision-Analyse: " + (data.error || "Unbekannter Fehler"), true);
            }
        } catch (e) {
            console.error(e);
            showToast("Verbindungsfehler: " + e.message, true);
        } finally {
            if (btnRun) btnRun.disabled = false;
            if (spinner) spinner.style.display = 'none';
        }
    };

    function helperSetCineDragDrop() {
        const dropZone = document.getElementById('cineVisionDropZone');
        if (!dropZone) return;

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.style.borderColor = 'var(--accent)';
                dropZone.style.background = 'rgba(16, 185, 129, 0.15)';
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.style.borderColor = 'var(--primary)';
                dropZone.style.background = 'rgba(30, 41, 59, 0.4)';
            }, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                processCineFile(files[0]);
            }
        }, false);
    }
    setTimeout(helperSetCineDragDrop, 600);

    window.clearVisionImage = function() {
        uploadedVisionBase64 = null;
        const input = document.getElementById('visionImageInput');
        const previewContainer = document.getElementById('visionImagePreviewContainer');
        const btnRun = document.getElementById('btnRunVision');
        const label = document.getElementById('visionUploadLabel');

        if (input) input.value = '';
        if (previewContainer) previewContainer.style.display = 'none';
        if (btnRun) btnRun.style.display = 'none';
        if (label) label.innerText = 'Bild auswählen oder hierhin ziehen';
    };

    window.runVisionAnalysis = async function() {
        if (!uploadedVisionBase64) {
            showToast("Bitte zuerst ein Bild hochladen!", true);
            return;
        }

        const btnRun = document.getElementById('btnRunVision');
        const spinner = document.getElementById('visionSpinner');
        const veoOutput = document.getElementById('veo-output-container');
        const veoPromptEl = document.getElementById('veoFinalPrompt');
        const userHint = document.getElementById('veo_action')?.value || '';
        const lmUrl = document.getElementById('apiUrl').value.trim() || HARDCODED_URL;

        if (btnRun) btnRun.disabled = true;
        if (spinner) spinner.style.display = 'inline-block';
        if (veoOutput) veoOutput.style.display = 'none';

        showToast("Gemini 3.5 Flash Lite Vision analysiert jetzt dein Bild... 👁️✨");

        try {
            const resp = await fetch(`${BACKEND_API_URL}/api/analyze-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: uploadedVisionBase64,
                    hint: userHint,
                    lm_url: lmUrl
                })
            });

            const data = await resp.json();

            if (resp.ok && data) {
                // 1. Auto-fill Form Fields if returned by Vision AI
                if (data.fields) {
                    if (data.fields.subject && document.getElementById('veo_subject')) document.getElementById('veo_subject').value = data.fields.subject;
                    if (data.fields.action && document.getElementById('veo_action')) document.getElementById('veo_action').value = data.fields.action;
                    if (data.fields.fx && document.getElementById('veo_fx')) document.getElementById('veo_fx').value = data.fields.fx;
                    if (data.fields.setting && document.getElementById('veo_setting')) document.getElementById('veo_setting').value = data.fields.setting;
                    if (data.fields.camera && document.getElementById('veo_camera')) document.getElementById('veo_camera').value = data.fields.camera;
                    if (data.fields.sound && document.getElementById('veo_sound')) document.getElementById('veo_sound').value = data.fields.sound;
                }

                // 2. Post reasoning to Co-Pilot Chat
                const chatBox = document.getElementById('veoChatBox');
                if (chatBox) {
                    const msgDiv = document.createElement('div');
                    msgDiv.style.margin = '10px 0';
                    msgDiv.style.padding = '10px';
                    msgDiv.style.borderRadius = '8px';
                    msgDiv.style.fontSize = '0.8rem';
                    msgDiv.style.lineHeight = '1.4';
                    msgDiv.style.background = 'rgba(16, 185, 129, 0.15)';
                    msgDiv.style.border = '1px solid #10b981';
                    msgDiv.innerHTML = `<strong>👁️ Vision-Analyse: ${data.identified_subject || 'Bild analysiert'}</strong><br><br>` +
                        `Ich habe dein Bild optisch gescannt, das Motiv erkannt und die Formularfelder links automatisch für dich ausgefüllt!<br><br>` +
                        `Du kannst nun beliebige Werte in den Feldern anpassen oder mir im Chat Fragen stellen!`;
                    chatBox.appendChild(msgDiv);
                    chatBox.scrollTop = chatBox.scrollHeight;
                }

                // 3. Render Final I2V Prompt Output
                const finalPrompt = data.final_i2v_prompt || data;
                if (veoPromptEl) veoPromptEl.innerText = typeof finalPrompt === 'string' ? finalPrompt : JSON.stringify(finalPrompt, null, 2);
                if (veoOutput) veoOutput.style.display = 'block';

                showToast(`Vision-Analyse abgeschlossen! Formularfelder befüllt (${data.identified_subject || 'Bild erkannt'}) 🎬`);
            } else {
                showToast("Fehler bei Vision-Analyse: " + (data.error || "Unbekannter Fehler"), true);
            }
        } catch (e) {
            console.error(e);
            showToast("Verbindungsfehler: " + e.message, true);
        } finally {
            if (btnRun) btnRun.disabled = false;
            if (spinner) spinner.style.display = 'none';
        }
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
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const msg = isLocal
                ? "Server-Verbindung fehlgeschlagen. Ist der Flask-Server gestartet?"
                : "Server-Verbindung fehlgeschlagen. Bitte versuche es in wenigen Sekunden erneut (der Online-Server wacht eventuell gerade aus dem Ruhezustand auf).";
            chat.innerHTML += `<div class="msg ai" style="padding:10px 14px; border-radius:8px; line-height:1.4; max-width:90%; background:var(--bg-input); border:1px solid var(--border-color); align-self:flex-start; color:var(--danger);">${msg}</div>`; 
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

    document.addEventListener('DOMContentLoaded', () => {
        if (typeof renderHistory === 'function') renderHistory();
    });

    /* =========================================
       AUTOBOT STORYBOARD ENGINE
       ========================================= */
    let lastGeneratedStoryboard = null;

    window.loadAutoBotPreset = function(type) {
        const conceptEl = document.getElementById('autobot_concept');
        const durationEl = document.getElementById('autobot_duration');
        const genreEl = document.getElementById('autobot_genre');
        const aspectEl = document.getElementById('autobot_aspect');
        const charEl = document.getElementById('autobot_character');

        if (type === 'cyberpunk') {
            if (conceptEl) conceptEl.value = "Eine Streetwear-Athletin rennt bei Nacht durch die regenfeuchten Straßen von Neontokio. Neonreklamen spiegeln sich in den Pfützen, während eine FPV-Drohne sie eng verfolgt.";
            if (durationEl) durationEl.value = "20";
            if (genreEl) genreEl.value = "Sci-Fi Cyberpunk";
            if (aspectEl) aspectEl.value = "9:16";
            if (charEl) charEl.value = "@Runner_Yuki, 26-jährige japanische Athletin mit neon-türkisem Zopf und reflektierender Jacke";
        } else if (type === 'perfume') {
            if (conceptEl) conceptEl.value = "Eine elegante Frau in einem weißen Seidenkleid greift an einem Marmortisch nach einem Flakon Parfüm in einer sonnendurchfluteten Pariser Dachwohnung.";
            if (durationEl) durationEl.value = "30";
            if (genreEl) genreEl.value = "High-End Commercial";
            if (aspectEl) aspectEl.value = "16:9";
            if (charEl) charEl.value = "@Sophia, 30-jährige Elegante Frau mit dunklem glatten Haar und seidener Kleidung";
        } else if (type === 'scifi') {
            if (conceptEl) conceptEl.value = "Ein Erkundungs-Ingenieur entdeckt in den Eishöhlen eines fremden Planeten ein uraltes leuchtendes Artefakt, das plötzlich Impulse aussendet.";
            if (durationEl) durationEl.value = "60";
            if (genreEl) genreEl.value = "Hollywood Storytelling";
            if (aspectEl) aspectEl.value = "2.39:1";
            if (charEl) charEl.value = "@Commander_Jax, 40-jähriger Astronaut im mattschwarzen Raumanzug mit beleuchtetem Visier";
        } else if (type === 'shortfilm') {
            if (conceptEl) conceptEl.value = "Ein geheimnisvoller Uhrmacher baut in einer historischen Werkstatt an einer Zeitmaschine. Als er das letzte Zahnrad einsetzt, zieht ein Lichtstrudel durch den Raum.";
            if (durationEl) durationEl.value = "120";
            if (genreEl) genreEl.value = "Hollywood Storytelling";
            if (aspectEl) aspectEl.value = "16:9";
            if (charEl) charEl.value = "@Master_Kael, 65-jähriger Uhrmacher mit silbernem Haar, Lupe und lederner Arbeitsschürze";
        }
        showToast("Preset geladen! Klicke auf 'Storyboard Generieren'. ✨");
    };

    window.runAutoBotStoryboard = async function() {
        const concept = document.getElementById('autobot_concept')?.value.trim();
        if (!concept) {
            showToast("Bitte gib eine Idee oder ein Konzept ein!", true);
            return;
        }

        const duration = document.getElementById('autobot_duration')?.value || "30";
        const aspect_ratio = document.getElementById('autobot_aspect')?.value || "16:9";
        const genre = document.getElementById('autobot_genre')?.value || "Hollywood Storytelling";
        const pacing_style = document.getElementById('autobot_pacing')?.value || "balanced";
        const character = document.getElementById('autobot_character')?.value.trim() || "";
        const model = document.getElementById('autobot_model')?.value || "gemini-3.5-flash";
        const lmUrl = document.getElementById('apiUrl')?.value.trim() || HARDCODED_URL;

        const btn = document.getElementById('btnRunAutoBotStoryboard');
        const consoleDiv = document.getElementById('autoBotConsoleStoryboard');
        const logDiv = document.getElementById('autoBotLogStoryboard');
        const statusSpan = document.getElementById('autoBotStatusStoryboard');

        if (btn) btn.disabled = true;
        if (consoleDiv) consoleDiv.style.display = 'block';
        if (logDiv) logDiv.innerHTML = '';
        if (statusSpan) {
            statusSpan.innerText = 'Regie-Board läuft...';
            statusSpan.style.color = 'var(--warning)';
        }

        showToast("AutoBot v2.0 startet Multi-Agent Storyboard Erstellung... 🎬⚡");

        try {
            const response = await fetch(BACKEND_API_URL + '/api/autobot/storyboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    concept: concept,
                    duration: duration,
                    aspect_ratio: aspect_ratio,
                    genre: genre,
                    pacing_style: pacing_style,
                    character: character,
                    model: model,
                    lm_url: lmUrl
                })
            });

            if (!response.ok) throw new Error(`HTTP Status ${response.status}`);

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
                            if (payload.event === 'log') {
                                const logEntry = document.createElement('div');
                                logEntry.innerHTML = `<span style="color:#64748b;">[AutoBot]</span> ${payload.message}`;
                                logDiv.appendChild(logEntry);
                                logDiv.scrollTop = logDiv.scrollHeight;
                            } else if (payload.event === 'final_storyboard') {
                                statusSpan.innerText = 'Vollständig';
                                statusSpan.style.color = 'var(--success)';
                                lastGeneratedStoryboard = payload.data;
                                renderStoryboardOutput(payload.data);
                                showToast("Storyboard & Character Bible erfolgreich generiert! 🎬✨");
                            } else if (payload.event === 'final_storyboard_raw') {
                                statusSpan.innerText = 'Abgeschlossen (Raw)';
                                statusSpan.style.color = 'var(--accent)';
                                const parsed = extractJSON(payload.raw);
                                lastGeneratedStoryboard = parsed;
                                renderStoryboardOutput(parsed);
                                showToast("Storyboard generiert!");
                            } else if (payload.event === 'error') {
                                statusSpan.innerText = 'Fehler';
                                statusSpan.style.color = '#ef4444';
                                showToast("Fehler: " + payload.message, true);
                            }
                        } catch (err) {
                            console.error("SSE JSON parse error:", err);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(e);
            if (statusSpan) {
                statusSpan.innerText = 'Verbindungsfehler';
                statusSpan.style.color = '#ef4444';
            }
            showToast("Verbindungsfehler: " + e.message, true);
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    function renderStoryboardOutput(data) {
        const emptyState = document.getElementById('storyboard-empty-state');
        const resultsWrapper = document.getElementById('storyboard-results-wrapper');
        const titleEl = document.getElementById('sb-title');
        const narrativeEl = document.getElementById('sb-narrative');
        const metaDuration = document.getElementById('sb-meta-duration');
        const metaShots = document.getElementById('sb-meta-shots');
        const metaPacing = document.getElementById('sb-meta-pacing');
        const metaRatio = document.getElementById('sb-meta-ratio');
        const masterSceneCard = document.getElementById('sb-master-scene-card');
        const masterScenePromptEl = document.getElementById('sb-master-scene-prompt');
        const charBibleCard = document.getElementById('sb-char-bible-card');
        const charBibleContent = document.getElementById('sb-char-bible-content');
        const shotsContainer = document.getElementById('sb-shots-container');

        if (emptyState) emptyState.style.display = 'none';
        if (resultsWrapper) resultsWrapper.style.display = 'flex';

        const meta = data.storyboard_meta || {};
        if (titleEl) titleEl.innerText = meta.title || "KI Kurzfilm Storyboard";
        if (narrativeEl) narrativeEl.innerText = meta.core_narrative || "Multi-Shot Storyboard für Veo 3.1 & Google Flow";
        if (metaDuration) metaDuration.innerText = `${meta.total_duration_seconds || 30}s`;
        if (metaShots) metaShots.innerText = `${meta.total_shots || data.shots?.length || 4} Variable Shots`;
        if (metaPacing) metaPacing.innerText = meta.pacing_profile || "Balanced";
        if (metaRatio) metaRatio.innerText = meta.aspect_ratio || "16:9";

        // Render BigPicture Master Scene T2I Prompt
        if (meta.master_scene_t2i_prompt && masterSceneCard && masterScenePromptEl) {
            masterSceneCard.style.display = 'block';
            masterScenePromptEl.innerText = meta.master_scene_t2i_prompt;
        } else if (masterSceneCard) {
            masterSceneCard.style.display = 'none';
        }

        // Render Character Bible Drawer
        if (data.character_bible && charBibleCard && charBibleContent) {
            charBibleCard.style.display = 'block';
            charBibleContent.innerText = JSON.stringify(data.character_bible, null, 2);
        } else if (charBibleCard) {
            charBibleCard.style.display = 'none';
        }

        if (shotsContainer) {
            shotsContainer.innerHTML = '';
            const shots = data.shots || [];

            shots.forEach((shot, index) => {
                const shotCard = document.createElement('div');
                shotCard.className = 'card';
                shotCard.style.borderLeft = '4px solid var(--primary)';
                shotCard.style.position = 'relative';

                const keyframePrompt = shot.keyframe_image_prompt || shot.veo_8_part_prompt || shot.prompt || "";
                const i2vPrompt = shot.i2v_motion_prompt || shot.veo_8_part_prompt || "";
                const fallbackPrompt = shot.veo_8_part_prompt || "";

                shotCard.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid var(--border-color); padding-bottom:8px;">
                        <span style="font-weight:bold; color:var(--accent); font-size:1rem;">
                            🎬 Shot ${shot.shot_number || index + 1} (${shot.duration_seconds || 8}s)
                        </span>
                        <span style="background:rgba(79,70,229,0.2); color:var(--primary); padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:600;">
                            ${shot.framing || 'Medium Shot'}
                        </span>
                    </div>

                    <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px; display:flex; gap:12px; flex-wrap:wrap;">
                        <div><strong>Kamera:</strong> ${shot.camera_motion || 'Static'}</div>
                        <div><strong>In/Out:</strong> ${shot.transition_in || 'Standard'} ➔ ${shot.transition_out || 'Cut'}</div>
                    </div>

                    <!-- STEP 1: KEYFRAME PROMPT -->
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px; border:1px solid var(--primary); margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:0.75rem; color:var(--primary); font-weight:bold;">🖼️ SCHRITT 1: TEXT-TO-IMAGE KEYFRAME PROMPT (Nano Banana / Midjourney)</span>
                            <button class="btn btn-secondary" onclick="copyShotSubPrompt('keyframe-${index}')" style="padding:2px 8px; font-size:0.7rem;">
                                <i class="fa-regular fa-copy"></i> Keyframe Kopieren
                            </button>
                        </div>
                        <p id="keyframe-${index}" style="font-family:'JetBrains Mono', monospace; font-size:0.8rem; color:#e2e8f0; margin:0; white-space:pre-wrap; word-break:break-word;">${keyframePrompt}</p>
                    </div>

                    <!-- STEP 2: IMAGE-TO-VIDEO ANIMATION PROMPT -->
                    <div style="background:var(--bg-input); padding:10px; border-radius:6px; border:1px solid var(--accent); margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:0.75rem; color:var(--accent); font-weight:bold;">📽️ SCHRITT 2: IMAGE-TO-VIDEO ANIMATION PROMPT (Veo 3.1 / Runway / Luma)</span>
                            <button class="btn btn-secondary" onclick="copyShotSubPrompt('i2v-${index}')" style="padding:2px 8px; font-size:0.7rem;">
                                <i class="fa-regular fa-copy"></i> Motion-Prompt Kopieren
                            </button>
                        </div>
                        <p id="i2v-${index}" style="font-family:'JetBrains Mono', monospace; font-size:0.8rem; color:#e2e8f0; margin:0; white-space:pre-wrap; word-break:break-word;">${i2vPrompt}</p>
                    </div>

                    ${shot.audio_cues ? `
                    <div style="font-size:0.78rem; color:var(--text-muted); background:rgba(0,0,0,0.15); padding:6px 10px; border-radius:4px;">
                        🔊 <strong>Audio & Lipsync:</strong> ${shot.audio_cues}
                    </div>` : ''}
                `;
                shotsContainer.appendChild(shotCard);
            });
        }
    }

    window.copyMasterScenePrompt = function() {
        const el = document.getElementById('sb-master-scene-prompt');
        if (!el || !el.innerText) return;
        navigator.clipboard.writeText(el.innerText).then(() => {
            showToast("🖼️ BigPicture Master-Scene Prompt kopiert! 📋✨");
        }).catch(err => {
            showToast("Fehler beim Kopieren", true);
        });
    };

    window.copyCharacterBibleJson = function() {
        const el = document.getElementById('sb-char-bible-content');
        if (!el || !el.innerText) return;
        navigator.clipboard.writeText(el.innerText).then(() => {
            showToast("👤 Character Bible JSON kopiert! 📋✨");
        }).catch(err => {
            showToast("Fehler beim Kopieren", true);
        });
    };

    window.copyShotSubPrompt = function(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        navigator.clipboard.writeText(el.innerText).then(() => {
            showToast("Prompt in die Zwischenablage kopiert! 📋✨");
        }).catch(err => {
            showToast("Fehler beim Kopieren", true);
        });
    };

    window.copyAllStoryboardPrompts = function() {
        if (!lastGeneratedStoryboard || !lastGeneratedStoryboard.shots) {
            showToast("Kein Storyboard vorhanden!", true);
            return;
        }
        const text = lastGeneratedStoryboard.shots.map((s, idx) => `--- SHOT ${idx + 1} (${s.duration_seconds || 8}s) ---\n${s.veo_8_part_prompt || s.prompt}`).join("\n\n");
        navigator.clipboard.writeText(text).then(() => {
            showToast("Alle Shots in die Zwischenablage kopiert! 📋✨");
        });
    };

    window.copyStoryboardJson = function() {
        if (!lastGeneratedStoryboard) {
            showToast("Kein Storyboard vorhanden!", true);
            return;
        }
        const jsonStr = JSON.stringify(lastGeneratedStoryboard, null, 2);
        navigator.clipboard.writeText(jsonStr).then(() => {
            showToast("Vollständiges Storyboard JSON kopiert! 💾");
        });
    };