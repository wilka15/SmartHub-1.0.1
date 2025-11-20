// script.js — SmartHub AI (logic)
// Работает с index.html и styles.css, использует прокси:
// https://openai-proxy-ucgy.onrender.com/v1/responses
// Настройки сохраняются в localStorage

const API_URL = "https://openai-proxy-ucgy.onrender.com/v1/responses";

let lastAIMessage = "";
let autoVoice = false;
let voiceGender = "female"; // 'female' или 'male'
let typeSpeed = 18; // ms per char
let speechRate = 1.0;
let speakingUtterance = null;

// ---------- UI helpers ----------
const chatElem = document.getElementById("chat");
function scrollToBottom(){
  chatElem.scrollTop = chatElem.scrollHeight;
}

// ---------- Settings persistence ----------
function saveSettings(){
  const S = {
    theme: document.body.dataset.theme || "dark",
    autoVoice,
    voiceGender,
    typeSpeed,
    speechRate
  };
  try { localStorage.setItem("smarthub_settings", JSON.stringify(S)); } catch(e){ console.warn(e); }
}

function loadSettings(){
  try {
    const raw = localStorage.getItem("smarthub_settings");
    if(!raw) return;
    const S = JSON.parse(raw);
    document.body.dataset.theme = S.theme || "dark";
    document.getElementById("themeSelect").value = document.body.dataset.theme;
    autoVoice = !!S.autoVoice;
    document.getElementById("autoVoice").checked = autoVoice;
    voiceGender = S.voiceGender || "female";
    document.getElementById("voiceSelect").value = voiceGender;
    typeSpeed = S.typeSpeed || 18;
    document.getElementById("typeSpeed").value = typeSpeed;
    speechRate = S.speechRate || 1.0;
    document.getElementById("speechRate").value = speechRate;
  } catch(e){
    console.warn("loadSettings error", e);
  }
}

// ---------- Settings UI actions ----------
function toggleSettings(){
  const panel = document.getElementById("settingsPanel");
  panel.classList.toggle("open");
}
function setTheme(v){
  document.body.dataset.theme = v;
  saveSettings();
}
function toggleAutoVoice(v){
  autoVoice = !!v;
  saveSettings();
}
function setVoiceGender(v){
  voiceGender = v;
  saveSettings();
}
function setSpeechRate(v){
  speechRate = Number(v) || 1.0;
  saveSettings();
}
function setTypeSpeed(v){
  typeSpeed = Number(v) || 18;
  saveSettings();
}
function clearHistory(){
  if(!confirm("Очистить историю чата?")) return;
  chatElem.innerHTML = "";
  try { localStorage.removeItem("smarthub_history"); } catch(e){/*ignore*/ }
}

// ---------- Avatar creation ----------
function createAvatar(isUser){
  const a = document.createElement("div");
  a.className = "avatar";
  if(isUser){
    // simple circle with letter U
    a.innerHTML = '<div style="width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#111;background:linear-gradient(135deg,#ffd28a,#ff9a76)">U</div>';
  } else {
    const s = document.createElement("div");
    s.className = "sphere";
    a.appendChild(s);
  }
  return a;
}

// ---------- Add message to chat ----------
// options: { typing: boolean, speaking: boolean }
function addMessage(text, sender, options = {}){
  const wrap = document.createElement("div");
  wrap.className = "msg " + (sender === "user" ? "user" : "ai");

  const avatar = createAvatar(sender === "user");
  if(options.speaking) avatar.classList.add("speaking");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if(options.typing){
    const t = document.createElement("div");
    t.className = "typing";
    t.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    bubble.appendChild(t);
  } else {
    bubble.textContent = text;
  }

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  chatElem.appendChild(wrap);
  scrollToBottom();

  return { wrap, avatar, bubble };
}

// ---------- Typewriter (print text by chars) ----------
async function typeTextInto(element, text, speed){
  element.textContent = "";
  for(let i = 0; i < text.length; i++){
    element.textContent += text[i];
    await new Promise(r => setTimeout(r, speed));
  }
}

// ---------- Send message (uses /v1/responses format) ----------
async function sendMessage(){
  const inputEl = document.getElementById("userInput");
  const text = (inputEl.value || "").trim();
  if(!text) return;
  inputEl.value = "";

  // add user message
  addMessage(text, "user");

  // show typing indicator
  const tNode = addMessage("", "ai", { typing: true, speaking: true });
  const avatar = tNode.avatar;
  avatar.classList.add("speaking");

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4.1-mini", input: text })
    });

    const data = await res.json();

    // extract AI text (support multiple response shapes)
    let aiText = "";
    if(data.output_text) aiText = data.output_text;
    else if(data.output && data.output[0] && data.output[0].content && data.output[0].content[0] && data.output[0].content[0].text) aiText = data.output[0].content[0].text;
    else if(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) aiText = data.choices[0].message.content;
    else aiText = "Сервер вернул неожиданный ответ.";

    lastAIMessage = aiText;

    // remove speaking class
    avatar.classList.remove("speaking");

    // replace typing bubble with typed text
    // find the bubble element (tNode.bubble might be wrapper)
    let targetEl = tNode.bubble;
    // if bubble contains typing div, clear and type into bubble
    targetEl.innerHTML = ""; // clear typing
    await typeTextInto(targetEl, aiText, typeSpeed);

    // auto voice if enabled
    if(autoVoice) speak(aiText);

  } catch(err){
    console.error("sendMessage error", err);
    avatar.classList.remove("speaking");
    tNode.bubble.innerHTML = "Ошибка: не удалось получить ответ от сервера.";
  }
}

// ---------- Speech (synthesis) ----------
function speak(text){
  try {
    stopSpeech();
    const synth = window.speechSynthesis;
    if(!synth) return;
    const voices = synth.getVoices() || [];
    let chosen = null;

    // choose voice heuristically based on gender and ru-language
    if(voices.length){
      // prefer ru voices first
      chosen = voices.find(v => v.lang && v.lang.toLowerCase().startsWith("ru") && (voiceGender === "female" ? /[aeiouy]|anna|alyona|irina|oksana/i.test(v.name) : /oleg|ivan|nikolai|serg|vlad|male|oleg/i.test(v.name)));
      if(!chosen){
        // fallback: any ru voice
        chosen = voices.find(v => v.lang && v.lang.toLowerCase().startsWith("ru"));
      }
      if(!chosen) chosen = voices[0];
    }

    const u = new SpeechSynthesisUtterance(text);
    if(chosen) u.voice = chosen;
    u.rate = speechRate || 1.0;
    if(!chosen) u.lang = "ru-RU";
    speakingUtterance = u;
    synth.speak(u);
    u.onend = () => { speakingUtterance = null; };
  } catch(e){
    console.warn("speak error", e);
  }
}

function stopSpeech(){
  try {
    const s = window.speechSynthesis;
    if(s && s.speaking) s.cancel();
    speakingUtterance = null;
  } catch(e) { /* ignore */ }
}

function speakLast(){
  if(!lastAIMessage) return alert("Нет текста для озвучки");
  speak(lastAIMessage);
}

// ---------- Voice input ----------
function voiceInput(){
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!R) return alert("Ваш браузер не поддерживает распознавание речи");
  const rec = new R();
  rec.lang = "ru-RU";
  rec.start();
  const mic = document.getElementById("micBtn");
  mic.textContent = "●"; mic.style.background = "#ffa200";
  rec.onresult = e => {
    const txt = e.results[0][0].transcript;
    const inputEl = document.getElementById("userInput");
    inputEl.value = txt;
  };
  rec.onend = () => {
    mic.textContent = "🎤"; mic.style.background = "";
  };
}

// ---------- Init ----------
function init(){
  // load settings
  loadSettings();

  // ensure controls reflect settings
  document.getElementById("themeSelect").value = document.body.dataset.theme || "dark";
  document.getElementById("autoVoice").checked = !!autoVoice;
  document.getElementById("voiceSelect").value = voiceGender;
  document.getElementById("typeSpeed").value = typeSpeed;
  document.getElementById("speechRate").value = speechRate;

  // warm voices (some browsers load voices asynchronously)
  window.speechSynthesis.getVoices();

  // status indicator (if present)
  const st = document.getElementById("status");
  if(st) st.textContent = "готов";

  // attach global save on unload
  window.addEventListener("beforeunload", saveSettings);
}

// run init after small delay to allow DOM ready
setTimeout(init, 100);

// expose some functions to global (if used directly by HTML)
window.toggleSettings = toggleSettings;
window.setTheme = setTheme;
window.toggleAutoVoice = toggleAutoVoice;
window.setVoiceGender = setVoiceGender;
window.setSpeechRate = setSpeechRate;
window.setTypeSpeed = setTypeSpeed;
window.clearHistory = clearHistory;
window.sendMessage = sendMessage;
window.voiceInput = voiceInput;
window.speakLast = speakLast;
