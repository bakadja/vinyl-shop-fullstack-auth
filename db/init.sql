-- Local demo database: catalogue only, no accounts or cart data.
BEGIN TRANSACTION;

CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT NOT NULL,
    year INTEGER,
    genre TEXT,
    stock INTEGER
);

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Fictional album metadata; IDs and image paths preserve the existing catalogue.
INSERT INTO products (id, title, artist, price, image, year, genre, stock) VALUES
    (1, 'Selling Dogma', 'The Clouds', 44.99, 'vinyl1.png', 2003, 'rock', 12),
    (2, 'Echoes in Transit', 'Silver Meadow', 38.59, 'vinyl2.png', 2012, 'indie', 12),
    (3, 'Midnight Parallels', 'Neon Grove', 40.99, 'vinyl3.png', 2020, 'ambient', 12),
    (4, 'Paper Skies', 'The Ivory Youth', 42.45, 'vinyl4.png', 2010, 'rock', 12),
    (5, 'Lost Cartography', 'Atlas Hills', 39.99, 'vinyl5.png', 2007, 'folk', 12),
    (6, 'Seaside Reflections', 'Drifted Pines', 41.59, 'vinyl6.png', 2015, 'ambient', 12),
    (7, 'Quiet Wars', 'Northern Glow', 37.66, 'vinyl7.png', 2009, 'indie', 12),
    (8, 'Blossom and Rust', 'Faded Echoes', 45.99, 'vinyl8.png', 2017, 'indie', 12),
    (9, 'Broken Glow', 'Static Empire', 43.99, 'vinyl9.png', 2014, 'punk', 12),
    (10, 'Dreams of Glass', 'Wild Lanterns', 46.69, 'vinyl10.png', 2019, 'indie', 12);

COMMIT;
