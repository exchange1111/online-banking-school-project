const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'withdrawal-requests.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: 'online-banking-school-project-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
  })
);

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(
      USERS_FILE,
      JSON.stringify(
        [
          {
            id: 'admin-1',
            name: 'Bank Admin',
            email: 'admin@bank.com',
            password: bcrypt.hashSync('admin123', 10),
            role: 'admin',
            balance: 250000,
            createdAt: new Date().toISOString()
          },
          {
            id: 'user-1',
            name: 'Aisha Hassan',
            email: 'user@bank.com',
            password: bcrypt.hashSync('user123', 10),
            role: 'user',
            balance: 15000,
            createdAt: new Date().toISOString()
          }
        ],
        null,
        2
      )
    );
  }

  if (!fs.existsSync(REQUESTS_FILE)) {
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify([], null, 2));
  }

  if (!fs.existsSync(CHAT_FILE)) {
    fs.writeFileSync(
      CHAT_FILE,
      JSON.stringify(
        [
          {
            id: 'welcome-message',
            userId: 'user-1',
            sender: 'support',
            text: 'Welcome! To request a withdrawal, type: "withdraw 250".',
            createdAt: new Date().toISOString()
          }
        ],
        null,
        2
      )
    );
  }
}

function readJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw || '[]');
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getUsers() {
  ensureStorage();
  return readJSON(USERS_FILE);
}

function getWithdrawalRequests() {
  ensureStorage();
  return readJSON(REQUESTS_FILE);
}

function getChatMessages() {
  ensureStorage();
  return readJSON(CHAT_FILE);
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

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateToken() {
  return `WB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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
  res.render('login');
});

app.get('/register', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/dashboard');
  }
  res.render('register');
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const users = getUsers();

  if (!name || !email || !password) {
    return res.render('register', { error: 'Please fill in all fields.' });
  }

  const existingUser = users.find((user) => user.email.toLowerCase() === String(email).toLowerCase());
  if (existingUser) {
    return res.render('register', { error: 'An account with this email already exists.' });
  }

  const newUser = {
    id: generateId('user'),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password: bcrypt.hashSync(password, 10),
    role: 'user',
    balance: 0,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeJSON(USERS_FILE, users);
  setCurrentUser(req, newUser);
  res.redirect('/dashboard');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const users = getUsers();
  const user = users.find((entry) => entry.email.toLowerCase() === String(email).toLowerCase());

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

app.get('/dashboard', requireAuth, (req, res) => {
  const users = getUsers();
  const currentUser = users.find((user) => user.id === req.session.user.id);

  if (!currentUser) {
    return res.redirect('/logout');
  }

  const requests = getWithdrawalRequests().filter((request) => request.userId === currentUser.id);
  res.render('dashboard', {
    user: currentUser,
    requests
  });
});

app.get('/chat', requireAuth, (req, res) => {
  const users = getUsers();
  const currentUser = users.find((user) => user.id === req.session.user.id);
  const messages = getChatMessages().filter((message) => message.userId === currentUser.id);

  res.render('chat', {
    user: currentUser,
    messages
  });
});

app.post('/chat/message', requireAuth, (req, res) => {
  const users = getUsers();
  const currentUser = users.find((user) => user.id === req.session.user.id);
  const messageText = String(req.body.message || '').trim();
  const chatMessages = getChatMessages();

  if (!messageText) {
    return res.redirect('/chat');
  }

  chatMessages.push({
    id: generateId('msg'),
    userId: currentUser.id,
    sender: 'user',
    text: messageText,
    createdAt: new Date().toISOString()
  });

  let replyText = 'I can help with balance checks and withdrawal requests. Try: "withdraw 500".';
  const normalized = messageText.toLowerCase();

  if (normalized.includes('balance')) {
    replyText = `Your current balance is $${Number(currentUser.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
  } else if (normalized.includes('withdraw')) {
    const match = messageText.match(/\d+(?:\.\d+)?/);
    const amount = match ? Number(match[0]) : 0;

    if (amount > 0) {
      const requests = getWithdrawalRequests();
      requests.push({
        id: generateId('withdrawal'),
        userId: currentUser.id,
        amount,
        status: 'pending',
        token: null,
        requestedAt: new Date().toISOString(),
        adminNote: ''
      });
      writeJSON(REQUESTS_FILE, requests);

      replyText = `Your withdrawal request for $${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} is pending. A support agent will issue your token soon.`;
    } else {
      replyText = 'Please tell me the amount you want to withdraw. Example: "withdraw 250".';
    }
  } else if (normalized.includes('hello') || normalized.includes('hi')) {
    replyText = 'Hello! I can help with balances and withdrawal requests. Ask me to withdraw an amount.';
  }

  chatMessages.push({
    id: generateId('reply'),
    userId: currentUser.id,
    sender: 'support',
    text: replyText,
    createdAt: new Date().toISOString()
  });

  writeJSON(CHAT_FILE, chatMessages);
  res.redirect('/chat');
});

app.get('/admin', requireAdmin, (req, res) => {
  const users = getUsers();
  const requests = getWithdrawalRequests().sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  const totalBalance = users.reduce((sum, user) => sum + Number(user.balance || 0), 0);

  res.render('admin', {
    user: req.session.user,
    users,
    requests,
    totalBalance
  });
});

app.post('/admin/users/:id/balance', requireAdmin, (req, res) => {
  const users = getUsers();
  const user = users.find((entry) => entry.id === req.params.id);

  if (!user) {
    return res.redirect('/admin');
  }

  const newBalance = Number(req.body.balance);
  if (!Number.isFinite(newBalance)) {
    return res.redirect('/admin');
  }

  user.balance = newBalance;
  writeJSON(USERS_FILE, users);
  res.redirect('/admin');
});

app.post('/admin/tokens/:id/issue', requireAdmin, (req, res) => {
  const requests = getWithdrawalRequests();
  const request = requests.find((entry) => entry.id === req.params.id);
  const users = getUsers();

  if (!request) {
    return res.redirect('/admin');
  }

  const user = users.find((entry) => entry.id === request.userId);
  const token = generateToken();

  request.status = 'approved';
  request.token = token;
  request.adminNote = req.body.note || 'Withdrawal token approved';
  request.issuedAt = new Date().toISOString();

  if (user) {
    user.balance = Math.max(0, Number(user.balance || 0) - Number(request.amount || 0));
  }

  writeJSON(USERS_FILE, users);
  writeJSON(REQUESTS_FILE, requests);

  const chatMessages = getChatMessages();
  chatMessages.push({
    id: generateId('token'),
    userId: user ? user.id : request.userId,
    sender: 'support',
    text: `Your withdrawal token is ${token}. Please present this token at the branch or support desk to complete the transaction.`,
    createdAt: new Date().toISOString()
  });
  writeJSON(CHAT_FILE, chatMessages);

  res.redirect('/admin');
});

ensureStorage();

app.listen(PORT, () => {
  console.log(`Banking app running at http://localhost:${PORT}`);
});
