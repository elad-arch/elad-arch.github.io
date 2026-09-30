// api/data.js
// נקודת קצה אחת לטעינה (GET) ושמירה (POST) של הנתונים המוצפנים.
//
// מבנה הרשומה ב-JSONbin:
//   { data: <מחרוזת מוצפנת>, authHash: <sha256 של טוקן הגישה>, version: <מספר> }
//
// אבטחה:
// - כל בקשה חייבת לכלול "Authorization: Bearer <טוקן>". הטוקן נגזר בדפדפן מהסיסמה,
//   והשרת שומר רק hash שלו. השמירה הראשונה "נועלת" את המאגר לסיסמה הזו.
// - שמירה חייבת לציין baseVersion. אם מישהו שמר בינתיים ממכשיר אחר, השמירה נדחית (409)
//   כדי לא לדרוס את השינויים שלו.

import crypto from 'crypto';

const MAX_BODY_CHARS = 4 * 1024 * 1024; // מגבלת גוף הבקשה של Vercel היא 4.5MB

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function getToken(request) {
    const header = request.headers.authorization || '';
    const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/);
    return match ? match[1] : null;
}

async function readRecord(binUrl, masterKey) {
    const apiResponse = await fetch(`${binUrl}/latest`, {
        headers: { 'X-Master-Key': masterKey, 'X-Bin-Meta': 'false' }
    });
    if (!apiResponse.ok) throw new Error('Failed to fetch data from JSONbin');
    const record = await apiResponse.json();
    return (record && typeof record === 'object') ? record : {};
}

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    if (request.method !== 'GET' && request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const { JSONBIN_MASTER_KEY, JSONBIN_BIN_ID } = process.env;
    if (!JSONBIN_MASTER_KEY || !JSONBIN_BIN_ID) {
        return response.status(500).json({ error: 'Server is not configured' });
    }
    const BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

    const token = getToken(request);
    if (!token) {
        return response.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const record = await readRecord(BIN_URL, JSONBIN_MASTER_KEY);

        // אם המאגר כבר נעול - הטוקן חייב להתאים
        if (record.authHash && !safeEqual(record.authHash, sha256(token))) {
            return response.status(401).json({ error: 'Unauthorized' });
        }

        const currentVersion = typeof record.version === 'number' ? record.version : null;

        if (request.method === 'GET') {
            return response.status(200).json({
                data: record.data || null,
                version: currentVersion
            });
        }

        // --- POST: שמירה ---
        const body = request.body;
        if (!body || typeof body !== 'object' || typeof body.data !== 'string' || body.data.length === 0) {
            return response.status(400).json({ error: 'Invalid body' });
        }
        if (body.data.length > MAX_BODY_CHARS) {
            return response.status(413).json({ error: 'Data too large' });
        }
        const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : null;
        if (baseVersion !== currentVersion) {
            return response.status(409).json({ error: 'Conflict', version: currentVersion });
        }

        const newVersion = Math.max(Date.now(), (currentVersion || 0) + 1);
        const apiResponse = await fetch(BIN_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_MASTER_KEY
            },
            body: JSON.stringify({
                data: body.data,
                authHash: record.authHash || sha256(token),
                version: newVersion
            })
        });
        if (!apiResponse.ok) throw new Error('Failed to save data to JSONbin');

        return response.status(200).json({ version: newVersion });
    } catch (error) {
        console.error(error);
        return response.status(502).json({ error: 'Storage error' });
    }
}
