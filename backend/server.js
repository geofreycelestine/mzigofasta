const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database setup
const db = new Database('./mzigofasta.db');
console.log('✅ Connected to SQLite database');
initializeDatabase();

// Initialize database tables
function initializeDatabase() {
    try {
        // Users table
        db.exec(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            user_type TEXT CHECK(user_type IN ('shipper', 'driver')),
            city TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Driver profiles
        db.exec(`CREATE TABLE IF NOT EXISTS driver_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            truck_type TEXT,
            truck_capacity TEXT,
            license_number TEXT,
            is_verified INTEGER DEFAULT 0,
            current_location TEXT,
            is_available INTEGER DEFAULT 1
        )`);

        // Loads table
        db.exec(`CREATE TABLE IF NOT EXISTS loads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shipper_id INTEGER REFERENCES users(id),
            title TEXT NOT NULL,
            description TEXT,
            pickup_location TEXT NOT NULL,
            dropoff_location TEXT NOT NULL,
            cargo_type TEXT,
            weight_kg REAL,
            truck_type_needed TEXT,
            price_offer REAL,
            status TEXT DEFAULT 'open' CHECK(status IN ('open', 'assigned', 'in_transit', 'delivered', 'cancelled')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Assignments table
        db.exec(`CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            load_id INTEGER REFERENCES loads(id),
            driver_id INTEGER REFERENCES users(id),
            assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'completed'))
        )`);

        console.log('✅ Database tables initialized');
    } catch (err) {
        console.error('Error creating tables:', err);
    }
}

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'mzigofasta-secret-2026';

// Test route
app.get('/', (req, res) => {
    res.json({ message: '🚛 MzigoFasta API is running!' });
});

// Register user
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, name, user_type, city } = req.body;

        // Check if user exists
        const existingUser = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
        if (existingUser) {
            return res.status(400).json({ error: 'Phone number already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const result = db.prepare(
            'INSERT INTO users (phone, password, name, user_type, city) VALUES (?, ?, ?, ?, ?)'
        ).run(phone, hashedPassword, name, user_type, city);

        const userId = result.lastInsertRowid;

        // If driver, create driver profile
        if (user_type === 'driver') {
            db.prepare('INSERT INTO driver_profiles (user_id) VALUES (?)').run(userId);
        }

        // Generate token
        const token = jwt.sign({ userId }, JWT_SECRET);

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: { id: userId, phone, name, user_type }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login user
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
        if (!user) {
            return res.status(400).json({ error: 'Invalid phone or password' });
        }

        // Check password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid phone or password' });
        }

        // Generate token
        const token = jwt.sign({ userId: user.id }, JWT_SECRET);

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                phone: user.phone,
                name: user.name,
                user_type: user.user_type
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Post a load (shipper only)
app.post('/api/loads', (req, res) => {
    try {
        const { shipper_id, title, description, pickup_location, dropoff_location, cargo_type, weight_kg, truck_type_needed, price_offer } = req.body;

        const result = db.prepare(
            'INSERT INTO loads (shipper_id, title, description, pickup_location, dropoff_location, cargo_type, weight_kg, truck_type_needed, price_offer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(shipper_id, title, description, pickup_location, dropoff_location, cargo_type, weight_kg, truck_type_needed, price_offer);

        res.status(201).json({
            message: 'Load posted successfully',
            load: { id: result.lastInsertRowid, ...req.body, status: 'open' }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all open loads (for drivers)
app.get('/api/loads', (req, res) => {
    try {
        const rows = db.prepare(
            `SELECT loads.*, users.name as shipper_name, users.phone as shipper_phone 
             FROM loads 
             JOIN users ON loads.shipper_id = users.id 
             WHERE loads.status = ? 
             ORDER BY loads.created_at DESC`
        ).all('open');

        res.json({ loads: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚛 MzigoFasta server running on port ${PORT}`);
    console.log(`📡 API available at http://localhost:${PORT}`);
});