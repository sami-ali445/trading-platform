/**
 * SupportWidget - Floating Support Button + Chat Widget
 * Shows a FAB (floating action button) on ALL pages
 * - Logged in users: full chat with ticket system
 * - Guest users: simple contact form (name + message)
 */

import { useState, useEffect, useRef } from 'react';

function SupportWidget({ user, API }) {
  const [isOpen, setIsOpen] = useState(false);
  const isLoggedIn = !!user;
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [guestName, setGuestName] = useState('');
  const [loading, setLoading] = useState(false);
  const [ticketStatus, setTicketStatus] = useState(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const ticketIdRef = useRef(null);

  // Load existing ticket for logged-in users
  useEffect(() => {
    if (isLoggedIn && isOpen && API) {
      loadTicket();
    }
  }, [isLoggedIn, isOpen]);

  const loadTicket = async () => {
    try {
      const { data } = await API.get('/user/support/ticket');
      if (data.success && data.ticket) {
        ticketIdRef.current = data.ticket.ticket_id;
        setMessages(data.messages || []);
        setTicketStatus(data.ticket.status);
      }
    } catch (e) { console.error(e); }
  };

  const sendUserMessage = async () => {
    if (!newMessage.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await API.post('/user/support/message', {
        message: newMessage.trim(),
        ticketId: ticketIdRef.current
      });
      if (data.success) {
        setNewMessage('');
        if (data.ticketId && !ticketIdRef.current) {
          ticketIdRef.current = data.ticketId;
        }
        loadTicket();
      } else {
        setError(data.message || 'فشل إرسال الرسالة، حاول مرة أخرى');
      }
    } catch (e) {
      setError(e.response?.data?.message || 'خطأ في الاتصال، تأكد من تسجيل الدخول');
    }
    setLoading(false);
  };

  const sendGuestMessage = async () => {
    if (!guestName.trim() || !newMessage.trim() || loading) return;
    setLoading(true);
    try {
      const ticketId = 'GUEST-' + Date.now().toString(36).toUpperCase();
      await API.post('/support/tickets', {
        ticketId,
        telegramChatId: null,
        telegramUsername: guestName.trim(),
        message: newMessage.trim(),
        category: 'general'
      });
      setSent(true);
      setNewMessage('');
    } catch (e) {
      setError('فشل إرسال الرسالة، حاول مرة أخرى');
    }
    setLoading(false);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      {/* Floating Chat Window */}
      {isOpen && (
        <div style={{
          position: 'fixed', bottom: 80, left: 20, width: 360, maxWidth: 'calc(100vw - 40px)',
          height: 480, background: '#121218', borderRadius: 16, border: '1px solid #333',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)', zIndex: 99999,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'widgetSlideIn 0.3s ease'
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 18px', background: 'linear-gradient(135deg, #1a2a3e, #16213e)',
            borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>🎧</span>
              <div>
                <div style={{ color: '#39ff14', fontWeight: 'bold', fontSize: 14 }}>الدعم الفني</div>
                <div style={{ color: '#888', fontSize: 11 }}>
                  {isLoggedIn ? 'مرحباً ' + (user && user.username ? user.username : '') : 'تواصل معنا'}
                </div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} style={{
              background: 'none', border: 'none', color: '#888', fontSize: 20,
              cursor: 'pointer', padding: '2px 6px', borderRadius: 4
            }}>✕</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 15 }}>
            {isLoggedIn ? (
              /* Logged-in: Full Chat */
              <>
                {ticketStatus && (
                  <span style={{
                    display: 'inline-block', marginBottom: 10,
                    background: ticketStatus === 'open' ? '#1a3a1a' : '#2a2a2a',
                    color: ticketStatus === 'open' ? '#4ade80' : '#888',
                    padding: '3px 10px', borderRadius: 4, fontSize: 11
                  }}>
                    {ticketStatus === 'open' ? '🟢 التذكرة مفتوحة' : '⚫ التذكرة مغلقة'}
                  </span>
                )}
                {error && (
                  <div style={{
                    background: '#3a1a1a', color: '#f87171', padding: '8px 12px',
                    borderRadius: 6, marginBottom: 10, fontSize: 12, border: '1px solid #5a2a2a'
                  }}>
                    ⚠️ {error}
                  </div>
                )}
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#666', padding: 30 }}>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
                    <div style={{ fontSize: 13 }}>لا توجد رسائل بعد</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>ابدأ محادثة جديدة مع الدعم الفني</div>
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <div key={i} style={{
                      marginBottom: 10, display: 'flex',
                      flexDirection: m.sender === 'user' ? 'row' : 'row-reverse'
                    }}>
                      <div style={{
                        maxWidth: '80%', padding: '8px 12px', borderRadius: 8,
                        background: m.sender === 'user' ? '#1a3a2e' : '#0a2a1a',
                        color: '#ddd', fontSize: 13, lineHeight: 1.5,
                        border: m.sender === 'user' ? '1px solid #2a4a3e' : '1px solid #1a5a2e'
                      }}>
                        <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>
                          {m.sender === 'user' ? '👤 أنت' : '🛡️ الدعم الفني'} - {new Date(m.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.message}</div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </>
            ) : (
              /* Guest: Contact Form */
              <>
                {sent ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                    <div style={{ color: '#39ff14', fontWeight: 'bold', marginBottom: 8 }}>تم إرسال رسالتك بنجاح!</div>
                    <div style={{ color: '#888', fontSize: 13 }}>سيتواصل معك فريق الدعم قريباً</div>
                    <button onClick={() => { setSent(false); setGuestName(''); setNewMessage(''); }} style={{
                      marginTop: 15, padding: '8px 20px', background: '#1a2a3e', color: '#ccc',
                      border: '1px solid #444', borderRadius: 6, cursor: 'pointer', fontSize: 13
                    }}>إرسال رسالة أخرى</button>
                  </div>
                ) : (
                  <>
                    <div style={{ color: '#888', fontSize: 13, marginBottom: 15, lineHeight: 1.7 }}>
                      👋 مرحباً! اكتب رسالتك هنا وسيرد عليك فريق الدعم قريباً.
                      <br /><br />
                      💡 <span style={{ color: '#aaa' }}>يمكنك تسجيل الدخول للحصول على دعم فوري</span>
                    </div>
                    {error && (
                      <div style={{
                        background: '#3a1a1a', color: '#f87171', padding: '8px 12px',
                        borderRadius: 6, marginBottom: 10, fontSize: 13, border: '1px solid #5a2a2a'
                      }}>
                        ⚠️ {error}
                      </div>
                    )}
                    <input
                      value={guestName}
                      onChange={e => setGuestName(e.target.value)}
                      placeholder="اسمك (مطلوب)"
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #444',
                        background: '#0a0a0f', color: '#fff', fontSize: 13, marginBottom: 10, outline: 'none', boxSizing: 'border-box'
                      }}
                    />
                    <textarea
                      value={newMessage}
                      onChange={e => setNewMessage(e.target.value)}
                      placeholder="اكتب رسالتك هنا..."
                      rows={4}
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #444',
                        background: '#0a0a0f', color: '#fff', fontSize: 13, outline: 'none',
                        resize: 'vertical', minHeight: 80, boxSizing: 'border-box', fontFamily: 'inherit'
                      }}
                    />
                    <button
                      onClick={sendGuestMessage}
                      disabled={loading || !guestName.trim() || !newMessage.trim()}
                      style={{
                        width: '100%', padding: 10, marginTop: 10,
                        background: loading || !guestName.trim() || !newMessage.trim() ? '#333' : '#39ff14',
                        color: loading || !guestName.trim() || !newMessage.trim() ? '#666' : '#000',
                        border: 'none', borderRadius: 8, cursor: loading ? 'default' : 'pointer',
                        fontWeight: 'bold', fontSize: 14
                      }}
                    >
                      {loading ? '⏳ جاري الإرسال...' : '📨 إرسال الرسالة'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer Input (logged-in only) */}
          {isLoggedIn && ticketStatus !== 'closed' && (
            <div style={{
              padding: '10px 14px', borderTop: '1px solid #333',
              display: 'flex', gap: 8, flexShrink: 0
            }}>
              <input
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendUserMessage()}
                placeholder="اكتب رسالتك..."
                disabled={loading}
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #444',
                  background: '#0a0a0f', color: '#fff', fontSize: 13, outline: 'none'
                }}
              />
              <button
                onClick={sendUserMessage}
                disabled={loading || !newMessage.trim()}
                style={{
                  padding: '10px 16px', background: loading ? '#333' : '#39ff14',
                  color: loading ? '#666' : '#000', border: 'none', borderRadius: 8,
                  cursor: loading ? 'default' : 'pointer', fontWeight: 'bold', fontSize: 13
                }}
              >
                {loading ? '⏳' : '📨'}
              </button>
            </div>
          )}

          {isLoggedIn && ticketStatus === 'closed' && (
            <div style={{
              padding: 10, borderTop: '1px solid #333', textAlign: 'center', flexShrink: 0
            }}>
              <button
                onClick={async () => {
                  try {
                    await API.post('/user/support/new-ticket');
                    loadTicket();
                  } catch (e) { console.error(e); }
                }}
                style={{
                  padding: '8px 20px', background: '#39ff14', color: '#000',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13
                }}
              >
                🎫 فتح تذكرة جديدة
              </button>
            </div>
          )}
        </div>
      )}

      {/* FAB Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed', bottom: 20, left: 20, width: 56, height: 56,
          borderRadius: '50%', background: isOpen ? '#dc3545' : '#39ff14',
          color: isOpen ? '#fff' : '#000', border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(57,255,20,0.4)', zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, transition: 'all 0.3s ease',
          animation: !isOpen ? 'fabPulse 2s infinite' : 'none'
        }}
        title={isOpen ? 'إغلاق' : 'الدعم الفني'}
      >
        {isOpen ? '✕' : '💬'}
      </button>
    </>
  );
}

export default SupportWidget;
