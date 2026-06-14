import React, { useState } from 'react';
import axios from 'axios';

function App() {
  const [username, setUsername] = useState('');
  const [invitedByCode, setInvitedByCode] = useState('');
  const [message, setMessage] = useState('');
  const [myCode, setMyCode] = useState('');
  const [isError, setIsError] = useState(false);

  const handleRegister = async () => {
    if (!username) {
      alert("الرجاء كتابة اسم المستخدم!");
      return;
    }

    try {
      setMessage("جاري التسجيل...");
      setIsError(false);
      setMyCode('');
      
      // الاتصال بالسيرفر المتواجد على المنفذ الجديد 4000
      const response = await axios.post('http://localhost:4000/api/register', {
        username,
        invitedByCode: invitedByCode || null
      });

      if (response.data.success) {
        setMessage("تم التسجيل بنجاح!");
        setMyCode(response.data.myCode);
      } else {
        setIsError(true);
        setMessage(response.data.message || "فشل التسجيل!");
      }
    } catch (error) {
      setIsError(true);
      setMessage(error.response?.data?.message || "تعذر الاتصال بالسيرفر! تأكد من تشغيل السيرفر الخلفي (المنفذ 4000).");
    }
  };

  return (
    <div style={{ fontFamily: 'Tahoma, sans-serif', backgroundColor: '#f4f4f9', minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', direction: 'rtl' }}>
      <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '10px', boxShadow: '0 4px 8px rgba(0,0,0,0.1)', width: '350px', textAlign: 'center' }}>
        <h2 style={{ color: '#333', marginBottom: '20px' }}>تسجيل عضو جديد (React)</h2>
        
        <input 
          type="text" 
          placeholder="اسم المستخدم الجديد" 
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ width: '90%', padding: '10px', margin: '10px 0', border: '1px solid #ccc', borderRadius: '5px', textAlign: 'center', fontSize: '15px' }}
        />
        
        <input 
          type="text" 
          placeholder="كود الشخص الذي دعاك (اختياري)" 
          value={invitedByCode}
          onChange={(e) => setInvitedByCode(e.target.value)}
          style={{ width: '90%', padding: '10px', margin: '10px 0', border: '1px solid #ccc', borderRadius: '5px', textAlign: 'center', fontSize: '15px' }}
        />
        
        <button 
          onClick={handleRegister}
          style={{ width: '95%', padding: '10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '16px', marginTop: '15px', fontWeight: 'bold' }}
        >
          تسجيل في المنصة
        </button>

        {message && (
          <div style={{ marginTop: '20px', padding: '10px', borderRadius: '5px', backgroundColor: isError ? '#f8d7da' : '#d4edda', color: isError ? '#721c24' : '#155724', fontWeight: 'bold' }}>
            {message}
            {myCode && <div style={{ color: '#004085', marginTop: '8px' }}>كود الإحالة الخاص بك هو: <span style={{ color: 'red', fontSize: '20px', letterSpacing: '1px' }}>{myCode}</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
