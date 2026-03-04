/**
 * ============================================================================
 * SAMD AI ASSISTANT - Buton flotant + Chat panel
 * Plasează <AIAssistant /> în App.jsx, după autentificare
 * ============================================================================
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Bot, Minimize2, Maximize2, Trash2, Sparkles } from 'lucide-react';
import apiClient from '../api/apiClient';

// ── Sugestii rapide ──────────────────────────────────────────────────────────
const SUGGESTIONS = [
  'Care sector a depozitat cel mai mult în ultimele 90 zile?',
  'Arată-mi contractele care expiră în curând',
  'Care operator are cele mai mari discrepanțe?',
  'Generează un raport narativ pentru luna curentă',
  'Câte contracte active sunt per tip?',
];

// ── Typing indicator ─────────────────────────────────────────────────────────
const TypingDots = () => (
  <div className="flex items-center gap-1 py-1">
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce"
        style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }}
      />
    ))}
  </div>
);

// ── Mesaj individual ─────────────────────────────────────────────────────────
const Message = ({ msg }) => {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 flex-shrink-0 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mt-0.5">
          <Bot className="w-3.5 h-3.5 text-white" />
        </div>
      )}
      <div
        className={`max-w-[82%] text-sm leading-relaxed whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 ${
          isUser
            ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-tr-sm'
            : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-tl-sm shadow-sm'
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
};

// ── Componenta principală ────────────────────────────────────────────────────
const AIAssistant = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Bună ziua! Sunt asistentul AI al platformei SAMD.\n\nPot răspunde la întrebări despre statistici de depozitare, contracte, operatori și pot genera rapoarte narative.\n\nCu ce vă pot ajuta?',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasNewMsg, setHasNewMsg] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);

  // Scroll la ultimul mesaj
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Focus input când se deschide
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
      setHasNewMsg(false);
    }
  }, [isOpen]);

  const sendMessage = useCallback(
    async (text) => {
      const content = text || input.trim();
      if (!content || loading) return;

      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      const newMessages = [...messages, { role: 'user', content }];
      setMessages(newMessages);
      setLoading(true);

      try {
        const response = await apiClient('/ai/chat', {
          method: 'POST',
          body: JSON.stringify({ messages: newMessages }),
        });

        const reply = response?.reply || 'Nu am putut genera un răspuns.';
        setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);

        // Notifică dacă chatul e închis
        if (!isOpen) setHasNewMsg(true);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '⚠️ Eroare la conectarea cu asistentul. Verificați conexiunea și reîncercați.',
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [messages, input, loading, isOpen]
  );

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([
      {
        role: 'assistant',
        content: 'Conversație resetată. Cu ce vă pot ajuta?',
      },
    ]);
  };

  const panelWidth = isExpanded ? 'w-[600px]' : 'w-[380px]';
  const panelHeight = isExpanded ? 'h-[700px]' : 'h-[520px]';

  return (
    <>
      {/* Panel chat */}
      {isOpen && (
        <div
          className={`fixed bottom-20 right-5 ${panelWidth} ${panelHeight} z-[200] flex flex-col rounded-2xl shadow-2xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 overflow-hidden transition-all duration-200`}
        >
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Asistent SAMD</p>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                  <span className="text-xs text-emerald-100">Date live din sistem</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearChat}
                title="Resetează conversația"
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsExpanded((e) => !e)}
                title={isExpanded ? 'Micșorează' : 'Mărește'}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition-colors"
              >
                {isExpanded ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Sugestii (doar la început) */}
          {messages.length === 1 && (
            <div className="flex-shrink-0 px-3 pt-3 pb-1">
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
                Întrebări rapide
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s)}
                    disabled={loading}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mesaje */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {messages.map((msg, i) => (
              <Message key={i} msg={msg} />
            ))}
            {loading && (
              <div className="flex gap-2 mb-3">
                <div className="w-7 h-7 flex-shrink-0 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                  <Bot className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-tl-sm px-3.5 py-2.5 shadow-sm">
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex-shrink-0 px-3 pb-3 pt-2 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
                }}
                onKeyDown={handleKeyDown}
                placeholder="Întrebați despre date, contracte..."
                rows={1}
                disabled={loading}
                className="flex-1 resize-none px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all disabled:opacity-50"
                style={{ maxHeight: '100px' }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center shadow-lg shadow-emerald-500/25 transition-all hover:scale-105 active:scale-95"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-center text-[10px] text-gray-400 mt-1.5">
              Enter pentru trimite • Shift+Enter pentru rând nou
            </p>
          </div>
        </div>
      )}

      {/* Buton flotant */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-[200] w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-xl shadow-emerald-500/40 flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        title="Asistent AI SAMD"
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : (
          <>
            <Bot className="w-6 h-6" />
            {hasNewMsg && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white animate-bounce" />
            )}
          </>
        )}
      </button>
    </>
  );
};

export default AIAssistant;