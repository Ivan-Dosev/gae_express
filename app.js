const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose(); // Using SQLite3
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const PORT = 5001;

// Enable CORS for specific origins
app.use(cors({
    origin: ['https://play.thedrop.top', 'https://www.play.thedrop.top', 'https://thedrop.top', 'https://server.thedrop.top', 'http://localhost:3000'],
    methods: ['GET', 'POST'], // Specify allowed methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Specify allowed headers
    credentials: true // Allows cookies and credentials if needed
}));

// // Optional: Custom middleware to log and ensure CORS headers
// app.use((req, res, next) => {
//     res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
//     res.setHeader('Access-Control-Allow-Methods', 'GET,POST');
//     res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
//     res.setHeader('Access-Control-Allow-Credentials', 'true'); // Allows cookies if required
//     next();
// });

const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minutes
    max: 50, // Limit each IP to 2 requests per `window` (1 minutes)
    message: 'Too many requests from this IP, please try again later.',
});

// Middleware
app.use(bodyParser.json());
app.use(limiter);

const isValidWallet = (wallet) => {
    const walletRegex = /^[A-Za-z0-9_]+$/;  // Allows letters, numbers, underscores, and dashes
    return walletRegex.test(wallet);
};

// Create or open SQLite database
const db = new sqlite3.Database('./pointsData.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        
        // Create the points table if it doesn't exist
        db.run(`
            CREATE TABLE IF NOT EXISTS points (
                wallet TEXT PRIMARY KEY,
                points INTEGER DEFAULT 0
            )
        `);

        // Create a table for storing one-time tokens (nonces)
        db.run(`
            CREATE TABLE IF NOT EXISTS game_sessions (
                wallet TEXT PRIMARY KEY,
                nonce TEXT NOT NULL,
                used INTEGER DEFAULT 0
            )
        `);
    }
});

// Endpoint to generate a one-time nonce after the game finishes
app.post('/api/generateNonce', (req, res) => {
    const { wallet } = req.body;
    console.log('Received wallet:', wallet);

    // if (!wallet || !isValidWallet(wallet)) {
    //     console.error('Invalid wallet address:', wallet);
    //     return res.status(400).json({ message: 'Invalid wallet address.' });
    // }

    const nonce = crypto.randomBytes(16).toString('hex');

    db.run('INSERT OR REPLACE INTO game_sessions (wallet, nonce, used) VALUES (?, ?, 0)', [wallet, nonce], (err) => {
        if (err) {
            console.error('Error generating nonce:', err.message);
            return res.status(500).json({ message: 'Error generating nonce' });
        }

        res.json({ nonce });
    });
});

app.post('/api/savePoints', (req, res) => {
    const { wallet, nonce } = req.body;
    console.log(`Received request to save points for wallet: ${wallet}`);

    const points = 1000000;

    // Validate the nonce - make sure it exists and hasn’t been used
    db.get('SELECT * FROM game_sessions WHERE wallet = ? AND nonce = ? AND used = 0', [wallet, nonce], (err, row) => {
        if (err) {
            console.error('Database error while fetching nonce:', err.message);
            return res.status(500).json({ message: 'Error fetching data' });
        }

        if (!row) {
            console.warn('Invalid or already used nonce for wallet:', wallet);
            return res.status(400).json({ message: 'Invalid or already used nonce' });
        }

        // Mark the nonce as used to prevent reuse
        db.run('UPDATE game_sessions SET used = 1 WHERE wallet = ?', [wallet], (err) => {
            if (err) {
                console.error('Error marking nonce as used:', err.message);
                return res.status(500).json({ message: 'Error updating nonce' });
            }

            // Now update or insert points for the wallet
            db.get('SELECT * FROM points WHERE wallet = ?', [wallet], (err, row) => {
                if (err) {
                    console.error('Error fetching points for wallet:', wallet, err.message);
                    return res.status(500).json({ message: 'Error fetching points' });
                }

                if (row) {
                    console.log(`Updating points for existing wallet: ${wallet}`);
                    // Wallet exists, update points
                    db.run('UPDATE points SET points = points + ? WHERE wallet = ?', [points, wallet], (err) => {
                        if (err) {
                            console.error('Error updating points for wallet:', wallet, err.message);
                            return res.status(500).json({ message: 'Error updating points' });
                        }
                        console.log(`1M points successfully added for wallet: ${wallet}`);
                        res.json({ message: '1M points added successfully' });
                    });
                } else {
                    console.log(`Inserting new wallet: ${wallet}`);
                    // Wallet does not exist, insert a new row
                    db.run('INSERT INTO points (wallet, points) VALUES (?, ?)', [wallet, points], (err) => {
                        if (err) {
                            console.error('Error inserting new wallet:', wallet, err.message);
                            return res.status(500).json({ message: 'Error saving points' });
                        }
                        console.log(`1M points successfully saved for new wallet: ${wallet}`);
                        res.json({ message: '1M points saved successfully' });
                    });
                }
            });
        });
    });
});

// Endpoint to get all points
app.get('/api/getPoints', (req, res) => {
    db.all('SELECT * FROM points', (err, rows) => {
        if (err) {
            res.status(500).json({ message: 'Error retrieving data' });
            console.error(err.message);
        } else {
            res.json(rows);
        }
    });
});

// Endpoint to get top 10 wallets by points
app.get('/api/top10', (req, res) => {
    db.all('SELECT * FROM points ORDER BY points DESC LIMIT 10', (err, rows) => {
        if (err) {
            res.status(500).json({ message: 'Error retrieving top 10 results' });
            console.error('Error retrieving top 10 results:', err.message);
        } else {
            console.log('Top 10 wallets:', rows); // Log top 10 results
            res.json(rows);
        }
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});