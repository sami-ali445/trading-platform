/**
 * Admin Support Panel - Support Ticket Management
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const API = axios.create({ baseURL: '/api', withCredentials: true });
API.interceptors.request.use(c => {
  const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
  if (csrfMatch) c.headers['X-CSRF-Token'] = csrfMatch[1];
  return c;
});

function AdminSupportPanel({ user }) {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState('open');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef(null);

  const loadTickets = useCallback(async () => {
    try {
      const { data } = await API.get(`/admin/support/tickets?status=${filter}`);
      if (data.success) setTickets(data.tickets);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [filter]);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await API.get('/admin/support/stats');
      if (data.success) setStats(data.stats);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadTickets(); loadStats(); }, [loadTickets, loadStats]);

  const loadTicketDetail = async (ticketId) => {
    try {
      const { data } = await API.get(`/admin/support/tickets/${ticketId}`);
      if (data.success) {
        setSelectedTicket(data.ticket);
        setMessages(data.messages);
      }
    } catch (e) { console.error(e); }
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    try {
      await API.post(`/admin/support/tickets/${selectedTicket.ticket_id}/reply`, {
        message: replyText.trim()
      });
      setReplyText('');
      loadTicketDetail(selectedTicket.ticket_id);
      loadTickets();
    } catch (e) { console.error(e); }
  };

  const closeTicket = async (ticketId) => {
    try {
      await API.post(`/admin/support/tickets/${ticketId}/close`);
      setSelectedTicket(null);
      setMessages([]);
      loadTickets();
      loadStats();
    } catch (e) { console.error(e); }
  };

  const reopenTicket = async (ticketId) => {
    try {
      await API.post(`/admin/support/tickets/${ticketId}/reopen`);
      loadTicketDetail(ticketId);
      loadTickets();
      loadStats();
    } catch (e) { console.error(e); }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(scrollToBottom, [messages]);

  const getCategoryLabel = (cat) => {
    const labels = {
      deposit: '📥 ايداع',
      withdraw: '💸 سحب',
      referral: '👥 احالات',
      support_request: '🆘 طلب دعم',
      general: '📋 عام'
    };
    return labels[cat] || cat;
  };

  const getStatusBadge = (status) => {
    if (status === 'open') return <span style={{background:'#1a3a1a',color:'#4ade80',padding:'2px 8px',borderRadius:4,fontSize:12}}>مفتوحة</span>;
    return <span style={{background:'#2a2a2a',color:'#888',padding:'2px 8px',borderRadius:4,fontSize:12}}>مغلقة</span>;
  };

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ color: '#39ff14', marginBottom: 20 }}>🎫 الدعم الفني - تذاكر المستخدمين</h2>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
          <div style={{ background: '#1a1a2e', padding: 15, borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 24, color: '#39ff14', fontWeight: 'bold' }}>{stats.total}</div>
            <div style={{ fontSize: 12, color: '#888' }}>الاجمالي</div>
          </div>
          <div style={{ background: '#1a1a2e', padding: 15, borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 24, color: '#fbbf24', fontWeight: 'bold' }}>{stats.open}</div>
            <div style={{ fontSize: 12, color: '#888' }}>مفتوحة</div>
          </div>
          <div style={{ background: '#1a1a2e', padding: 15, borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 24, color: '#4ade80', fontWeight: 'bold' }}>{stats.closed}</div>
            <div style={{ fontSize: 12, color: '#888' }}>مغلقة</div>
          </div>
          <div style={{ background: '#1a1a2e', padding: 15, borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 24, color: '#60a5fa', fontWeight: 'bold' }}>{stats.last_24h}</div>
            <div style={{ fontSize: 12, color: '#888' }}>اخر 24 ساعة</div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ marginBottom: 15, display: 'flex', gap: 8 }}>
        {['open', 'closed', 'all'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: filter === f ? '#39ff14' : '#2a2a2a',
              color: filter === f ? '#000' : '#ccc', fontWeight: filter === f ? 'bold' : 'normal'
            }}>
            {f === 'open' ? 'مفتوحة' : f === 'closed' ? 'مغلقة' : 'الكل'}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedTicket ? '1fr 1fr' : '1fr', gap: 20 }}>
        {/* Tickets List */}
        <div>
          {loading ? (
            <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>جاري التحميل...</div>
          ) : tickets.length === 0 ? (
            <div style={{ color: '#888', textAlign: 'center', padding: 40 }}>لا توجد تذاكر</div>
          ) : (
            tickets.map(t => (
              <div key={t.ticket_id} onClick={() => loadTicketDetail(t.ticket_id)}
                style={{
                  background: selectedTicket?.ticket_id === t.ticket_id ? '#1a3a2e' : '#1a1a2e',
                  padding: 15, borderRadius: 8, marginBottom: 8, cursor: 'pointer',
                  border: selectedTicket?.ticket_id === t.ticket_id ? '1px solid #39ff14' : '1px solid #333'
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ color: '#39ff14', fontWeight: 'bold' }}>#{t.ticket_id}</span>
                  {getStatusBadge(t.status)}
                </div>
                <div style={{ color: '#ccc', fontSize: 14, marginBottom: 4 }}>
                  👤 @{t.telegram_username || 'مجهول'} | {getCategoryLabel(t.category)}
                </div>
                <div style={{ color: '#aaa', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.user_message}
                </div>
                <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
                  {new Date(t.created_at).toLocaleString('ar-SA')}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Ticket Detail / Chat */}
        {selectedTicket && (
          <div style={{ background: '#1a1a2e', borderRadius: 8, display: 'flex', flexDirection: 'column', height: 600 }}>
            {/* Header */}
            <div style={{ padding: 15, borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ color: '#39ff14', fontWeight: 'bold' }}>#{selectedTicket.ticket_id}</span>
                <span style={{ color: '#888', marginRight: 10 }}>@{selectedTicket.telegram_username || 'مجهول'}</span>
                {getStatusBadge(selectedTicket.status)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedTicket.status === 'open' ? (
                  <button onClick={() => closeTicket(selectedTicket.ticket_id)}
                    style={{ padding: '4px 12px', background: '#3a1a1a', color: '#f87171', border: '1px solid #f87171', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                    اغلاق
                  </button>
                ) : (
                  <button onClick={() => reopenTicket(selectedTicket.ticket_id)}
                    style={{ padding: '4px 12px', background: '#1a3a1a', color: '#4ade80', border: '1px solid #4ade80', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                    اعادة فتح
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 15 }}>
              {messages.map((m, i) => (
                <div key={i} style={{
                  marginBottom: 12,
                  display: 'flex',
                  flexDirection: m.sender === 'user' ? 'row' : 'row-reverse'
                }}>
                  <div style={{
                    maxWidth: '80%',
                    padding: 10,
                    borderRadius: 8,
                    background: m.sender === 'user' ? '#2a2a3e' : '#1a3a2e',
                    color: '#ddd',
                    fontSize: 14,
                    lineHeight: 1.5
                  }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                      {m.sender === 'user' ? '👤 المستخدم' : '🛡️ الدعم الفني'} - {new Date(m.created_at).toLocaleTimeString('ar-SA')}
                    </div>
                    {m.message}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply Box */}
            {selectedTicket.status === 'open' && (
              <div style={{ padding: 15, borderTop: '1px solid #333', display: 'flex', gap: 8 }}>
                <input
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendReply()}
                  placeholder="اكتب ردك هنا... سيوصل للمستخدم عبر البوت"
                  style={{
                    flex: 1, padding: 10, borderRadius: 6, border: '1px solid #444',
                    background: '#0a0a0f', color: '#fff', fontSize: 14
                  }}
                />
                <button onClick={sendReply}
                  style={{
                    padding: '10px 20px', background: '#39ff14', color: '#000',
                    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold'
                  }}>
                  ارسال
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminSupportPanel;
