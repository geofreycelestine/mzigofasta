const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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
const db = new sqlite3.Database('./mzigofasta.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('✅ Connected to SQLite database');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    db.serialize(() => {
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            user_type TEXT CHECK(user_type IN ('shipper', 'driver')),
            city TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Driver profiles
        db.run(`CREATE TABLE IF NOT EXISTS driver_profiles (
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
        db.run(`CREATE TABLE IF NOT EXISTS loads (
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
        db.run(`CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            load_id INTEGER REFERENCES loads(id),
            driver_id INTEGER REFERENCES users(id),
            assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'completed'))
        )`, (err) => {
            if (err) {
                console.error('Error creating tables:', err);
            } else {
                console.log('✅ Database tables initialized');
            }
        });
    });
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
        db.get('SELECT * FROM users WHERE phone = ?', [phone], async (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            if (row) {
                return res.status(400).json({ error: 'Phone number already registered' });
            }
            
            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // Create user
            db.run(
                'INSERT INTO users (phone, password, name, user_type, city) VALUES (?, ?, ?, ?, ?)',
                [phone, hashedPassword, name, user_type, city],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Failed to create user' });
                    }
                    
                    const userId = this.lastID;
                    
                    // If driver, create driver profile
                    if (user_type === 'driver') {
                        db.run('INSERT INTO driver_profiles (user_id) VALUES (?)', [userId]);
                    }
                    
                    // Generate token
                    const token = jwt.sign({ userId }, JWT_SECRET);
                    
                    res.status(201).json({
                        message: 'User registered successfully',
                        token,
                        user: { id: userId, phone, name, user_type }
                    });
                }
            );
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login user
app.post('/api/login', (req, res) => {
    try {
        const { phone, password } = req.body;
        
        db.get('SELECT * FROM users WHERE phone = ?', [phone], async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
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
        
        db.run(
            'INSERT INTO loads (shipper_id, title, description, pickup_location, dropoff_location, cargo_type, weight_kg, truck_type_needed, price_offer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [shipper_id, title, description, pickup_location, dropoff_location, cargo_type, weight_kg, truck_type_needed, price_offer],
            function(err) {
                if (err) {
                    return res.status(500).json({ error: 'Failed to create load' });
                }
                
                res.status(201).json({
                    message: 'Load posted successfully',
                    load: { id: this.lastID, ...req.body, status: 'open' }
                });
            }
        );
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all open loads (for drivers)
app.get('/api/loads', (req, res) => {
    try {
        db.all(
            `SELECT loads.*, users.name as shipper_name, users.phone as shipper_phone 
             FROM loads 
             JOIN users ON loads.shipper_id = users.id 
             WHERE loads.status = ? 
             ORDER BY loads.created_at DESC`,
            ['open'],
            (err, rows) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                res.json({ loads: rows });
            }
        );
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