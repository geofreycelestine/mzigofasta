-- Users table (both shippers and drivers)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    user_type VARCHAR(20) CHECK (user_type IN ('shipper', 'driver')),
    city VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Drivers profile (extra details)
CREATE TABLE driver_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    truck_type VARCHAR(50),
    truck_capacity VARCHAR(20),
    license_number VARCHAR(50),
    is_verified BOOLEAN DEFAULT FALSE,
    current_location VARCHAR(100),
    is_available BOOLEAN DEFAULT TRUE
);

-- Loads table (cargo postings)
CREATE TABLE loads (
    id SERIAL PRIMARY KEY,
    shipper_id INTEGER REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    pickup_location VARCHAR(200) NOT NULL,
    dropoff_location VARCHAR(200) NOT NULL,
    cargo_type VARCHAR(50),
    weight_kg DECIMAL,
    truck_type_needed VARCHAR(50),
    price_offer DECIMAL,
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_transit', 'delivered', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Load assignments (matches)
CREATE TABLE assignments (
    id SERIAL PRIMARY KEY,
    load_id INTEGER REFERENCES loads(id),
    driver_id INTEGER REFERENCES users(id),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'completed'))
);