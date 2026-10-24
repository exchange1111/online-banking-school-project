const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'bank.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: 'urban-bank-school-project-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
  })
);

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function setupDatabase() {
  await runAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      token TEXT,
      admin_note TEXT,
      requested_at TEXT NOT NULL,
      issued_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await runAsync(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  const userCount = await getAsync('SELECT COUNT(*) AS count FROM users');
  if (!userCount || Number(userCount.count) === 0) {
    await runAsync(
      `INSERT INTO users (id, name, email, password, role, balance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)` ,
      [
        'admin-1',
        'Bank Admin',
        'admin@bank.com',
        bcrypt.hashSync('admin123', 10),
        'admin',
        250000,
        new Date().toISOString()
      ]
    );

    await runAsync(
      `INSERT INTO users (id, name, email, password, role, balance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)` ,
      [
        'user-1',
        'Aisha Hassan',
        'user@bank.com',
        bcrypt.hashSync('user123', 10),
        'user',
        15000,
        new Date().toISOString()
      ]
    );

    await runAsync(
      `INSERT INTO chat_messages (id, user_id, sender, text, created_at) VALUES (?, ?, ?, ?, ?)` ,
      [
        'welcome-msg',
        'user-1',
        'support',
        'Welcome! To request a withdrawal, type: "withdraw 250".',
        new Date().toISOString()
      ]
    );
  }
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateToken() {
  return `WB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function setCurrentUser(req, user) {
  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.get('/', (req, res) => {
  res.render('index', { user: req.session.user || null });
});

app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/dashboard');
  }
  res.render('login', { error: null });
});

app.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/dashboard');
  }
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.render('register', { error: 'Please fill in all fields.' });
  }

  const existingUser = await getAsync('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [String(email).trim()]);
  if (existingUser) {
    return res.render('register', { error: 'That email is already registered.' });
  }

  const newUser = {
    id: generateId('user'),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    password: bcrypt.hashSync(password, 10),
    role: 'user',
    balance: 0,
    createdAt: new Date().toISOString()
  };

  await runAsync(
    `INSERT INTO users (id, name, email, password, role, balance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)` ,
    [
      newUser.id,
      newUser.name,
      newUser.email,
      newUser.password,
      newUser.role,
      newUser.balance,
      newUser.createdAt
    ]
  );

  setCurrentUser(req, newUser);
  res.redirect('/dashboard');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await getAsync('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [String(email).trim()]);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Invalid email or password.' });
  }

  setCurrentUser(req, user);
  res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/dashboard', requireAuth, async (req, res) => {
  const currentUser = await getAsync('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
  if (!currentUser) {
    return res.redirect('/logout');
  }

  const requests = await allAsync(
    'SELECT * FROM withdrawal_requests WHERE user_id = ? ORDER BY requested_at DESC',
    [currentUser.id]
  );

  res.render('dashboard', { user: currentUser, requests });
});

app.get('/chat', requireAuth, async (req, res) => {
  const currentUser = await getAsync('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
  const messages = await allAsync(
    'SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC',
    [currentUser.id]
  );

  res.render('chat', { user: currentUser, messages });
});

app.post('/chat/message', requireAuth, async (req, res) => {
  const messageText = String(req.body.message || '').trim();
  if (!messageText) {
    return res.redirect('/chat');
  }

  const currentUser = await getAsync('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
  const chatMessages = await allAsync('SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC', [currentUser.id]);

  await runAsync(
    'INSERT INTO chat_messages (id, user_id, sender, text, created_at) VALUES (?, ?, ?, ?, ?)',
    [generateId('msg'), currentUser.id, 'user', messageText, new Date().toISOString()]
  );

  let replyText = 'I can help with your balance and withdrawal requests. Try: "withdraw 300".';
  const normalized = messageText.toLowerCase();

  if (normalized.includes('balance')) {
    replyText = `Your current balance is $${Number(currentUser.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
  } else if (normalized.includes('withdraw')) {
    const match = messageText.match(/\$?(\d+(?:\.\d+)?)/);
    const amount = match ? Number(match[1]) : 0;

    if (amount > 0) {
      await runAsync(
        `INSERT INTO withdrawal_requests (id, user_id, amount, status, token, admin_note, requested_at, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateId('withdrawal'),
          currentUser.id,
          amount,
          'pending',
          null,
          '',
          new Date().toISOString(),
          null
        ]
      );
      replyText = `Your withdrawal request for $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} has been submitted and is waiting for approval.`;
    } else {
      replyText = 'Please enter a valid amount. Example: "withdraw 250".';
    }
  } else if (normalized.includes('hello') || normalized.includes('hi')) {
    replyText = 'Hello! I can assist with account balance and withdrawal requests.';
  }

  await runAsync(
    'INSERT INTO chat_messages (id, user_id, sender, text, created_at) VALUES (?, ?, ?, ?, ?)',
    [generateId('reply'), currentUser.id, 'support', replyText, new Date().toISOString()]
  );

  res.redirect('/chat');
});

app.get('/admin', requireAdmin, async (req, res) => {
  const users = await allAsync('SELECT * FROM users ORDER BY created_at DESC');
  const requests = await allAsync('SELECT * FROM withdrawal_requests ORDER BY requested_at DESC');
  const totalBalance = users.reduce((sum, user) => sum + Number(user.balance || 0), 0);

  res.render('admin', { user: req.session.user, users, requests, totalBalance });
});

app.post('/admin/users/:id/balance', requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const newBalance = Number(req.body.balance);

  if (!Number.isFinite(newBalance)) {
    return res.redirect('/admin');
  }

  await runAsync('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);
  res.redirect('/admin');
});

app.post('/admin/tokens/:id/issue', requireAdmin, async (req, res) => {
  const requestId = req.params.id;
  const request = await getAsync('SELECT * FROM withdrawal_requests WHERE id = ?', [requestId]);

  if (!request) {
    return res.redirect('/admin');
  }

  const user = await getAsync('SELECT * FROM users WHERE id = ?', [request.user_id]);
  const token = generateToken();
  const amount = Number(request.amount || 0);

  await runAsync(
    `UPDATE withdrawal_requests SET status = ?, token = ?, admin_note = ?, issued_at = ? WHERE id = ?`,
    ['approved', token, String(req.body.note || 'Withdrawal approved'), new Date().toISOString(), requestId]
  );

  if (user) {
    await runAsync('UPDATE users SET balance = ? WHERE id = ?', [Math.max(0, Number(user.balance) - amount), user.id]);
  }

  if (user) {
    await runAsync(
      'INSERT INTO chat_messages (id, user_id, sender, text, created_at) VALUES (?, ?, ?, ?, ?)',
      [
        generateId('token'),
        user.id,
        'support',
        `Your withdrawal token is ${token}. Please present this token when completing your withdrawal.`,
        new Date().toISOString()
      ]
    );
  }

  res.redirect('/admin');
});

(async () => {
  await setupDatabase();
  app.listen(PORT, () => {
    console.log(`Urban Bank app running at http://localhost:${PORT}`);
  });
})();
