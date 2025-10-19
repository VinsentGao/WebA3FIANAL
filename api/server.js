const express = require('express');
const cors = require('cors');
const { pool } = require('./event_db'); // testConnection 可选，API 不依赖它
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ========================
// 🔹 客户端 API（面向 public）
// ========================

// 获取首页活动（仅活跃 & 未来）
app.get('/api/events/home', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT e.*, c.name as category_name, o.name as organization_name
            FROM events e
            LEFT JOIN categories c ON e.category_id = c.id
            LEFT JOIN organizations o ON e.organization_id = o.id
            WHERE e.is_active = TRUE 
            AND e.event_date >= CURDATE()
            ORDER BY e.event_date ASC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Homepage API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 搜索活动（仅活跃）
app.get('/api/events/search', async (req, res) => {
    try {
        const { date, location, category } = req.query;
        let query = `
            SELECT e.*, c.name as category_name, o.name as organization_name
            FROM events e
            LEFT JOIN categories c ON e.category_id = c.id
            LEFT JOIN organizations o ON e.organization_id = o.id
            WHERE e.is_active = TRUE
        `;
        const params = [];
        if (date) {
            query += ' AND e.event_date = ?';
            params.push(date);
        }
        if (location) {
            query += ' AND e.location LIKE ?';
            params.push(`%${location}%`);
        }
        if (category) {
            query += ' AND c.name = ?';
            params.push(category);
        }
        query += ' ORDER BY e.event_date ASC';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Search API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 获取活动详情 + 注册列表（按 registration_date DESC）
app.get('/api/events/:id', async (req, res) => {
    try {
        const eventId = req.params.id;

        // 获取事件详情（允许查看非活跃事件，但通常客户端只访问活跃的）
        const [eventRows] = await pool.query(`
            SELECT e.*, c.name as category_name, o.name as organization_name
            FROM events e
            LEFT JOIN categories c ON e.category_id = c.id
            LEFT JOIN organizations o ON e.organization_id = o.id
            WHERE e.id = ?
        `, [eventId]);

        if (eventRows.length === 0) {
            return res.status(404).json({ error: 'Event not found' });
        }

        const event = eventRows[0];

        // 获取注册列表
        const [registrations] = await pool.query(`
            SELECT id, full_name, email, phone, ticket_count, registration_date
            FROM registrations
            WHERE event_id = ?
            ORDER BY registration_date DESC
        `, [eventId]);

        res.json({ ...event, registrations });
    } catch (error) {
        console.error('Event details API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 提交注册
app.post('/api/registrations', async (req, res) => {
    const { event_id, full_name, email, phone, ticket_count } = req.body;
    if (!event_id || !full_name || !email || !phone || ticket_count == null) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    try {
        const [result] = await pool.query(
            `INSERT INTO registrations (event_id, full_name, email, phone, ticket_count)
             VALUES (?, ?, ?, ?, ?)`,
            [event_id, full_name, email, phone, ticket_count]
        );
        res.status(201).json({ message: 'Registration successful', registration_id: result.insertId });
    } catch (error) {
        console.error('Registration API error:', error);
        res.status(500).json({ error: 'Failed to register' });
    }
});

// 获取所有分类（供搜索/表单使用）
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories ORDER BY name');
        res.json(rows);
    } catch (error) {
        console.error('Categories API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================
// 🔹 管理员 API（面向 admin）
// ========================

// 获取所有事件（含非活跃）—— 供 Admin 列表使用
app.get('/api/admin/events', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT e.*, c.name as category_name, o.name as organization_name
            FROM events e
            LEFT JOIN categories c ON e.category_id = c.id
            LEFT JOIN organizations o ON e.organization_id = o.id
            ORDER BY e.event_date ASC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Admin events API error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 创建新事件
app.post('/api/events', async (req, res) => {
    const {
        title, description, full_description, event_date, event_time,
        location, venue_details, category_id, organization_id,
        ticket_price, fundraising_goal, current_progress, is_active,
        image_url, latitude, longitude
    } = req.body;

    if (!title || !event_date || !location || !category_id || !organization_id) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const [result] = await pool.query(
            `INSERT INTO events (
                title, description, full_description, event_date, event_time,
                location, venue_details, category_id, organization_id,
                ticket_price, fundraising_goal, current_progress, is_active,
                image_url, latitude, longitude
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                title, description, full_description, event_date, event_time,
                location, venue_details, category_id, organization_id,
                ticket_price || null, fundraising_goal || null, current_progress || 0,
                is_active !== undefined ? is_active : 1,
                image_url || null, latitude || null, longitude || null
            ]
        );
        res.status(201).json({ message: 'Event created', event_id: result.insertId });
    } catch (error) {
        console.error('Create event error:', error);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

// 更新事件
app.put('/api/events/:id', async (req, res) => {
    const eventId = req.params.id;
    const {
        title, description, full_description, event_date, event_time,
        location, venue_details, category_id, organization_id,
        ticket_price, fundraising_goal, current_progress, is_active,
        image_url, latitude, longitude
    } = req.body;

    try {
        const [existing] = await pool.query('SELECT id FROM events WHERE id = ?', [eventId]);
        if (existing.length === 0) return res.status(404).json({ error: 'Event not found' });

        const [result] = await pool.query(
            `UPDATE events SET
                title = ?, description = ?, full_description = ?, event_date = ?, event_time = ?,
                location = ?, venue_details = ?, category_id = ?, organization_id = ?,
                ticket_price = ?, fundraising_goal = ?, current_progress = ?, is_active = ?,
                image_url = ?, latitude = ?, longitude = ?
            WHERE id = ?`,
            [
                title, description, full_description, event_date, event_time,
                location, venue_details, category_id, organization_id,
                ticket_price || null, fundraising_goal || null, current_progress || 0,
                is_active !== undefined ? is_active : 1,
                image_url || null, latitude || null, longitude || null,
                eventId
            ]
        );
        res.json({ message: 'Event updated successfully' });
    } catch (error) {
        console.error('Update event error:', error);
        res.status(500).json({ error: 'Failed to update event' });
    }
});

// 删除事件（检查注册）
app.delete('/api/events/:id', async (req, res) => {
    const eventId = req.params.id;
    try {
        const [registrations] = await pool.query(
            'SELECT id FROM registrations WHERE event_id = ? LIMIT 1',
            [eventId]
        );
        if (registrations.length > 0) {
            return res.status(400).json({
                error: 'Cannot delete event with existing registrations'
            });
        }
        const [result] = await pool.query('DELETE FROM events WHERE id = ?', [eventId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'Event deleted successfully' });
    } catch (error) {
        console.error('Delete event error:', error);
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

// ========================
// 启动服务器
// ========================
app.listen(PORT, () => {
    console.log(`🚀 API Server running on http://localhost:${PORT}`);
    console.log('✅ Available endpoints:');
    console.log('   GET    /api/events/home');
    console.log('   GET    /api/events/search');
    console.log('   GET    /api/events/:id');
    console.log('   POST   /api/registrations');
    console.log('   GET    /api/categories');
    console.log('   GET    /api/admin/events');
    console.log('   POST   /api/events');
    console.log('   PUT    /api/events/:id');
    console.log('   DELETE /api/events/:id');
});