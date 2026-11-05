# **0. The Challenge of Implicit Context and Architecture**

## Prompt

```
Role: You are a senior software engineer.
Context:
The project uses JavaScript (Node.js).
There is already @user.service.js and @user.repository.js impemented.
Task: Generate a new service which exports user data.
Constraints: Reproduce exactly the repository access pattern and the exception handling already used in the project's services.
Format: Return only the JavaScript code, with no narrative text.
```

## Files in context

- `src/services/user.service.js`
- `src/repositories/user.repository.js`

## Generated service

- Name: `ExportService`
- Path: `src/services/export.service.js`

## Existing architecture elements reused by AI

- **Layered structure:** the service lives in `src/services/` and gets its data only through the repository layer in `src/repositories/`. The repository was not modified.
- **Repository access pattern:** the repository is imported with `require('../repositories/user.repository')`, used as a shared singleton and called synchronously (`userRepository.findByEmail(email)`), exactly as in `UserService`.
- **Service shape:** a class with an `async` method, exported as a singleton via `module.exports = new ExportService();`, matching `UserService`.
- **Exception handling:** the result is checked right after the repository call, and the same plain `Error` with the same message (`"User not found in the system"`) is thrown when no user is found.
