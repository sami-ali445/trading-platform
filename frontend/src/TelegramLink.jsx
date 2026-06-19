/**
 * TelegramLink - ربط حساب تيليجرام للمستخدم
 * يتيح للمستخدم ربط حسابه في تيليجرام لاستلام ردود الدعم الفني على الجوال
 */

import { useState, useEffect } from 'react';

function TelegramLink({ API }) {
  const [linked, setLinked] = useState(false);
  const [telegramId, setTelegramId] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [savedId, setSavedId] = useState(null);
  const [savedUsername, setSavedUsername] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // Load current status
  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const { data } = await API.get('/user/telegram/status');
      if (data.success) {
        setLinked(data.linked);
        setSavedId(data.telegramId);
        setSavedUsername(data.telegramUsername);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleLink = async () => {
    if (!telegramId.trim() && !telegramUsername.trim()) {
      setMsg({ type: 'error', text: 'أدخل معرف تيليجرام (ID) أو اسم المستخدم' });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const payload = {};
      if (telegramId.trim()) payload.telegramId = telegramId.trim();
      if (telegramUsername.trim()) payload.telegramUsername = telegramUsername.trim();

      const { data } = await API.post('/user/telegram/link', payload);
      if (data.success) {
        setMsg({ type: 'success', text: '✅ تم ربط حساب تيليجرام بنجاح!' });
        setLinked(true);
        setSavedId(data.telegramId || parseInt(telegramId.trim()));
        setSavedUsername(data.telegramUsername || telegramUsername.trim());
      } else {
        setMsg({ type: 'error', text: data.message || 'حدث خطأ' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: 'خطأ في الاتصال بالسيرفر' });
    }
    setSaving(false);
  };

  const handleUnlink = async () => {
    if (!confirm('هل تريد إلغاء ربط حساب تيليجرام؟ لن تصلك ردود الدعم على الجوال.')) return;
    try {
      const { data } = await API.delete('/user/telegram/link');
      if (data.success) {
        setLinked(false);
        setSavedId(null);
        setSavedUsername(null);
        setTelegramId('');
        setTelegramUsername('');
        setMsg({ type: 'success', text: 'تم إلغاء ربط تيليجرام' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: 'خطأ في الاتصال' });
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ color: 'var(--text3)' }}>جاري التحميل...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, maxWidth: 600, margin: '0 auto' }}>
      <h3 style={{ color: '#39ff14', marginBottom: 15 }}>📱 ربط حساب تيليجرام</h3>

      <div style={{
        background: 'var(--bg3)', padding: 18, borderRadius: 10, marginBottom: 20,
        border: '1px solid var(--border)', lineHeight: 1.8, fontSize: 14, color: 'var(--text2)'
      }}>
        <p style={{ marginBottom: 10 }}>
          <strong style={{ color: '#39ff14' }}>📌 لماذا ربط تيليجرام؟</strong>
        </p>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>استلام ردود الدعم الفني مباشرة على جوالك</li>
          <li>إشعارات فورية عند رد فريق الدعم على تذكرتك</li>
          <li>لا تحتاج لتسجيل الدخول للموقع للرد على رسائل الدعم</li>
        </ul>
      </div>

      {msg && (
        <div style={{
          padding: '10px 16px', borderRadius: 8, marginBottom: 15, fontSize: 14,
          background: msg.type === 'success' ? '#1a3a2e' : '#3a1a1a',
          color: msg.type === 'success' ? '#4ade80' : '#f87171',
          border: msg.type === 'success' ? '1px solid #2a4a3e' : '1px solid #5a2a2a'
        }}>
          {msg.text}
        </div>
      )}

      {linked ? (
        <div style={{
          background: '#1a2a1a', padding: 18, borderRadius: 10, border: '1px solid #2a4a2e'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 24 }}>✅</span>
            <div>
              <div style={{ color: '#4ade80', fontWeight: 'bold', fontSize: 16 }}>حساب تيليجرام مربوط</div>
              <div style={{ color: '#888', fontSize: 13 }}>
                ID: <code style={{ color: '#aaa', background: '#0a0a0f', padding: '2px 8px', borderRadius: 4 }}>{savedId}</code>
                {savedUsername && <> | @{savedUsername}</>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleUnlink}
              style={{
                padding: '8px 20px', background: '#3a1a1a', color: '#f87171',
                border: '1px solid #5a2a2a', borderRadius: 6, cursor: 'pointer', fontSize: 13
              }}
            >
              🔓 إلغاء الربط
            </button>
          </div>
        </div>
      ) : (
        <div style={{ background: 'var(--bg3)', padding: 18, borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: 'var(--text3)', fontSize: 13, marginBottom: 4 }}>
              معرف تيليجرام (Telegram ID) - أرقام فقط
            </label>
            <input
              value={telegramId}
              onChange={e => setTelegramId(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="مثال: 123456789"
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #444',
                background: '#0a0a0f', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box'
              }}
            />
            <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
              💡 للحصول على ID: أرسل /id للبوت @userinfobot في تيليجرام
            </div>
          </div>
          <div style={{ marginBottom: 15 }}>
            <label style={{ display: 'block', color: 'var(--text3)', fontSize: 13, marginBottom: 4 }}>
              اسم المستخدم في تيليجرام (اختياري)
            </label>
            <input
              value={telegramUsername}
              onChange={e => setTelegramUsername(e.target.value.replace(/^@/, ''))}
              placeholder="مثال: username (بدون @)"
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #444',
                background: '#0a0a0f', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>
          <button
            onClick={handleLink}
            disabled={saving || (!telegramId.trim() && !telegramUsername.trim())}
            style={{
              width: '100%', padding: 12,
              background: saving || (!telegramId.trim() && !telegramUsername.trim()) ? '#333' : '#39ff14',
              color: saving || (!telegramId.trim() && !telegramUsername.trim()) ? '#666' : '#000',
              border: 'none', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
              fontWeight: 'bold', fontSize: 15
            }}
          >
            {saving ? '⏳ جاري الربط...' : '📱 ربط حساب تيليجرام'}
          </button>
        </div>
      )}

      <div style={{
        marginTop: 20, padding: 14, background: '#152238', borderRadius: 8,
        fontSize: 13, color: 'var(--text3)', lineHeight: 1.7
      }}>
        <strong style={{ color: '#60a5fa' }}>🔒 خصوصية:</strong> يتم تخزين معرف تيليجرام بشكل مشفر ويستخدم فقط لإرسال ردود الدعم الفني. لن نشاركه مع أي طرف ثالث.
      </div>
    </div>
  );
}

export default TelegramLink;
