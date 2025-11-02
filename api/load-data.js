// api/load-data.js

export default async function handler(request, response) {
    // 1. קבל את המפתחות הסודיים (ששמרת ב-Vercel, לא מהקוד)
    const { JSONBIN_MASTER_KEY, JSONBIN_BIN_ID } = process.env;
    const BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

    try {
        // 2. פנה ל-JSONbin מהשרת המאובטח של Vercel
        const apiResponse = await fetch(`${BIN_URL}/latest`, {
            method: 'GET',
            headers: {
                'X-Master-Key': JSONBIN_MASTER_KEY // המפתח הסודי נשאר כאן בשרת!
            }
        });

        if (!apiResponse.ok) {
            throw new Error('Failed to fetch data from JSONbin');
        }

        const cloudData = await apiResponse.json();

        // 3. שלח את המידע בחזרה לדפדפן שלך
        response.status(200).json(cloudData);

    } catch (error) {
        response.status(500).json({ error: error.message });
    }
}