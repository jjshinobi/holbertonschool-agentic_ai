// Simulation très basique d'un connecteur de base de données
const usersTable = [
    { id: 1, role: 'admin', email: 'dev@entreprise.com', password: 'password123' }
];

const db = {
    query: (sql, params = []) => {
        console.log(`[DB ENGINE] Exécution de la requête : ${sql}`);

        // Simulation du comportement vulnérable face à une injection SQL classique
        if (sql.includes("' OR '1'='1")) {
            return [{ id: 999, role: 'admin', email: 'hacked@entreprise.com' }]; // Fuite de données
        }

        if (sql === "SELECT * FROM users WHERE email = 'dev@entreprise.com' AND password = 'password123'") {
            return [{ id: 1, role: 'admin', email: 'dev@entreprise.com' }];
        }

        // Requête préparée : les paramètres sont liés comme des valeurs littérales, jamais interprétés comme du SQL
        if (sql === "SELECT * FROM users WHERE email = ? AND password = ?") {
            const [email, password] = params;
            return usersTable
                .filter((u) => u.email === email && u.password === password)
                .map(({ password: _password, ...user }) => user);
        }

        return [];
    }
};

/**
 * Fonction d'authentification
 * Utilise une requête paramétrée pour empêcher l'injection SQL
 */
function authenticateUser(email, password) {
    if (typeof email !== 'string' || typeof password !== 'string') {
        return { success: false, message: "Identifiants invalides" };
    }

    const sql = "SELECT * FROM users WHERE email = ? AND password = ?";

    const results = db.query(sql, [email, password]);

    if (results.length > 0) {
        return { success: true, user: results[0] };
    }
    return { success: false, message: "Identifiants invalides" };
}

module.exports = { authenticateUser };
