# **0. The Challenge of Implicit Context and Architecture**

## Prompt

```
Role: You are a senior software engineer.
Context:
The project uses JavaScript (Node.js).
There is already @user.service.js and @user.repository.js impemented.
Task: Generate a new service which exports all user profiles.
Constraints: Reproduce exactly the repository access pattern and the exception handling already used in the project's services.
Format: Return only the JavaScript code, with no narrative text.
```

## Files in context

- `src/services/user.service.js`
- `src/repositories/user.repository.js`

## Generated service

- Name: `ExportService`
- Path: `src/services/export.service.js`
- Method: `exportAllUserProfiles()`

Supporting change: a `findAll()` method was added to `src/repositories/user.repository.js`, because the repository only exposed `findByEmail(email)` and the service must not read the repository's internal `db` directly.

## Existing architecture elements reused by AI

- **Layered structure:** the service lives in `src/services/` and gets its data only through the repository layer in `src/repositories/`.
- **Repository access pattern:** the repository is imported with `require('../repositories/user.repository')` and used as a shared singleton, called synchronously (`userRepository.findAll()`), just as `UserService` calls `userRepository.findByEmail(email)`.
- **Service shape:** a class with `async` methods, exported as a singleton via `module.exports = new ExportService();`, matching `UserService`.
- **Exception handling:** the result is checked right after the repository call, and a plain `Error` with a descriptive message is thrown when there is no data (`"No users found in the system"`), mirroring `"User not found in the system"` in `UserService`.
- **Repository conventions:** `findAll()` follows the style of `findByEmail()`, with data read from the in-memory `Map`.
