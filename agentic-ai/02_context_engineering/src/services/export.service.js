const userRepository = require('../repositories/user.repository');

class ExportService {
    async exportAllUserProfiles() {
        const users = userRepository.findAll();
        if (!users || users.length === 0) {
            throw new Error("No users found in the system");
        }
        return users;
    }
}

module.exports = new ExportService();
