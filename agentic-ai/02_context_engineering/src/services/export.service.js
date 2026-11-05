const userRepository = require('../repositories/user.repository');

class ExportService {
    async exportUserData(email) {
        const user = userRepository.findByEmail(email);
        if (!user) {
            throw new Error("User not found in the system");
        }
        return JSON.stringify(user);
    }
}

module.exports = new ExportService();
