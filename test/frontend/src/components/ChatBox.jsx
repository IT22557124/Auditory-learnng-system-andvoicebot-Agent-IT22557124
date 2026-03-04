import React, { useEffect, useRef, useState } from "react";
import { Atom, Mic, Send, X, Maximize2, Volume2 } from "lucide-react";

const ChatBox = () => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [chatSize, setChatSize] = useState("medium");
  const [micPermission, setMicPermission] = useState("unknown");

  // Unlock so wake-word can start after first interaction (refresh-safe)
  const [voiceReady, setVoiceReady] = useState(false);

  const [position, setPosition] = useState(() => ({
    x: window.innerWidth - 100,
    y: window.innerHeight - 100,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const recognitionRef = useRef(null);
  const wakeWordRecognitionRef = useRef(null);
  const finalTranscriptBuffer = useRef("");

  // Flags
  const isWakeListening = useRef(false);
  const isMainListening = useRef(false);

  // Voice activity (no % text, no bar, blob animates ONLY when speaking)
  const audioStreamRef = useRef(null)
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const WAKE_WORDS = ["hey", "hi", "hello", "ok buddy", "ok budy", "sci buddy", "scibuddy"];

  const sizeConfig = {
    small: { width: 320, height: 500 },
    medium: { width: 400, height: 640 },
    large: { width: 480, height: 740 },
  };

  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  // Soft beep when wake-word triggers
  const playBeep = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

      osc.start(now);
      osc.stop(now + 0.3);

      osc.onended = () => ctx.close();
    } catch {}
  };

  // Beep when dictation ends (recording stops)
  const playEndBeep = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // slightly lower + shorter so it feels like "done"
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);

      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc.start(now);
      osc.stop(now + 0.18);

      osc.onended = () => ctx.close();
    } catch {}
  };

  // Browser unlock – needed so wake-word works after refresh
  useEffect(() => {
    const unlock = () => {
      setVoiceReady(true);
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("scroll", unlock);
    };

    window.addEventListener("click", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("scroll", unlock);

    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("scroll", unlock);
    };
  }, []);

  // Drag bubble
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      setPosition({
        x: Math.min(Math.max(e.clientX - dragOffset.x, 0), window.innerWidth - 80),
        y: Math.min(Math.max(e.clientY - dragOffset.y, 0), window.innerHeight - 80),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Keep bubble inside viewport on resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => ({
        x: Math.min(prev.x, window.innerWidth - 80),
        y: Math.min(prev.y, window.innerHeight - 80),
      }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Accept optional overrideQuestion so voice "send" can pass cleaned text directly
  const askFlaskBackend = async (overrideQuestion) => {
    const q = (overrideQuestion ?? question).trim();
    if (!q) return;

    setLoading(true);
    setAnswer("");
    setError("");

    try {
      const res = await fetch("http://localhost:5000/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      setAnswer(data.answer);
    } catch {
      setError("Cannot connect to Flask backend.");
    }

    setLoading(false);
  };

  // --- Voice activity detection (speaking vs silent) ---
  const stopVoiceActivity = () => {
    try {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } catch {}
    rafRef.current = null;

    try {
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    } catch {}
    audioStreamRef.current = null;

    try {
      if (audioCtxRef.current) audioCtxRef.current.close();
    } catch {}
    audioCtxRef.current = null;
    analyserRef.current = null;

    setIsSpeaking(false);
  };

  const startVoiceActivity = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      audioStreamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyserRef.current = analyser;

      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.fftSize);

      const gate = 0.02;
      const onCountNeed = 3;
      const offCountNeed = 10;
      let onCount = 0;
      let offCount = 0;

      const tick = () => {
        if (!analyserRef.current) return;

        analyserRef.current.getByteTimeDomainData(buffer);

        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128; // -1..1
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);

        const speakingNow = rms > gate;

        if (speakingNow) {
          onCount++;
          offCount = 0;
        } else {
          offCount++;
          onCount = 0;
        }

        // Debounced state changes
        if (!isSpeaking && onCount >= onCountNeed) setIsSpeaking(true);
        if (isSpeaking && offCount >= offCountNeed) setIsSpeaking(false);

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setError("Microphone blocked or unavailable.");
      setMicPermission("denied");
      setIsSpeaking(false);
    }
  };

  // Toggle mic (uses main recognition + coordinates with wake-word)
  const toggleRecording = async () => {
    const rec = recognitionRef.current;
    const wakeRec = wakeWordRecognitionRef.current;

    if (!rec) {
      setError("Speech recognition not supported.");
      return;
    }

    // START dictation
    if (!isMainListening.current) {
      finalTranscriptBuffer.current = "";
      setQuestion("");
      setError("");

      // Stop wake listener while we dictate
      if (wakeRec && isWakeListening.current) {
        try {
          wakeRec.stop();
        } catch {}
      }

      await startVoiceActivity();

      try {
        rec.start();
        isMainListening.current = true;
      } catch {
        isMainListening.current = false;
      }
    } else {
      // STOP dictation
      try {
        rec.stop();
      } catch {}

      isMainListening.current = false;
      stopVoiceActivity();

      // Resume wake listener
      if (voiceReady) startWakeWord();
    }
  };

  // Dictation speech recognition (live transcript, no duplicates)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => {
      setIsRecording(true);
      isMainListening.current = true;
    };

    // ✅✅✅ ONLY CHANGE: Auto-send when listening ends
    rec.onend = () => {
      setIsRecording(false);
      isMainListening.current = false;

      // ✅ Beep after listening ends
      playEndBeep();

      // ✅ Auto send whatever user said (final buffer)
      const finalText = (finalTranscriptBuffer.current || "").trim();
      if (finalText) {
        setQuestion(finalText);

        // send immediately using the text (no button click)
        askFlaskBackend(finalText);
      }

      // when dictation stops, allow wake-word to resume
      if (voiceReady) startWakeWord();
    };

    rec.onresult = (e) => {
      let interim = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscriptBuffer.current += transcript + " ";
        else interim += transcript;
      }

      setQuestion((finalTranscriptBuffer.current + interim).trim());
    };

    rec.onerror = () => {
      setError("Microphone blocked or unavailable.");
      setIsRecording(false);
      isMainListening.current = false;
      if (voiceReady) startWakeWord();
    };

    recognitionRef.current = rec;
  }, [voiceReady]);

  // Safe start for wake-word engine
  const startWakeWord = () => {
    const wakeRec = wakeWordRecognitionRef.current;
    if (!wakeRec) return;
    if (isWakeListening.current) return;
    if (isMainListening.current) return;

    try {
      wakeRec.start();
      isWakeListening.current = true;
      console.log("Wake-word listener active");
    } catch (err) {
      console.warn("Wake start failed:", err);
    }
  };

  // Wake Word Listener (with refresh fix)
  useEffect(() => {
    if (!voiceReady) return; // Wait for first user interaction

    const initWake = async () => {
      await wait(300); // small delay

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) return;

      const wakeRec = new SpeechRecognition();
      wakeRec.lang = "en-US";
      wakeRec.continuous = true;
      wakeRec.interimResults = false;

      wakeRec.onstart = () => {
        isWakeListening.current = true;
      };

      wakeRec.onend = () => {
        isWakeListening.current = false;
        if (!isMainListening.current) {
          setTimeout(() => startWakeWord(), 300);
        }
      };

      wakeRec.onerror = () => {
        isWakeListening.current = false;
        if (!isMainListening.current) {
          setTimeout(() => startWakeWord(), 400);
        }
      };

      wakeRec.onresult = (e) => {
        const text = e.results[0][0].transcript.toLowerCase();
        if (WAKE_WORDS.some((w) => text.includes(w))) {
          playBeep();
          setIsOpen(true);
          setIsMinimized(false);

          try {
            wakeRec.stop();
          } catch {}

          setTimeout(() => {
            if (!isMainListening.current) toggleRecording();
          }, 300);
        }
      };

      wakeWordRecognitionRef.current = wakeRec;

      startWakeWord();
    };

    initWake();

    return () => {
      try {
        wakeWordRecognitionRef.current?.stop();
      } catch {}
    };
  }, [voiceReady]);

  // Mic permission
  useEffect(() => {
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "microphone" })
        .then((res) => {
          setMicPermission(res.state);
          res.onchange = () => setMicPermission(res.state);
        })
        .catch(() => {});
    }
  }, []);

  const requestMicAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission("granted");
    } catch {
      setMicPermission("denied");
    }
  };

  const handleMouseDown = (e) => {
    if (isOpen) return;
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  // If SR ends (browser stops it), also stop voice activity
  useEffect(() => {
    if (!isRecording) stopVoiceActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopVoiceActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleChat = () => {
    setIsOpen((prev) => !prev);
    setIsMinimized(false);
  };

  const cycleChatSize = () =>
    setChatSize((prev) => (prev === "small" ? "medium" : prev === "medium" ? "large" : "small"));

  const currentSize = sizeConfig[chatSize];
  const popupWidth = isMinimized ? 320 : currentSize.width;
  const popupHeight = isMinimized ? 64 : currentSize.height;

  // Solid theme color (no gradients)
  const themeClasses = {
    header: "bg-blue-600",
    headerHover: "hover:bg-blue-700",
    bubble: "bg-blue-600",
    bubbleHover: "hover:brightness-110",
    iconWrap: "bg-blue-700",
    primaryBtn: "bg-blue-600 hover:bg-blue-700",
    focusRing: "focus:border-blue-600",
    badgeOk: "bg-blue-100 text-blue-700",
  };

  return (
    <>
      {/* Floating Bubble */}
      <div
        className={`fixed z-50 transition-all duration-200 select-none ${
          isDragging ? "cursor-grabbing scale-110" : "cursor-pointer hover:scale-105"
        } ${isOpen ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        style={{ left: position.x, top: position.y }}
        onMouseDown={handleMouseDown}
        onClick={() => !isDragging && toggleChat()}
        title="Open SciBuddy"
      >
        <div
          className={`w-16 h-16 ${themeClasses.bubble} rounded-full shadow-xl flex items-center justify-center relative ${themeClasses.bubbleHover}`}
        >
          <span
            className="absolute inset-0 rounded-full ring-2 ring-blue-400/80 animate-ping"
            style={{ animationDuration: "2.8s" }}
          />
          <span className="absolute inset-1 rounded-full ring-2 ring-white/40" />
          <Atom className="w-8 h-8 text-white drop-shadow" />
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 ring-2 ring-white shadow animate-pulse" />
        </div>
      </div>

      {/* Chat Popup */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsMinimized(true)} />

          <div
            className="fixed bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-50"
            style={{ right: 24, bottom: 24, width: popupWidth, height: popupHeight }}
          >
            {/* HEADER */}
            <div className={`flex items-center justify-between px-4 py-3 ${themeClasses.header} text-white`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 ${themeClasses.iconWrap} rounded-full flex items-center justify-center`}>
                  <Atom className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">SciBuddy</h3>
                  <p className="text-xs opacity-80">Your science helper</p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={cycleChatSize}
                  className={`w-8 h-8 rounded-lg ${themeClasses.headerHover} flex items-center justify-center`}
                  title="Change size"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsMinimized(!isMinimized)}
                  className={`w-8 h-8 rounded-lg ${themeClasses.headerHover} flex items-center justify-center`}
                  title="Minimize"
                >
                  <span className="leading-none">{isMinimized ? "□" : "−"}</span>
                </button>
                <button
                  onClick={toggleChat}
                  className={`w-8 h-8 rounded-lg ${themeClasses.headerHover} flex items-center justify-center`}
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* CONTENT */}
            {!isMinimized && (
              <>
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                  <h3 className="text-sm font-semibold mb-1">Microphone Settings</h3>
                  <p className="text-xs text-gray-600 mb-2">Allow microphone to use voice input.</p>

                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        micPermission === "granted"
                          ? themeClasses.badgeOk
                          : micPermission === "denied"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      Mic: {micPermission}
                    </span>

                    <button
                      onClick={requestMicAccess}
                      className={`px-3 py-2 text-white rounded-lg text-xs flex items-center gap-2 ${themeClasses.primaryBtn}`}
                    >
                      <Volume2 className="w-4 h-4" />
                      Allow Mic
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 bg-white relative">
                  {loading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10 rounded-lg">
                      <div className="flex space-x-2">
                        <span className={`w-3 h-3 rounded-full animate-bounce ${themeClasses.bubble}`} />
                        <span className={`w-3 h-3 rounded-full animate-bounce delay-200 ${themeClasses.bubble}`} />
                        <span className={`w-3 h-3 rounded-full animate-bounce delay-400 ${themeClasses.bubble}`} />
                      </div>
                      <p className="text-sm text-gray-700 mt-2">Thinking...</p>
                    </div>
                  )}

                  {answer && (
                    <div className="mb-4 relative z-0">
                      <div className="text-xs font-semibold text-gray-600 mb-1">Answer</div>
                      <div className="bg-white border border-gray-200 p-3 rounded-lg text-sm">{answer}</div>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-gray-200 bg-white">
                  {/* Small blob that animates ONLY when user speaks */}
                  {isRecording && (
                    <div className="text-xs text-gray-700 mb-2 flex items-center gap-2">
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full bg-blue-600 ${
                          isSpeaking ? "animate-pulse" : ""
                        }`}
                        title={isSpeaking ? "Speaking" : "Listening"}
                      />
                      <span>Listening</span>
                    </div>
                  )}

                  <div className="relative">
                    <textarea
                      className={`w-full border-2 border-gray-200 rounded-xl px-4 py-3 pr-20 text-sm outline-none resize-none ${themeClasses.focusRing}`}
                      rows={3}
                      placeholder="Ask SciBuddy..."
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          askFlaskBackend();
                        }
                      }}
                    />

                    <div className="absolute right-2 bottom-3 flex gap-2">
                      <button
                        onClick={toggleRecording}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                          isRecording ? "bg-red-200 text-red-700" : "bg-gray-200 text-gray-700"
                        }`}
                        title="Voice input"
                      >
                        <Mic className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => askFlaskBackend()}
                        disabled={!question.trim() || loading}
                        className={`w-9 h-9 text-white rounded-lg disabled:opacity-100 flex items-center justify-center ${themeClasses.primaryBtn}`}
                        title="Send"
                      >
                        {loading ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
};

export default ChatBox;
