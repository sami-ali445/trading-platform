/**
 * SupportChat - مكون الدعم الفني للمستخدمين
 * يظهر كـ chat مباشر داخل الموقع
 * المستخدم يرسل رسالة -> تصل للادمن -> الادمن يرد -> يوصل للمستخدم
 */

import { useState, useEffect, useRef } from 'react';

function SupportChat({ user, API }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [ticketStatus, setTicketStatus] = useState(null);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const ticketIdRef = useRef(null);

  const loadTicket = async () => {
    if (!API) return;
    try {
      // If we already have a ticketId, use it for precise matching
      const url = ticketIdRef.current 
        ? `/user/support/ticket?ticketId=${encodeURIComponent(ticketIdRef.current)}`
        : '/user/support/ticket';
      const { data } = await API.get(url);
      if (data.success && data.ticket) {
        ticketIdRef.current = data.ticket.ticket_id;
        setMessages(data.messages || []);
        setTicketStatus(data.ticket.status);
      } else if (data.success && !data.ticket) {
        // No ticket exists yet — clear state for fresh chat
        if (!ticketIdRef.current) {
          setMessages([]);
          setTicketStatus(null);
        }
      }
    } catch (e) { console.error(e); }
  };

  // Load existing ticket messages + auto-refresh
  useEffect(() => {
    if (!API) return;
    // Load immediately
    loadTicket();
    // Auto-refresh every 8 seconds for live message updates (balanced performance)
    const interval = setInterval(loadTicket, 8000);
    return () => clearInterval(interval);
  }, []);

  const sendMessage = async () => {
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(scrollToBottom, [messages]);

  return (
    <div style={{ background: 'var(--bg3)', padding: 20, borderRadius: 12, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
        <h3 style={{ color: '#39ff14' }}>🎧 الدعم الفني</h3>
        {ticketStatus && (
          <span style={{
            background: ticketStatus === 'open' ? '#1a3a1a' : '#2a2a2a',
            color: ticketStatus === 'open' ? '#4ade80' : '#888',
            padding: '3px 10px', borderRadius: 4, fontSize: 12
          }}>
            {ticketStatus === 'open' ? '🟢 التذكرة مفتوحة' : '⚫ التذكرة مغلقة'}
          </span>
        )}
      </div>

      <div style={{ fontSize: 13, color: '#888', marginBottom: 15, background: '#1a1a2e', padding: 10, borderRadius: 8 }}>
        💬 اكتب سؤالك هنا وسيرد عليك فريق الدعم قريباً
      </div>

      {error && (
        <div style={{
          background: '#3a1a1a', color: '#f87171', padding: '8px 12px',
          borderRadius: 6, marginBottom: 10, fontSize: 13, border: '1px solid #5a2a2a'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Messages Area */}
      <div style={{
        background: '#0a0a0f', borderRadius: 10, padding: 15, height: 350,
        overflowY: 'auto', marginBottom: 15, border: '1px solid #333'
      }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>💬</div>
            <div>لا توجد رسائل بعد</div>
            <div style={{ fontSize: 12, marginTop: 5 }}>ابدأ محادثة جديدة مع الدعم الفني</div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} style={{
              marginBottom: 12,
              display: 'flex',
              flexDirection: m.sender === 'user' ? 'row' : 'row-reverse'
            }}>
              <div style={{
                maxWidth: '80%',
                padding: '10px 14px',
                borderRadius: 10,
                background: m.sender === 'user' ? '#1a3a2e' : '#0a2a1a',
                color: '#ddd',
                fontSize: 14,
                lineHeight: 1.6,
                border: m.sender === 'user' ? '1px solid #2a4a3e' : '1px solid #1a5a2e'
              }}>
                <div style={{
                  fontSize: 10, color: '#888', marginBottom: 4,
                  display: 'flex', justifyContent: 'space-between', gap: 10
                }}>
                  <span>{m.sender === 'user' ? '👤 أنت' : '🛡️ الدعم الفني'}</span>
                  <span>{new Date(m.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.message}</div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {ticketStatus !== 'closed' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="اكتب رسالتك هنا..."
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 8, border: '1px solid #444',
              background: '#0a0a0f', color: '#fff', fontSize: 14, outline: 'none'
            }}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !newMessage.trim()}
            style={{
              padding: '12px 24px', background: loading ? '#333' : '#39ff14', color: loading ? '#888' : '#000',
              border: 'none', borderRadius: 8, cursor: loading ? 'default' : 'pointer', fontWeight: 'bold', fontSize: 14
            }}>
            {loading ? '⏳' : '📨 إرسال'}
          </button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 15, background: '#1a1a1a', borderRadius: 8, color: '#888' }}>
          ⚫ التذكرة مغلقة. يمكنك فتح تذكرة جديدة بالضغط على الزر أدناه
        </div>
      )}

      {ticketStatus === 'closed' && (
        <button
          onClick={async () => {
            try {
              await API.post('/user/support/new-ticket');
              loadTicket();
            } catch (e) { console.error(e); }
          }}
          style={{ padding: '8px 20px', background: '#39ff14', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13, marginTop: 10 }}>
          🎫 فتح تذكرة جديدة
        </button>
      )}
    </div>
  );
}

export default SupportChat;
