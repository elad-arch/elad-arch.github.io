// api/save-data.js

export default async function handler(request, response) {
    // 1. קבל את המפתחות הסודיים
    const { JSONBIN_MASTER_KEY, JSONBIN_BIN_ID } = process.env;
    const BIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

    // 2. קבל את המידע המוצפן שהדפדפן שלח
    const encryptedData = request.body; 

    try {
        // 3. שלח את המידע ל-JSONbin מהשרת המאובטח
        const apiResponse = await fetch(BIN_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_MASTER_KEY // המפתח הסודי נשאר כאן בשרת!
            },
            body: JSON.stringify(encryptedData) 
        });

        if (!apiResponse.ok) {
            throw new Error('Failed to save data to JSONbin');
        }

        // 4. החזר תשובת הצלחה לדפדפן
        response.status(200).json({ message: 'Data saved successfully' });

    } catch (error) {
        // 5. החזר תשובת שגיאה לדפדפן
        response.status(500).json({ error: error.message });
    }
}