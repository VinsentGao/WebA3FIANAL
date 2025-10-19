const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',  // XAMPP 
    database: 'charityevents_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const promisePool = pool.promise();

async function testConnection() {
    try {
        const [rows] = await promisePool.query('SELECT 1 + 1 AS solution');
        console.log('Database connection successful!');
        return true;
    } catch (error) {
        console.error('Database connection failed:', error);
        return false;
    }
}

module.exports = {
    pool: promisePool,
    testConnection
};