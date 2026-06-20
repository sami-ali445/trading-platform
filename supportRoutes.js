/**
 * Support Ticket API Routes
 * Handles CRUD for support tickets and messages
 */

function setupSupportRoutes(app, withDb, authenticateToken, requireAdmin) {
  
  // ============ DATABASE SETUP ============
  // Create tables if not exist
  (async () => {
    try {
      await withDb(async (c) => {
        await c.query(`
          CREATE TABLE IF NOT EXISTS support_tickets (
            id SERIAL PRIMARY KEY,
            ticket_id VARCHAR(36) UNIQUE NOT NULL,
            telegram_chat_id BIGINT,
            telegram_username VARCHAR(255),
            username VARCHAR(255),
            user_message TEXT NOT NULL,
            bot_reply TEXT,
            admin_reply TEXT,
            status VARCHAR(20) DEFAULT 'open',
            category VARCHAR(50) DEFAULT 'general',
            source VARCHAR(20) DEFAULT 'web',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            resolved_at TIMESTAMP
          )
        `);
        await c.query(`
          CREATE TABLE IF NOT EXISTS support_messages (
            id SERIAL PRIMARY KEY,
            ticket_id VARCHAR(36) REFERENCES support_tickets(ticket_id),
            sender VARCHAR(20) NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_chat_id ON support_tickets(telegram_chat_id)`);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status)`);
        await c.query(`CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id ON support_messages(ticket_id)`);
      });
      console.log('[SUPPORT] Tables created/verified OK');
    } catch (e) {
      console.error('[SUPPORT] Table creation failed:', e.message);
    }
  })();

  // ============ PUBLIC ENDPOINTS ============

  // Create new ticket
  app.post('/api/support/tickets', async (req, res) => {
    try {
      const { ticketId, telegramChatId, telegramUsername, message, category } = req.body;
      
      if (!ticketId || !message) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
      }
      
      await withDb(async (c) => {
        await c.query(
          `INSERT INTO support_tickets (ticket_id, telegram_chat_id, telegram_username, user_message, category, status, source)
           VALUES ($1, $2, $3, $4, $5, 'open', 'telegram')
           ON CONFLICT (ticket_id) DO UPDATE SET updated_at = NOW()`,
          [ticketId, telegramChatId || null, telegramUsername || null, message, category || 'general']
        );
      });
      
      res.json({ success: true, ticketId });
    } catch (err) {
      console.error('[SUPPORT] Create ticket:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Add message to ticket
  app.post('/api/support/messages', async (req, res) => {
    try {
      const { ticketId, sender, message } = req.body;
      
      if (!ticketId || !sender || !message) {
        return res.status(400).json({ success: false, message: 'Missing fields' });
      }
      
      await withDb(async (c) => {
        await c.query(
          `INSERT INTO support_messages (ticket_id, sender, message) VALUES ($1, $2, $3)`,
          [ticketId, sender, message]
        );
        await c.query(
          `UPDATE support_tickets SET updated_at = NOW(), admin_reply = CASE WHEN $1 = 'admin' THEN $2 ELSE admin_reply END WHERE ticket_id = $3`,
          [sender, message, ticketId]
        );
      });
      
      res.json({ success: true });
    } catch (err) {
      console.error('[SUPPORT] Add message:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ============ USER ENDPOINTS (authenticated) ============

  // Get user's active ticket
  app.get('/api/user/support/ticket', authenticateToken, async (req, res) => {
    try {
      const ticket = await withDb(async (c) => {
        const { rows } = await c.query(
          `SELECT * FROM support_tickets 
           WHERE username = $1 AND status = 'open' 
           ORDER BY created_at DESC LIMIT 1`,
          [req.user.username]
        );
        return rows[0];
      });

      if (!ticket) {
        return res.json({ success: true, ticket: null, messages: [] });
      }

      const messages = await withDb(async (c) => {
        const { rows } = await c.query(
          'SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
          [ticket.ticket_id]
        );
        return rows;
      });

      res.json({ success: true, ticket, messages: messages || [] });
    } catch (err) {
      console.error('[SUPPORT] Get user ticket:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // User sends a message (creates ticket if needed)
  app.post('/api/user/support/message', authenticateToken, async (req, res) => {
    try {
      const { message, ticketId } = req.body;
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, message: 'Message required' });
      }

      let activeTicketId = ticketId;

      // Get user's telegram info
      const userInfo = await withDb(async (c) => {
        const { rows } = await c.query(
          'SELECT telegram_id, telegram_username FROM users WHERE username = $1',
          [req.user.username]
        );
        return rows[0];
      });
      const userTelegramId = userInfo?.telegram_id || null;
      const userTelegramUsername = userInfo?.telegram_username || null;

      // If no ticketId, find or create one
      if (!activeTicketId) {
        const existing = await withDb(async (c) => {
          const { rows } = await c.query(
            `SELECT ticket_id FROM support_tickets 
             WHERE username = $1 AND status = 'open' 
             ORDER BY created_at DESC LIMIT 1`,
            [req.user.username]
          );
          return rows[0];
        });

        if (existing) {
          activeTicketId = existing.ticket_id;
          // Update ticket with telegram info if user has it and ticket doesn't
          if (userTelegramId) {
            await withDb(async (c) => {
              await c.query(
                `UPDATE support_tickets SET telegram_chat_id = COALESCE(telegram_chat_id, $1), telegram_username = COALESCE(telegram_username, $2) WHERE ticket_id = $3`,
                [userTelegramId, userTelegramUsername, activeTicketId]
              );
            });
          }
        } else {
          // Create new ticket
          const crypto = require('crypto');
          activeTicketId = 'WEB-' + crypto.randomBytes(4).toString('hex').toUpperCase();
          await withDb(async (c) => {
            await c.query(
              `INSERT INTO support_tickets (ticket_id, telegram_chat_id, telegram_username, username, user_message, category, status, source)
               VALUES ($1, $2, $3, $4, $5, 'general', 'open', 'web')`,
              [activeTicketId, userTelegramId, userTelegramUsername, req.user.username, message.trim()]
            );
          });
        }
      }

      // Save message
      await withDb(async (c) => {
        await c.query(
          `INSERT INTO support_messages (ticket_id, sender, message) VALUES ($1, 'user', $2)`,
          [activeTicketId, message.trim()]
        );
        await c.query(
          `UPDATE support_tickets SET updated_at = NOW() WHERE ticket_id = $1`,
          [activeTicketId]
        );
      });

      // Send to admin's Telegram via bot
      try {
        const { sendMessage: tgSendMessage } = require('../telegramBot');
        const adminTelegramId = process.env.ADMIN_TELEGRAM_ID || '8916948567';
        const webMsg = `💬 *رسالة دعم جديدة من الموقع*

` +
          `👤 المستخدم: ${req.user.username}
` +
          `📝 الرسالة:
_${message.trim()}_`;
        console.log('[SUPPORT] Sending to Telegram:', adminTelegramId);
        await tgSendMessage(adminTelegramId, webMsg);
        console.log('[SUPPORT] Telegram sent OK');
      } catch (e) {
        console.error('[SUPPORT] Bot send failed:', e.message);
      }

      // Notify admin via Telegram if user has telegram linked
      if (userTelegramId) {
        try {
          const { notifyAdmin } = require('../telegramBot');
          if (notifyAdmin) {
            await notifyAdmin(activeTicketId, { id: userTelegramId, username: req.user.username }, message.trim(), 'general');
          }
        } catch (e) {
          console.error('[SUPPORT] Telegram notify failed:', e.message);
        }
      }

      res.json({ success: true, ticketId: activeTicketId });
    } catch (err) {
      console.error('[SUPPORT] User message:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // User creates a new ticket (closes old one if exists)
  app.post('/api/user/support/new-ticket', authenticateToken, async (req, res) => {
    try {
      const crypto = require('crypto');
      const newTicketId = 'WEB-' + crypto.randomBytes(4).toString('hex').toUpperCase();

      await withDb(async (c) => {
        // Close old tickets
        await c.query(
          `UPDATE support_tickets SET status = 'closed', resolved_at = NOW() 
           WHERE username = $1 AND status = 'open'`,
          [req.user.username]
        );
        // Create new
        await c.query(
          `INSERT INTO support_tickets (ticket_id, username, user_message, category, status, source)
           VALUES ($1, $2, 'فتح تذكرة جديدة', 'general', 'open', 'web')`,
          [newTicketId, req.user.username]
        );
      });

      res.json({ success: true, ticketId: newTicketId });
    } catch (err) {
      console.error('[SUPPORT] New ticket:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // ============ ADMIN ENDPOINTS ============

  // Get all tickets (admin only)
  app.get('/api/admin/support/tickets', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { status, limit = 50, offset = 0 } = req.query;
      
      let query = 'SELECT * FROM support_tickets';
      const params = [];
      
      if (status && status !== 'all') {
        query += ' WHERE status = $1';
        params.push(status);
      }
      
      query += ` ORDER BY updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(parseInt(offset));
      
      const tickets = await withDb(async (c) => {
        const { rows } = await c.query(query, params);
        return rows;
      });
      
      // Get total count
      const countResult = await withDb(async (c) => {
        const { rows } = await c.query(
          status && status !== 'all' 
            ? 'SELECT COUNT(*) as total FROM support_tickets WHERE status = $1'
            : 'SELECT COUNT(*) as total FROM support_tickets',
          status && status !== 'all' ? [status] : []
        );
        return rows[0];
      });
      
      res.json({
        success: true,
        tickets: tickets || [],
        total: parseInt(countResult?.total) || 0
      });
    } catch (err) {
      console.error('[SUPPORT] Get tickets:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Get single ticket with messages (admin only)
  app.get('/api/admin/support/tickets/:ticketId', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { ticketId } = req.params;
      
      const ticket = await withDb(async (c) => {
        const { rows } = await c.query('SELECT * FROM support_tickets WHERE ticket_id = $1', [ticketId]);
        return rows[0];
      });
      
      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }
      
      const messages = await withDb(async (c) => {
        const { rows } = await c.query(
          'SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
          [ticketId]
        );
        return rows;
      });
      
      res.json({ success: true, ticket, messages: messages || [] });
    } catch (err) {
      console.error('[SUPPORT] Get ticket:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Admin reply to ticket
  app.post('/api/admin/support/tickets/:ticketId/reply', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { message } = req.body;
      
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, message: 'Message required' });
      }
      
      // Check ticket exists and is open
      const ticket = await withDb(async (c) => {
        const { rows } = await c.query('SELECT * FROM support_tickets WHERE ticket_id = $1', [ticketId]);
        return rows[0];
      });
      
      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }
      
      if (ticket.status === 'closed') {
        return res.status(400).json({ success: false, message: 'Ticket is closed' });
      }
      
      // Save message
      await withDb(async (c) => {
        await c.query(
          `INSERT INTO support_messages (ticket_id, sender, message) VALUES ($1, 'admin', $2)`,
          [ticketId, message]
        );
        await c.query(
          `UPDATE support_tickets SET admin_reply = $1, updated_at = NOW() WHERE ticket_id = $2`,
          [message, ticketId]
        );
      });
      
      // Forward to Telegram user (works for both web and telegram tickets)
      try {
        const { adminReply } = require('../telegramBot');
        if (adminReply) {
          const result = await adminReply(ticketId, message);
          if (!result?.success) {
            console.error('[SUPPORT] Telegram forward result:', result?.error || 'unknown error');
          }
        }
      } catch (e) {
        console.error('[SUPPORT] Telegram forward failed:', e.message);
      }

      res.json({ success: true, message: 'Reply sent' });
    } catch (err) {
      console.error('[SUPPORT] Reply:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Close ticket
  app.post('/api/admin/support/tickets/:ticketId/close', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { ticketId } = req.params;
      
      await withDb(async (c) => {
        await c.query(
          `UPDATE support_tickets SET status = 'closed', resolved_at = NOW(), updated_at = NOW() WHERE ticket_id = $1`,
          [ticketId]
        );
      });
      
      // Notify user on Telegram
      try {
        const { closeTicket } = require('../telegramBot');
        if (closeTicket) {
          await closeTicket(ticketId);
        }
      } catch (e) {
        console.error('[SUPPORT] Telegram close notify failed:', e.message);
      }
      
      res.json({ success: true, message: 'Ticket closed' });
    } catch (err) {
      console.error('[SUPPORT] Close ticket:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Reopen ticket
  app.post('/api/admin/support/tickets/:ticketId/reopen', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { ticketId } = req.params;
      
      await withDb(async (c) => {
        await c.query(
          `UPDATE support_tickets SET status = 'open', resolved_at = NULL, updated_at = NOW() WHERE ticket_id = $1`,
          [ticketId]
        );
      });
      
      res.json({ success: true, message: 'Ticket reopened' });
    } catch (err) {
      console.error('[SUPPORT] Reopen ticket:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  // Get ticket statistics (admin only)
  app.get('/api/admin/support/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const stats = await withDb(async (c) => {
        const { rows } = await c.query(`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'open') as open,
            COUNT(*) FILTER (WHERE status = 'closed') as closed,
            COUNT(*) FILTER (WHERE category = 'deposit') as deposit,
            COUNT(*) FILTER (WHERE category = 'withdraw') as withdraw,
            COUNT(*) FILTER (WHERE category = 'support_request') as support,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h
          FROM support_tickets
        `);
        return rows[0];
      });
      
      res.json({ success: true, stats });
    } catch (err) {
      console.error('[SUPPORT] Stats:', err.message);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });

  console.log('[SUPPORT] Routes registered');
}

module.exports = { setupSupportRoutes };
