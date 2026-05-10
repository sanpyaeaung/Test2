import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Settings, 
  Image as ImageIcon, 
  Download, 
  Trash2, 
  Loader2, 
  Plus, 
  History, 
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Maximize2,
  Video,
  Mic,
  Volume2,
  RefreshCw,
  Play,
  ArrowRight,
  Layout,
  Music
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type, Modality } from "@google/genai";

// --- Types ---
interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  timestamp: number;
  aspectRatio: string;
}

interface Scene {
  id: string;
  text: string;
  imagePrompt: string;
  imageUrl?: string;
  audioUrl?: string;
  isGenerating?: boolean;
}

enum AspectRatio {
  SQUARE = '1:1',
  LANDSCAPE = '16:9',
  PORTRAIT = '9:16',
  PHOTO = '4:3',
  CINEMATIC = '21:9'
}

enum ViewMode {
  GALLERY = 'GALLERY',
  VIDEO_MAKER = 'VIDEO_MAKER'
}

// --- Utilities ---
const cn = (...classes: string[]) => classes.filter(Boolean).join(' ');

function pcmToWav(pcmData: Uint8Array, sampleRate: number = 24000) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + pcmData.length, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, pcmData.length, true);
  return new Blob([header, pcmData], { type: 'audio/wav' });
}

export default function App() {
  // --- State ---
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('GEMINI_CUSTOM_KEY') || '');
  const [showSettings, setShowSettings] = useState(!apiKey);
  const [viewMode, setViewMode] = useState<ViewMode | null>(ViewMode.GALLERY);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // Gallery State
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(AspectRatio.SQUARE);
  const [isGenerating, setIsGenerating] = useState(false);
  const [images, setImages] = useState<GeneratedImage[]>(() => {
    const saved = localStorage.getItem('GEMINI_IMAGE_HISTORY');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);

  // Video Maker State
  const [roughScript, setRoughScript] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isPolishing, setIsPolishing] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [videoDuration, setVideoDuration] = useState(1);
  const [isGeneratingVideoAssets, setIsGeneratingVideoAssets] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem('GEMINI_IMAGE_HISTORY', JSON.stringify(images));
  }, [images]);

  useEffect(() => {
    if (apiKey) {
      localStorage.setItem('GEMINI_CUSTOM_KEY', apiKey);
    }
  }, [apiKey]);

  // --- Handlers ---
  const saveApiKey = (key: string) => {
    setApiKey(key);
    setShowSettings(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  const clearHistory = () => {
    if (confirm('Are you sure you want to clear your generation history?')) {
      setImages([]);
    }
  };

  const deleteImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedImage?.id === id) setSelectedImage(null);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (!apiKey && !process.env.GEMINI_API_KEY) {
      setShowSettings(true);
      setError('Please provide a Gemini API key first.');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const activeKey = apiKey || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey: activeKey! });
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: prompt.trim(),
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: aspectRatio === AspectRatio.CINEMATIC ? '16:9' : aspectRatio,
          }
        },
      });

      let foundImage = false;
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64Data = part.inlineData.data;
          const imageUrl = `data:image/png;base64,${base64Data}`;
          
          const newImage: GeneratedImage = {
            id: crypto.randomUUID(),
            url: imageUrl,
            prompt: prompt.trim(),
            timestamp: Date.now(),
            aspectRatio
          };

          setImages(prev => [newImage, ...prev]);
          setSelectedImage(newImage);
          foundImage = true;
          break;
        }
      }

      if (!foundImage) {
        throw new Error('No image was generated in the response.');
      }

    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Something went wrong during generation.');
    } finally {
      setIsGenerating(false);
    }
  };

  const polishScript = async () => {
    if (!roughScript.trim()) return;
    
    if (!apiKey && !process.env.GEMINI_API_KEY) {
      setShowSettings(true);
      setError('Please provide a Gemini API key to use the Medicine Creator.');
      return;
    }

    setIsPolishing(true);
    setError(null);
    try {
      const activeKey = apiKey || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey: activeKey! });
      
      // Calculate scenes: 6 scenes per minute
      const sceneCount = videoDuration * 6;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `You are an expert in Myanmar Traditional Medicine (ဆေးမီးတို ပညာရှင်). 
Create a detailed, step-by-step healing guide script in Myanmar based on the input concern.
The script MUST have exactly ${sceneCount} scenes.

Return a JSON object with:
"scenes": [
  { "text": "Myanmar narration", "imagePrompt": "English cinematography prompt" }
]

Input: "${roughScript.trim()}"`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    imagePrompt: { type: Type.STRING }
                  },
                  required: ['text', 'imagePrompt']
                }
              }
            },
            required: ['scenes']
          }
        }
      });

      const text = response.text || '';
      const data = JSON.parse(text);
      
      if (!data.scenes || !Array.isArray(data.scenes)) {
        throw new Error('Invalid response structure from AI');
      }

      setScenes(data.scenes.slice(0, sceneCount).map((s: any) => ({ ...s, id: crypto.randomUUID() })));
    } catch (err: any) {
      console.error("Polish Script Error:", err);
      setError("Script polishing failed. Please check your AI key or script content.");
    } finally {
      setIsPolishing(false);
    }
  };

  const previewVoice = async (voiceName: string) => {
    try {
      const activeKey = apiKey || process.env.GEMINI_API_KEY;
      if (!activeKey) {
        setShowSettings(true);
        setError('Please provide a Gemini API key to preview voices.');
        return;
      }
      
      const ai = new GoogleGenAI({ apiKey: activeKey });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: "မင်္ဂလာပါ။ ဤအသံသည် စမ်းသပ်ခြင်းဖြစ်ပါသည်။ အဆင်ပြေပါက ဤအသံကို အသုံးပြုနိုင်ပါသည်။",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
        },
      });
      
      const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('audio/'));
      const audioDataBase64 = audioPart?.inlineData?.data;

      if (audioDataBase64) {
        const binary = atob(audioDataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = pcmToWav(bytes, 24000);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play().catch(e => {
          console.error("Audio play failed:", e);
          setError("Audio playback error. Check browser permissions.");
        });
      }
    } catch (err) {
      setError("Voice preview failed. Please check your API key.");
    }
  };

  const generateSceneAsset = async (sceneId: string, type: 'IMAGE' | 'AUDIO') => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene) return;

    if (!apiKey && !process.env.GEMINI_API_KEY) {
      setShowSettings(true);
      setError('Please provide a Gemini API key to generate assets.');
      return;
    }

    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGenerating: true } : s));
    setError(null);

    try {
      const activeKey = apiKey || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey: activeKey! });

      if (type === 'IMAGE') {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: scene.imagePrompt,
          config: { imageConfig: { aspectRatio: aspectRatio === AspectRatio.CINEMATIC ? '16:9' : aspectRatio } }
        });
        const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (imagePart?.inlineData) {
          const url = `data:image/png;base64,${imagePart.inlineData.data}`;
          setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, imageUrl: url, isGenerating: false } : s));
        }
      } else {
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-tts-preview",
          contents: scene.text,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } }
          },
        });
        const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('audio/'));
        const audioData = audioPart?.inlineData?.data;

        if (audioData) {
          const binary = atob(audioData);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = pcmToWav(bytes, 24000);
          const url = URL.createObjectURL(blob);
          setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, audioUrl: url, isGenerating: false } : s));
        } else {
          throw new Error("No audio data returned from Gemini");
        }
      }
    } catch (err) {
      setError(`Failed to generate ${type.toLowerCase()}.`);
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, isGenerating: false } : s));
    }
  };

  const generateAllAssets = async () => {
    setIsGeneratingVideoAssets(true);
    for (const scene of scenes) {
      if (!scene.imageUrl) await generateSceneAsset(scene.id, 'IMAGE');
      if (!scene.audioUrl) await generateSceneAsset(scene.id, 'AUDIO');
    }
    setIsGeneratingVideoAssets(false);
  };

  const downloadAsset = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const downloadImage = (img: GeneratedImage) => {
    const link = document.createElement('a');
    link.href = img.url;
    link.download = `gemini-image-${img.id.slice(0, 8)}.png`;
    link.click();
  };

  return (
    <div className="h-screen bg-[#0A0A0B] text-slate-200 font-sans selection:bg-blue-500/30 overflow-hidden flex flex-col">
      {/* Header Navigation */}
      <nav className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#0F0F12] shrink-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 hover:bg-white/5 rounded-lg border border-white/10 transition-all text-blue-400"
            title="Menu"
          >
            <Layout className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-tr from-blue-600 to-violet-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-black tracking-tight text-white uppercase flex items-center gap-2">
              GEMINI <span className="text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded text-xs">STUDIO</span>
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          {apiKey && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-green-500/10 rounded-full border border-green-500/20">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest">API Active</span>
            </div>
          )}
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2.5 hover:bg-white/5 rounded-xl border border-white/5 transition-all text-slate-400 hover:text-white"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {/* Main Workspace */}
      <main className="flex-1 overflow-hidden relative flex">
        {/* Sliding Side Menu */}
        <AnimatePresence>
          {isMenuOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMenuOpen(false)}
                className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ x: -300 }}
                animate={{ x: 0 }}
                exit={{ x: -300 }}
                className="absolute top-0 left-0 bottom-0 w-72 z-50 bg-[#0F0F12] border-r border-white/10 p-6 flex flex-col gap-8 shadow-2xl"
              >
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-2">Select Feature</h3>
                  <div className="space-y-1">
                    <button 
                      onClick={() => { setViewMode(ViewMode.GALLERY); setIsMenuOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-xs transition-all",
                        viewMode === ViewMode.GALLERY ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:bg-white/5"
                      )}
                    >
                      <ImageIcon className="w-4 h-4" />
                      Image Studio
                    </button>
                    <button 
                      onClick={() => { setViewMode(ViewMode.VIDEO_MAKER); setIsMenuOpen(false); }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-xs transition-all",
                        viewMode === ViewMode.VIDEO_MAKER ? "bg-violet-600 text-white shadow-lg" : "text-slate-400 hover:bg-white/5"
                      )}
                    >
                      <Video className="w-4 h-4" />
                      Medicine Creator
                    </button>
                  </div>
                </div>

                <div className="mt-auto space-y-4">
                  <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                    <p className="text-[10px] text-slate-500 font-bold uppercase leading-tight">Gemini Model Tier</p>
                    <p className="text-[11px] text-blue-400 mt-1 font-bold">3.1 Flash Preview</p>
                  </div>
                  <button 
                    onClick={() => { setShowSettings(true); setIsMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-xs text-slate-400 hover:bg-white/5 transition-all border border-white/5"
                  >
                    <Settings className="w-4 h-4" />
                    Studio Settings
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {viewMode === ViewMode.GALLERY ? (
            <motion.div 
              key="gallery"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full grid grid-cols-12 overflow-hidden"
            >
              {/* Sidebar Controls */}
              <aside className="col-span-12 lg:col-span-3 border-r border-white/5 bg-[#0F0F12] p-5 flex flex-col gap-5 overflow-y-auto">
                {/* Instructions/Tips */}
                <section>
                  <h3 className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">Studio Instructions</h3>
                  <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
                    အောက်ပါအကွက်တွင် စိတ်ကူးရှိသမျှ ရေးသားပါ။ Gemini AI က သင့်အတွက် အကောင်းဆုံး ပုံရိပ်များကို ဖန်တီးပေးမည်ဖြစ်ပါသည်။
                  </p>
                </section>

                {/* Parameters Section */}
                <section className="space-y-5">
                  <div className="flex flex-col gap-2.5">
                    <div className="flex justify-between items-center text-[8px] font-bold uppercase tracking-widest">
                      <span className="text-slate-500">Aspect Ratio</span>
                      <span className="text-blue-400">{aspectRatio}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {Object.values(AspectRatio).map((ratio) => (
                        <button
                          key={ratio}
                          onClick={() => setAspectRatio(ratio)}
                          className={cn(
                            "py-1 rounded-lg text-[8px] font-bold transition-all border",
                            aspectRatio === ratio 
                              ? "bg-blue-600 border-blue-500 text-white shadow-lg" 
                              : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"
                          )}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/5">
                    <button 
                      onClick={() => setShowSettings(true)}
                      className="w-full py-2 bg-[#16161D] hover:bg-white/5 border border-white/10 rounded-lg text-[9px] font-bold text-slate-300 transition-all flex items-center justify-center gap-2"
                    >
                      {apiKey ? 'Update API Key' : 'Configure API Key'}
                    </button>
                  </div>
                </section>

                {/* API Key Facts */}
                <section className="p-3 bg-blue-500/5 rounded-xl border border-blue-500/10">
                  <h3 className="text-[8px] font-bold text-blue-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Key Stats
                  </h3>
                  <ul className="space-y-1.5">
                    <li className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                      <p className="text-[9px] text-slate-400 leading-tight">ထည့်ထားသော Key ကို Browser တွင် အမြဲသိမ်းဆည်းထားပါမည်။</p>
                    </li>
                    <li className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                      <p className="text-[9px] text-slate-400 leading-tight">Unlimited အသုံးပြုနိုင်မှုမှာ Google Tier ပေါ်တွင် မူတည်ပါသည်။</p>
                    </li>
                  </ul>
                </section>

                <div className="mt-auto pt-4 border-t border-white/5 text-center">
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                    Gemini <span className="text-blue-400">3.1 Flash</span>
                  </p>
                </div>
              </aside>

              {/* Generation Area */}
              <section className="col-span-12 lg:col-span-9 p-5 flex flex-col gap-4 bg-[#0A0A0B] overflow-hidden">
                <div className="flex flex-col gap-2 shrink-0">
                  <div className="relative group">
                    <textarea 
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Artistic vision..."
                      className="w-full h-20 bg-[#16161D] border border-white/5 rounded-xl p-4 text-sm text-white placeholder:text-slate-600 resize-none outline-none focus:border-blue-500/30 transition-all"
                    />
                    <button 
                      onClick={handleGenerate}
                      disabled={isGenerating || !prompt.trim()}
                      className={cn(
                        "absolute bottom-2 right-2 px-4 py-1.5 rounded-lg font-bold transition-all flex items-center gap-2 text-[10px]",
                        isGenerating || !prompt.trim()
                          ? "bg-slate-800 text-slate-500"
                          : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
                      )}
                    >
                      {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {isGenerating ? 'GENERATING...' : 'GENERATE'}
                    </button>
                  </div>
                  {error && (
                    <div className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-[9px] font-bold">
                      <AlertCircle className="w-3 h-3" />
                      {error}
                    </div>
                  )}
                </div>

                <div className="flex-1 relative rounded-xl border border-white/5 overflow-hidden bg-[#16161D]">
                  <AnimatePresence mode="wait">
                    {isGenerating ? (
                      <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                        <span className="text-[9px] font-bold tracking-widest text-slate-500">CREATING ART...</span>
                      </motion.div>
                    ) : selectedImage ? (
                      <motion.div key={selectedImage.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 flex items-center justify-center p-4">
                        <img src={selectedImage.url} alt="" className="max-h-full rounded-lg object-contain shadow-2xl" referrerPolicy="no-referrer" />
                        <button onClick={() => downloadImage(selectedImage)} className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-lg text-white">
                          <Download className="w-4 h-4" />
                        </button>
                      </motion.div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <ImageIcon className="w-8 h-8 text-slate-800" />
                        <p className="text-[9px] font-bold tracking-widest text-slate-700 uppercase">Input prompt to start</p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="h-20 shrink-0 flex flex-col gap-2">
                  <h4 className="text-[8px] font-bold text-slate-600 uppercase tracking-widest">History</h4>
                  <div className="flex-1 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    {images.map((img) => (
                      <button key={img.id} onClick={() => setSelectedImage(img)} className={cn("shrink-0 h-full aspect-video rounded-lg overflow-hidden border-2 transition-all", selectedImage?.id === img.id ? "border-blue-500" : "border-transparent opacity-50 hover:opacity-100")}>
                        <img src={img.url} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </motion.div>
          ) : (
            <motion.div 
              key="video"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full flex flex-col lg:flex-row overflow-hidden"
            >
              <aside className="w-full lg:w-80 border-r border-white/5 bg-[#0F0F12] p-6 flex flex-col gap-6 overflow-y-auto shrink-0">
                <section className="space-y-3">
                  <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
                    Health Concern Input
                    <Mic className="w-3 h-3 text-blue-500" />
                  </h3>
                  <textarea 
                    value={roughScript}
                    onChange={(e) => setRoughScript(e.target.value)}
                    placeholder="ဥပမာ။ ။ အစာအိမ်ရောဂါအတွက် ဘယ်လို အရွက်တွေသုံးသင့်သလဲ?"
                    className="w-full h-36 bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-white outline-none focus:border-blue-500/40 resize-none transition-all placeholder:text-slate-700 shadow-inner"
                  />
                  <button 
                    onClick={polishScript}
                    disabled={isPolishing || !roughScript.trim()}
                    className={cn(
                      "w-full py-3 rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95",
                      isPolishing || !roughScript.trim() ? "bg-white/5 text-slate-600" : "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20"
                    )}
                  >
                    {isPolishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {isPolishing ? 'CREATING SCRIPT...' : 'ANALYZE & GENERATE'}
                  </button>
                  {error && (
                    <div className="mt-4 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-[9px] font-bold">
                      <AlertCircle className="w-3 h-3" />
                      {error}
                    </div>
                  )}
                </section>

                <section className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex justify-between text-[9px] font-bold uppercase text-slate-500 tracking-wider">
                      <span>Target Duration</span>
                      <span className="text-blue-400">{videoDuration}m</span>
                    </div>
                    <input type="range" min="1" max="5" value={videoDuration} onChange={(e) => setVideoDuration(Number(e.target.value))} className="w-full h-1.5 bg-white/5 rounded-full accent-blue-500 appearance-none cursor-pointer" />
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-[9px] font-bold uppercase text-slate-500 tracking-wider">
                      <span>Narration Voice</span>
                      <span className="text-blue-400">{selectedVoice}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'Charon', label: 'အမျိုးသား ၁' },
                        { id: 'Fenrir', label: 'အမျိုးသား ၂' },
                        { id: 'Puck', label: 'အမျိုးသား ၃' },
                        { id: 'Kore', label: 'အမျိုးသမီး ၁' },
                        { id: 'Aoide', label: 'အမျိုးသမီး ၂' },
                        { id: 'Zephyr', label: 'အမျိုးသမီး ၃' },
                      ].map((v) => (
                        <div key={v.id} className="flex gap-1 group">
                          <button 
                            onClick={() => setSelectedVoice(v.id)} 
                            className={cn(
                              "flex-1 py-2 px-2.5 rounded-xl text-[9px] font-bold border transition-all truncate text-left", 
                              selectedVoice === v.id ? "bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-600/20" : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20"
                            )}
                          >
                            {v.label}
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); previewVoice(v.id); }}
                            className="p-2 bg-white/5 border border-white/10 rounded-xl hover:text-blue-400 hover:border-blue-500/30 transition-all text-slate-500"
                            title="Preview Voice"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between text-[9px] font-bold uppercase text-slate-500 tracking-wider">
                      <span>Video Style</span>
                      <span className="text-blue-400">{aspectRatio}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.values(AspectRatio).map((r) => (
                        <button key={r} onClick={() => setAspectRatio(r)} className={cn("py-2 rounded-xl text-[9px] font-bold border transition-all", aspectRatio === r ? "bg-blue-600 border-blue-500 text-white" : "bg-white/5 border-white/10 text-slate-400 hover:border-white/20")}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>

                <div className="mt-auto pt-6 border-t border-white/5">
                    <button 
                      onClick={generateAllAssets}
                      disabled={scenes.length === 0 || isGeneratingVideoAssets}
                      className={cn(
                        "w-full py-4 rounded-2xl font-bold text-[11px] tracking-[0.2em] uppercase flex items-center justify-center gap-3 transition-all",
                        scenes.length === 0 || isGeneratingVideoAssets ? "bg-white/5 text-slate-700" : "bg-white text-black hover:bg-white/90 shadow-2xl shadow-white/5 active:scale-95"
                      )}
                    >
                      {isGeneratingVideoAssets ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      Generate All Assets
                    </button>
                </div>
              </aside>

              <main className="flex-1 p-5 md:p-8 lg:p-12 bg-[#0A0A0B] overflow-y-auto relative scroll-smooth overflow-x-hidden">
                <div className="max-w-6xl mx-auto w-full">
                  <header className="mb-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="flex-1">
                      <h2 className="text-3xl md:text-5xl font-black text-white tracking-tighter uppercase italic bg-gradient-to-br from-white to-white/40 bg-clip-text text-transparent">
                        STORYBOARD ENGINE
                      </h2>
                      <div className="text-[12px] text-slate-500 font-bold uppercase tracking-[0.4em] mt-2 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                        {scenes.length} Scenes Orchestrated for {videoDuration}m Production
                      </div>
                    </div>
                  {scenes.length > 0 && (
                     <div className="px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">
                        <span className="text-[9px] font-bold text-blue-400 uppercase tracking-widest">Ready</span>
                     </div>
                  )}
                </header>

                  <div className="grid grid-cols-1 gap-12 pb-20">
                    {scenes.map((scene, idx) => (
                      <div key={scene.id} className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                        <div className="hidden md:flex md:col-span-1 flex-col items-center pt-2">
                          <div className="w-8 h-8 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-[11px] font-bold text-blue-500 shadow-lg shrink-0">
                            {idx + 1}
                          </div>
                          <div className="w-px h-24 bg-gradient-to-b from-blue-500/20 to-transparent mt-3" />
                        </div>
                        <div className="col-span-12 md:col-span-11 bg-[#0F0F12] rounded-[2rem] border border-white/5 overflow-hidden flex flex-col md:flex-row shadow-2xl transition-all hover:border-blue-500/20 w-full">
                          <div className="w-full md:w-1/3 aspect-video md:aspect-square bg-black/40 relative shrink-0">
                          {scene.imageUrl ? (
                            <>
                              <img src={scene.imageUrl} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                              <div className="absolute inset-x-0 bottom-0 p-2 flex justify-center gap-2 bg-gradient-to-t from-black/80 to-transparent">
                                <button onClick={() => generateSceneAsset(scene.id, 'IMAGE')} className="p-1.5 bg-blue-600 rounded-lg text-white hover:scale-110 transition-transform">
                                  <RefreshCw className="w-3 h-3" />
                                </button>
                                <button onClick={() => downloadAsset(scene.imageUrl!, `scene-${idx+1}.png`)} className="p-1.5 bg-white/10 rounded-lg text-white hover:scale-110 transition-transform">
                                  <Download className="w-3 h-3" />
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-800">
                              {scene.isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-8 h-8 opacity-20" />}
                            </div>
                          )}
                        </div>
                          <div className="p-5 md:p-8 flex flex-col justify-between flex-1 min-w-0">
                            <div className="space-y-6">
                              <div>
                                 <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] mb-2 flex items-center gap-2">
                                   <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                                   Narration Script
                                 </h4>
                                 <p className="text-[13px] leading-relaxed text-slate-200 font-medium">{scene.text}</p>
                              </div>
                              <div className="pt-4 border-t border-white/5">
                                 <h4 className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] mb-2">Visual Composition</h4>
                                 <p className="text-[10px] italic text-slate-500 font-medium leading-relaxed">{scene.imagePrompt}</p>
                              </div>
                            </div>
                            <div className="mt-8 flex items-center gap-3">
                               {scene.audioUrl ? (
                                  <>
                                    <button 
                                      onClick={() => {
                                        const audio = new Audio(scene.audioUrl);
                                        audio.play().catch(() => setError("Audio source failed. Please try regenerating the voice."));
                                      }} 
                                      className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xl hover:bg-blue-500 active:scale-95 transition-all"
                                    >
                                      <Play className="w-4 h-4 fill-current" />
                                    </button>
                                    <button onClick={() => downloadAsset(scene.audioUrl!, `audio-${idx+1}.mp3`)} className="flex-1 h-10 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-400 border border-white/5 transition-all flex items-center justify-center gap-2">
                                      <Download className="w-3.5 h-3.5" />
                                      Voice Clip
                                    </button>
                                  </>
                               ) : (
                                  <button 
                                    onClick={() => generateSceneAsset(scene.id, 'AUDIO')} 
                                    disabled={scene.isGenerating} 
                                    className="w-full h-10 bg-white/5 hover:bg-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest text-blue-400/70 border border-dashed border-blue-500/20 transition-all flex items-center justify-center gap-2"
                                  >
                                    {scene.isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                                    Generate Myanmar Voice
                                  </button>
                               )}
                            </div>
                          </div>
                      </div>
                    </div>
                  ))}
                  {scenes.length === 0 && (
                    <div className="mt-20 flex flex-col items-center gap-3 opacity-20">
                      <Layout className="w-10 h-10" />
                      <p className="text-[10px] font-bold uppercase tracking-widest">No scenes created</p>
                    </div>
                  )}
                </div>

                {scenes.length > 0 && (
                  <div className="mt-12 flex flex-col items-center gap-6">
                    <div className="flex items-center gap-4 text-slate-500">
                      <ImageIcon className={cn("w-4 h-4", scenes.every(s => s.imageUrl) && "text-green-500")} />
                      <div className="w-4 h-px bg-white/5" />
                      <Volume2 className={cn("w-4 h-4", scenes.every(s => s.audioUrl) && "text-green-500")} />
                      <div className="w-4 h-px bg-white/5" />
                      <Video className="w-4 h-4 text-blue-500" />
                    </div>
                    <button onClick={() => alert('Assembling Video...')} className="px-10 py-3 bg-blue-600 rounded-xl text-white font-bold text-[10px] tracking-[0.2em] shadow-lg">
                      FINAL ASSEMBLY
                    </button>
                  </div>
                )}
                </div>
              </main>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Settings Modal - Styled per theme */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-lg bg-[#0F0F12] rounded-3xl border border-white/10 shadow-3xl overflow-hidden"
            >
              <div className="p-10 space-y-8">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 bg-blue-600/10 rounded-2xl flex items-center justify-center border border-blue-500/20">
                    <Settings className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-white">STUDIO CONFIGURATION</h2>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Secure Personal API Access</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Gemini API Key</label>
                    <div className="relative">
                      <input 
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Paste your Google AI Studio key..."
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-5 py-4 text-sm font-mono text-blue-400 outline-none focus:border-blue-500/50 transition-all"
                      />
                    </div>
                  </div>
                  <div className="p-4 bg-white/5 rounded-xl border border-white/5 space-y-3">
                    <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                      သင့်ရဲ့ API Key ကို Browser ရဲ့ LocalStorage မှာသာ သိမ်းဆည်းပေးမှာဖြစ်ပါတယ်။ လုံခြုံရေးအတွက် စိတ်ချနိုင်ပါသည်။
                    </p>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-[9px] font-bold text-slate-500 tracking-wider">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        PERSISTENCE: PERMANENT (CLOSING APP WON'T DELETE KEY)
                      </div>
                      <div className="flex items-center gap-2 text-[9px] font-bold text-slate-500 tracking-wider">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        USAGE: DIRECT TO GOOGLE API (PRIVATE & UNLIMITED)
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => saveApiKey(apiKey)}
                    className="py-4 bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-600/20 active:scale-95"
                  >
                    SAVE CHANGES
                  </button>
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="py-4 bg-white/5 hover:bg-white/10 text-slate-400 rounded-xl font-bold transition-all border border-white/5"
                  >
                    CANCEL
                  </button>
                </div>

                <div className="pt-4 text-center border-t border-white/5">
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[10px] font-bold text-blue-400 hover:text-white transition-colors uppercase tracking-[0.2em]"
                  >
                    Get API Key from Google AI Studio &rarr;
                  </a>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {success && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-8 py-3 bg-blue-600 text-white rounded-full flex items-center gap-3 shadow-2xl shadow-blue-600/40 font-bold text-xs uppercase tracking-widest"
          >
            <CheckCircle2 className="w-4 h-4" />
            Configuration Updated
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
