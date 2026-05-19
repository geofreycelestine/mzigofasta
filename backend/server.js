const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database path
const dbPath = path.join(__dirname, 'mzigofasta.db');

// Force recreate tables (remove in production after first deploy)
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('✅ Old database removed, new schema will be created');
}

// Database setup
const db = new Database(dbPath);
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

        // Loads table - ENHANCED with all Phase 1 fields
        db.exec(`CREATE TABLE IF NOT EXISTS loads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shipper_id INTEGER REFERENCES users(id),
            tracking_number TEXT UNIQUE,
            material_name TEXT NOT NULL,
            quantity_tons REAL NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            cargo_type TEXT,
            other_cargo_desc TEXT,
            requires_permit INTEGER DEFAULT 0,
            permit_details TEXT,
            health_hazard INTEGER DEFAULT 0,
            hazard_details TEXT,
            pickup_region TEXT NOT NULL,
            pickup_district TEXT NOT NULL,
            pickup_ward TEXT,
            pickup_landmark TEXT,
            dropoff_region TEXT NOT NULL,
            dropoff_district TEXT NOT NULL,
            dropoff_ward TEXT,
            dropoff_landmark TEXT,
            truck_type_needed TEXT,
            rate_per_ton REAL,
            total_price REAL,
            vat_exclusive INTEGER DEFAULT 1,
            pickup_date TEXT,
            pickup_time TEXT,
            return_load INTEGER DEFAULT 0,
            return_date TEXT,
            return_destination TEXT,
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

// Generate tracking number
function generateTrackingNumber() {
    const prefix = 'MZF';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
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

        const existingUser = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
        if (existingUser) {
            return res.status(400).json({ error: 'Phone number already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = db.prepare(
            'INSERT INTO users (phone, password, name, user_type, city) VALUES (?, ?, ?, ?, ?)'
        ).run(phone, hashedPassword, name, user_type, city);

        const userId = result.lastInsertRowid;

        if (user_type === 'driver') {
            db.prepare('INSERT INTO driver_profiles (user_id) VALUES (?)').run(userId);
        }

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

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid phone or password' });
        }

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

// Post a load (shipper only) - ENHANCED
app.post('/api/loads', (req, res) => {
    try {
        const {
            shipper_id,
            material_name,
            quantity_tons,
            title,
            description,
            cargo_type,
            other_cargo_desc,
            requires_permit,
            permit_details,
            health_hazard,
            hazard_details,
            pickup_region,
            pickup_district,
            pickup_ward,
            pickup_landmark,
            dropoff_region,
            dropoff_district,
            dropoff_ward,
            dropoff_landmark,
            truck_type_needed,
            rate_per_ton,
            total_price,
            pickup_date,
            pickup_time,
            return_load,
            return_date,
            return_destination,
            vat_exclusive
        } = req.body;

        const trackingNumber = generateTrackingNumber();

        const result = db.prepare(`
            INSERT INTO loads (
                shipper_id, tracking_number, material_name, quantity_tons, title, description,
                cargo_type, other_cargo_desc, requires_permit, permit_details,
                health_hazard, hazard_details,
                pickup_region, pickup_district, pickup_ward, pickup_landmark,
                dropoff_region, dropoff_district, dropoff_ward, dropoff_landmark,
                truck_type_needed, rate_per_ton, total_price, vat_exclusive,
                pickup_date, pickup_time, return_load, return_date, return_destination
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            shipper_id, trackingNumber, material_name, quantity_tons, title, description,
            cargo_type, other_cargo_desc || null,
            requires_permit ? 1 : 0, permit_details || null,
            health_hazard ? 1 : 0, hazard_details || null,
            pickup_region, pickup_district, pickup_ward || null, pickup_landmark || null,
            dropoff_region, dropoff_district, dropoff_ward || null, dropoff_landmark || null,
            truck_type_needed, rate_per_ton, total_price, vat_exclusive ? 1 : 0,
            pickup_date || null, pickup_time || null,
            return_load ? 1 : 0, return_date || null, return_destination || null
        );

        res.status(201).json({
            message: 'Load posted successfully',
            tracking_number: trackingNumber,
            load: { 
                id: result.lastInsertRowid, 
                tracking_number: trackingNumber,
                title,
                status: 'open'
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// Get all open loads (for drivers) - WITH LOCATION CONCATENATION
app.get('/api/loads', (req, res) => {
    try {
        const { shipper_id } = req.query;

        let query = `
            SELECT 
                loads.*, 
                users.name as shipper_name, 
                users.phone as shipper_phone,
                (loads.pickup_region || ', ' || loads.pickup_district || 
                 CASE WHEN loads.pickup_ward IS NOT NULL AND loads.pickup_ward != '' 
                      THEN ', ' || loads.pickup_ward 
                      ELSE '' END ||
                 CASE WHEN loads.pickup_landmark IS NOT NULL AND loads.pickup_landmark != '' 
                      THEN ' (' || loads.pickup_landmark || ')' 
                      ELSE '' END) as pickup_location,
                (loads.dropoff_region || ', ' || loads.dropoff_district || 
                 CASE WHEN loads.dropoff_ward IS NOT NULL AND loads.dropoff_ward != '' 
                      THEN ', ' || loads.dropoff_ward 
                      ELSE '' END ||
                 CASE WHEN loads.dropoff_landmark IS NOT NULL AND loads.dropoff_landmark != '' 
                      THEN ' (' || loads.dropoff_landmark || ')' 
                      ELSE '' END) as dropoff_location
            FROM loads 
            JOIN users ON loads.shipper_id = users.id 
        `;
        let params = [];

        if (shipper_id) {
            query += ' WHERE loads.shipper_id = ?';
            params.push(shipper_id);
        } else {
            query += " WHERE loads.status = 'open'";
        }

        query += ' ORDER BY loads.created_at DESC';

        const rows = db.prepare(query).all(...params);

        res.json({ loads: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single load by tracking number - WITH LOCATION CONCATENATION
app.get('/api/loads/track/:trackingNumber', (req, res) => {
    try {
        const { trackingNumber } = req.params;

        const load = db.prepare(`
            SELECT 
                loads.*, 
                users.name as shipper_name, 
                users.phone as shipper_phone,
                (loads.pickup_region || ', ' || loads.pickup_district || 
                 CASE WHEN loads.pickup_ward IS NOT NULL AND loads.pickup_ward != '' 
                      THEN ', ' || loads.pickup_ward 
                      ELSE '' END ||
                 CASE WHEN loads.pickup_landmark IS NOT NULL AND loads.pickup_landmark != '' 
                      THEN ' (' || loads.pickup_landmark || ')' 
                      ELSE '' END) as pickup_location,
                (loads.dropoff_region || ', ' || loads.dropoff_district || 
                 CASE WHEN loads.dropoff_ward IS NOT NULL AND loads.dropoff_ward != '' 
                      THEN ', ' || loads.dropoff_ward 
                      ELSE '' END ||
                 CASE WHEN loads.dropoff_landmark IS NOT NULL AND loads.dropoff_landmark != '' 
                      THEN ' (' || loads.dropoff_landmark || ')' 
                      ELSE '' END) as dropoff_location
            FROM loads 
            JOIN users ON loads.shipper_id = users.id 
            WHERE loads.tracking_number = ?
        `).get(trackingNumber);

        if (!load) {
            return res.status(404).json({ error: 'Load not found' });
        }

        res.json({ load });
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