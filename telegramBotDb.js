/**
 * Telegram Bot DB Functions
 * Shared between server.js and telegramBot.js for direct DB access
 * Avoids HTTP self-calls that cause crashes during Telegram webhook processing
 */

let _withDb = null;

function setWithDb(fn) {
  _withDb = fn;
}

async function saveMessage(ticketId, sender, message) {
  if (!_withDb) return { success: false, error: 'DB not available' };
  if (!ticketId) return { success: false, error: 'ticketId is null/undefined' };
  try {
    // Step 1: Check if ticket exists
    const rows = await _withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT ticket_id FROM support_tickets WHERE ticket_id = $1`,
        [ticketId]
      );
      return rows;
    });
    
    if (!rows || rows.length === 0) {
      console.error('[DB] saveMessage: ticket not found:', ticketId);
      return { success: false, error: 'Ticket not found: ' + ticketId };
    }
    
    // Step 2: Save message
    await _withDb(async (c) => {
      await c.query(
        `INSERT INTO support_messages (ticket_id, sender, message) VALUES ($1, $2, $3)`,
        [ticketId, sender, message]
      );
      await c.query(
        `UPDATE support_tickets SET updated_at = NOW(), admin_reply = CASE WHEN $2 = 'admin' THEN $3 ELSE admin_reply END WHERE ticket_id = $1`,
        [ticketId, sender, message]
      );
    });
    console.log('[DB] saveMessage success:', { ticketId, sender });
    return { success: true };
  } catch (e) {
    console.error('[DB] saveMessage error:', e.message);
    return { success: false, error: e.message };
  }
}

async function getOpenTickets(limit = 10) {
  if (!_withDb) return { success: false, error: 'DB not available', tickets: [] };
  try {
    const rows = await _withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT ticket_id, telegram_chat_id, telegram_username, username, user_message, category, status, source
         FROM support_tickets WHERE status = 'open' ORDER BY created_at ASC LIMIT $1`,
        [limit]
      );
      return rows;
    });
    return { success: true, tickets: rows || [] };
  } catch (e) {
    console.error('[DB] getOpenTickets error:', e.message);
    return { success: false, error: e.message, tickets: [] };
  }
}

async function getTicket(ticketId) {
  if (!_withDb) return null;
  try {
    const rows = await _withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM support_tickets WHERE ticket_id = $1`,
        [ticketId]
      );
      return rows;
    });
    return rows && rows[0] ? rows[0] : null;
  } catch (e) {
    console.error('[DB] getTicket error:', e.message);
    return null;
  }
}

async function findUserByName(username) {
  if (!_withDb) return null;
  try {
    const rows = await _withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT telegram_id, telegram_username FROM users WHERE username = $1`,
        [username]
      );
      return rows;
    });
    return rows && rows[0] ? rows[0] : null;
  } catch (e) {
    console.error('[DB] findUserByName error:', e.message);
    return null;
  }
}

module.exports = {
  setWithDb,
  saveMessage,
  getOpenTickets,
  getTicket,
  findUserByName
};
