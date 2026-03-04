import React, { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Clock,
  CheckCircle,
  Sun,
  Moon,
  Palette,
  Play,
  Award,
  TrendingUp,
  Sparkles,
  Brain,
  Target,
  Zap,
  Download,
  FileText,
  ClipboardCheck,
  RefreshCw,
  HelpCircle,
  PauseCircle,
  Atom,
  Leaf,
  Bolt,
} from "lucide-react";
import ChatBox from "../components/ChatBox";

const YT_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 4,
};

const LecturePage = () => {
  const videoId = "NeuU4575E48";

  const playerRef = useRef(null);
  const iframeContainerRef = useRef(null);
  const lastTimeRef = useRef(0);
  const tickRef = useRef(null);

  const [duration, setDuration] = useState(0);
  const [watchTime, setWatchTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [notes, setNotes] = useState("");
  const [theme, setTheme] = useState("light");
  const [isPlaying, setIsPlaying] = useState(false);

  const isDark = theme === "dark";
  const isBlue = theme === "blue";

  // ✅ Tailwind-safe gradients (no dynamic classes)
  const statGradients = {
    blue: "from-blue-500 to-blue-600",
    indigo: "from-indigo-500 to-indigo-600",
    purple: "from-purple-500 to-purple-600",
    emerald: "from-emerald-500 to-emerald-600",
  };

  const formatTime = (sec) => {
    const s = Number.isFinite(sec) ? sec : 0;
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // ✅ REAL YouTube tracking via IFrame API
  useEffect(() => {
    let mounted = true;

    const ensureYTApi = () =>
      new Promise((resolve) => {
        if (window.YT?.Player) return resolve();

        const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
        if (!existing) {
          const tag = document.createElement("script");
          tag.src = "https://www.youtube.com/iframe_api";
          document.body.appendChild(tag);
        }

        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          prev?.();
          resolve();
        };
      });

    const clearTick = () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };

    const startTick = () => {
      clearTick();
      tickRef.current = setInterval(() => {
        const p = playerRef.current;
        if (!p?.getPlayerState) return;

        const state = p.getPlayerState();
        setIsPlaying(state === YT_STATES.PLAYING);

        const d = p.getDuration?.() || 0;
        if (d > 0) setDuration(d);

        if (state === YT_STATES.PLAYING) {
          const current = p.getCurrentTime?.() || 0;

          // Only count forward play time
          if (current > lastTimeRef.current) {
            setWatchTime((prev) => prev + (current - lastTimeRef.current));
          }
          lastTimeRef.current = current;

          const pct = d > 0 ? Math.min(Math.round((current / d) * 100), 100) : 0;
          setProgress(pct);
        }

        if (state === YT_STATES.ENDED) {
          setIsCompleted(true);
          setProgress(100);
        }
      }, 500);
    };

    (async () => {
      await ensureYTApi();
      if (!mounted) return;

      if (!iframeContainerRef.current) return;

      // Create the player
      playerRef.current = new window.YT.Player(iframeContainerRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: (e) => {
            if (!mounted) return;
            const d = e.target.getDuration?.() || 0;
            setDuration(d);
            lastTimeRef.current = e.target.getCurrentTime?.() || 0;
            startTick();
          },
          onStateChange: (e) => {
            if (!mounted) return;

            if (e.data === YT_STATES.PLAYING) {
              lastTimeRef.current = playerRef.current?.getCurrentTime?.() || 0;
            }

            if (e.data === YT_STATES.ENDED) {
              setIsCompleted(true);
              setProgress(100);
            }
          },
        },
      });
    })();

    return () => {
      mounted = false;
      clearTick();
      try {
        playerRef.current?.destroy?.();
      } catch {
        // ignore
      }
      playerRef.current = null;
    };
  }, [videoId]);

  const pageBg =
    theme === "light"
      ? "bg-gradient-to-br from-blue-50 via-white to-indigo-50"
      : isDark
      ? "bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
      : "bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950";

  const headerBg =
    theme === "light"
      ? "bg-white/80 border-b border-gray-200"
      : isDark
      ? "bg-slate-900/80 border-b border-slate-800"
      : "bg-gradient-to-r from-blue-900/80 via-indigo-900/80 to-slate-900/80 border-b border-blue-800/50";

  const cardBase =
    theme === "light"
      ? "bg-white shadow-xl shadow-blue-100/50"
      : isDark
      ? "bg-slate-900/70 shadow-2xl border border-slate-800/50 backdrop-blur-xl"
      : "bg-slate-900/60 shadow-2xl border border-blue-800/30 backdrop-blur-xl";

  // ✅ Fix text colors for dark/blue themes
  const subtleText = theme === "light" ? "text-gray-600" : "text-slate-300";
  const mainText = theme === "light" ? "text-slate-900" : "text-white";

  const accentGlow =
    isBlue || isDark ? "shadow-blue-500/20 shadow-lg" : "shadow-blue-400/30 shadow-lg";

  const learningTips = [
    { icon: Target, text: "Watch without distractions, pause when needed" },
    { icon: BookOpen, text: "Summarize concepts in your own words" },
    { icon: HelpCircle, text: "Ask questions when you feel stuck" },
    { icon: RefreshCw, text: "Rewatch challenging sections" },
  ];

  const quickActions = [
    { icon: Download, text: "Download Materials" },
    { icon: FileText, text: "View Transcript" },
    { icon: ClipboardCheck, text: "Take Quiz" },
  ];

  const keyConcepts = [
    { icon: Bolt, text: "Energy Transfer" },
    { icon: Atom, text: "Chemical Reactions" },
    { icon: Leaf, text: "Natural Processes" },
  ];

  return (
    <div className={`min-h-screen transition-all duration-700 ${pageBg} relative overflow-x-hidden ${mainText}`}>
      {/* Animated Background Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className={`absolute top-20 left-10 w-72 h-72 rounded-full blur-3xl opacity-20 animate-pulse ${
            theme === "light" ? "bg-blue-400" : "bg-blue-600"
          }`}
          style={{ animationDuration: "4s" }}
        />
        <div
          className={`absolute bottom-20 right-10 w-96 h-96 rounded-full blur-3xl opacity-20 animate-pulse ${
            theme === "light" ? "bg-indigo-400" : "bg-indigo-600"
          }`}
          style={{ animationDuration: "6s", animationDelay: "1s" }}
        />
      </div>

      {/* HEADER */}
      <header className={`${headerBg} sticky top-0 z-50 backdrop-blur-xl transition-all duration-500`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg ${accentGlow}`}
                >
                  <Brain className="text-white" size={20} />
                </div>
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                  Science Learning Hub
                </h1>
                <p className={`${subtleText} text-xs sm:text-sm flex items-center gap-2`}>
                  Grade 7 • Interactive Experience
                  {isPlaying && (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <Play size={12} fill="currentColor" /> Live
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* THEME SWITCHER */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTheme("light")}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all duration-300 hover:scale-105 ${
                  theme === "light"
                    ? "border-blue-500 bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                    : "border-slate-300/30 hover:border-blue-400 hover:bg-blue-50/10"
                }`}
              >
                <Sun size={14} />
                <span className="hidden sm:inline">Light</span>
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all duration-300 hover:scale-105 ${
                  theme === "dark"
                    ? "border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"
                    : "border-slate-300/30 hover:border-emerald-400 hover:bg-emerald-50/10"
                }`}
              >
                <Moon size={14} />
                <span className="hidden sm:inline">Dark</span>
              </button>
              <button
                onClick={() => setTheme("blue")}
                className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all duration-300 hover:scale-105 ${
                  theme === "blue"
                    ? "border-indigo-400 bg-indigo-500 text-white shadow-lg shadow-indigo-500/30"
                    : "border-slate-300/30 hover:border-indigo-400 hover:bg-indigo-50/10"
                }`}
              >
                <Palette size={14} />
                <span>Blue</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* STATS BAR */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {[
            { icon: Clock, label: "Watch Time", value: formatTime(watchTime), color: "blue" },
            { icon: TrendingUp, label: "Progress", value: `${progress}%`, color: "indigo" },
            { icon: Target, label: "Duration", value: formatTime(duration), color: "purple" },
            { icon: Award, label: "Status", value: isCompleted ? "Done" : "Learning", color: "emerald" },
          ].map((stat, i) => {
            const grad = statGradients[stat.color] ?? statGradients.blue;
            const StatIcon = stat.icon;

            return (
              <div
                key={i}
                className={`${cardBase} rounded-2xl p-4 transform hover:scale-105 transition-all duration-300 group cursor-pointer`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`${subtleText} text-xs mb-1`}>{stat.label}</p>
                    <p className={`text-lg sm:text-xl font-bold ${mainText}`}>{stat.value}</p>
                  </div>
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity`}
                  >
                    <StatIcon className="text-white" size={18} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-12 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT CONTENT */}
        <div className="lg:col-span-2 space-y-6">
          {/* VIDEO PLAYER */}
          <div className={`${cardBase} rounded-3xl overflow-hidden transform hover:scale-[1.01] transition-all duration-500 relative group`}>
            <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 animate-gradient" />

            <div className="bg-black relative aspect-video">
              {/* ✅ YouTube API mounts the iframe here */}
              <div ref={iframeContainerRef} className="absolute inset-0 w-full h-full" />

              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            </div>

            {/* Video Info */}
            <div className="p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1">
                  <h2 className={`text-xl sm:text-2xl font-bold mb-2 flex items-center gap-2 ${mainText}`}>
                    Lesson 01 - Plant Diversity (Part 01) | Grade 07 Science in English
                  </h2>
                  <p className={`${subtleText} text-sm`}>Interactive learning with real-time progress tracking</p>
                </div>
              </div>

              {/* PROGRESS BAR */}
              <div className="mb-4">
                <div className="flex justify-between mb-2 text-sm">
                  <span className={`font-semibold flex items-center gap-2 ${mainText}`}>
                    
                    Learning Progress
                  </span>
                  <span className="font-bold text-blue-600 dark:text-blue-300">{progress}%</span>
                </div>

                <div className="relative w-full h-4 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-500 relative overflow-hidden rounded-full"
                    style={{ width: `${progress}%` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                  </div>
                </div>

                {isCompleted && (
                  <div className="flex items-center gap-2 mt-3 text-sm font-semibold text-emerald-400 animate-bounce">
                    <CheckCircle size={20} />
                    Lecture Completed — Excellent work!
                  </div>
                )}
              </div>

              {/* Stats pills */}
              <div className="flex flex-wrap gap-2">
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-200 text-xs font-medium border border-blue-500/20">
                  <Clock size={14} />
                  {formatTime(watchTime)} watched
                </span>
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-200 text-xs font-medium border border-purple-500/20">
                  <Target size={14} />
                  {formatTime(duration)} total
                </span>
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-xs font-medium border border-emerald-500/20">
                  <PauseCircle size={14} />
                  Tip: pause + note
                </span>
              </div>
            </div>
          </div>

          {/* NOTES SECTION */}
          <div className={`${cardBase} rounded-3xl p-6 transform hover:scale-[1.01] transition-all duration-300`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-bold flex items-center gap-2 ${mainText}`}>
                <BookOpen className="text-blue-500" size={22} />
                Your Lecture Notes
              </h3>
              <span className={`${subtleText} text-xs bg-blue-500/10 px-3 py-1 rounded-full`}>Auto-saved</span>
            </div>

            <textarea
              className={`w-full h-48 p-4 rounded-2xl border-2 text-sm outline-none focus:ring-4 transition-all duration-300 resize-none ${
                theme === "light"
                  ? "bg-gray-50 border-gray-200 focus:border-blue-400 focus:ring-blue-100 text-slate-900"
                  : "bg-slate-900/50 border-slate-700 focus:border-blue-500 focus:ring-blue-500/20 text-white placeholder:text-slate-400"
              }`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={`Write your key points, questions, and insights here...

Tip: Summarize in your own words to remember better!`}
            />

            <div className="flex justify-between items-center mt-4">
              <span className={`${subtleText} text-xs flex items-center gap-1`}>
                <Brain size={14} />
                {notes.length} characters
              </span>
              <button className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:scale-105 transition-all duration-300">
                Save Notes
              </button>
            </div>
          </div>
        </div>

        {/* SIDEBAR */}
        <div className="space-y-6 lg:sticky lg:top-24 h-fit">
          {/* LEARNING TIPS */}
          <div className={`${cardBase} rounded-3xl p-6 transform hover:scale-[1.02] transition-all duration-300`}>
            <h3 className={`text-lg font-bold mb-4 flex items-center gap-2 ${mainText}`}>
              <Sparkles className="text-yellow-500" size={20} />
              Pro Learning Tips
            </h3>

            <ul className="space-y-3 text-sm">
              {learningTips.map((tip, i) => {
                const TipIcon = tip.icon;
                return (
                  <li key={i} className="flex gap-3 items-start group cursor-pointer hover:translate-x-1 transition-transform">
                    <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg group-hover:scale-110 transition-transform">
                      <TipIcon size={16} />
                    </div>
                    <span className={`leading-relaxed pt-1 ${mainText}`}>{tip.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* QUICK ACTIONS */}
          <div className={`${cardBase} rounded-3xl p-6`}>
            <h3 className={`text-lg font-bold mb-4 ${mainText}`}>Quick Actions</h3>
            <div className="space-y-2">
              {quickActions.map((item, i) => {
                const ActionIcon = item.icon;
                return (
                  <button
                    key={i}
                    className={`w-full px-4 py-3 rounded-xl text-sm font-medium text-left flex justify-between items-center group transition-all duration-300 hover:scale-105 hover:shadow-lg ${
                      theme === "light"
                        ? "bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-slate-900"
                        : "bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 hover:border-blue-500/50 text-white"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/15 to-indigo-500/15 border border-blue-500/20 flex items-center justify-center">
                        <ActionIcon size={18} className={theme === "light" ? "text-blue-700" : "text-blue-300"} />
                      </span>
                      {item.text}
                    </span>
                    <span className="text-lg opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* KEY CONCEPTS */}
          <div className={`${cardBase} rounded-3xl p-6`}>
            <h3 className={`text-lg font-bold mb-4 ${mainText}`}>Key Concepts</h3>
            <div className="flex flex-col gap-2">
              {keyConcepts.map((concept, i) => {
                const ConceptIcon = concept.icon;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-4 py-3 rounded-2xl bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-500/20 hover:scale-[1.02] transition-transform cursor-pointer ${
                      theme === "light" ? "text-blue-800" : "text-blue-200"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                      <ConceptIcon size={18} className="text-white" />
                    </div>
                    <span className={`text-sm font-semibold ${mainText}`}>{concept.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* CHAT ASSISTANT (unchanged) */}
      <ChatBox />
    </div>
  );
};

export default LecturePage;
