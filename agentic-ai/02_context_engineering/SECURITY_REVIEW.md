# **1. Iterative Refactoring and Securing of an Injection Vulnerability**

## Prompt

```
Role: You are a senior software engineer and security expert.
Context:
The project uses JavaScript (Node.js).
The authentication is implemented in @agentic-ai/02_context_engineering/src/legacy_auth.js and is vulnurable to SQL injection.
Task: Fix the vulnurability using a prepared or parameterized query.
Constraints: Don't change the function signature or the return object on success.
Format: Return only the JavaScript code, with no narrative text.
```

## Identified vulnerability

- **Type:** SQL injection (CWE-89).
- **Location:** `authenticateUser(email, password)` in `src/legacy_auth.js`.
- **Cause:** the SQL query was built by concatenating raw user input into the string:
  ```javascript
  const sql = "SELECT * FROM users WHERE email = '" + email + "' AND password = '" + password + "'";
  ```
- **Impact:** an attacker can break out of the string literal and rewrite the query. With the email `admin@entreprise.com' OR '1'='1`, the `WHERE` clause becomes always true, so the login succeeds without a valid password and returns an admin account (authentication bypass and data leak).

## Changes proposed by the Agent

- **Parameterized query:** the query now uses placeholders, and the values are passed separately, so input is always treated as data and never as SQL:
  ```javascript
  const sql = "SELECT * FROM users WHERE email = ? AND password = ?";
  const results = db.query(sql, [email, password]);
  ```
- **Input type check:** `email` and `password` must be strings; otherwise the function returns the standard failure object.
- **Database mock updated:** `db.query(sql, params)` now accepts bound parameters and matches them as literal values against an in-memory `usersTable`, simulating how a real driver handles prepared statements. The password column is removed from the returned user.
- **Unchanged:** the function signature `authenticateUser(email, password)`, the success object `{ success: true, user }`, and the failure object `{ success: false, message: "Identifiants invalides" }`.

## Test results (`node test_security.js`)

### Before the fix

```
=== Starting security test suite (Task 2) ===

Test 1 : Legitimate connection...
[DB ENGINE] Exécution de la requête : SELECT * FROM users WHERE email = 'dev@entreprise.com' AND password = 'password123'
-> OK

Test 2 : SQL injection attempt...
[DB ENGINE] Exécution de la requête : SELECT * FROM users WHERE email = 'admin@entreprise.com' OR '1'='1' AND password = 'hack'
❌ FAILED: FAILLE CRITIQUE DÉTECTÉE : L'injection SQL a réussi ! Votre prompt IA n'a pas sécurisé la requête.

true !== false

-> Relaunch your Agent with better instructions to fix the flaw.
```

### After the fix

```
=== Starting security test suite (Task 2) ===

Test 1 : Legitimate connection...
[DB ENGINE] Exécution de la requête : SELECT * FROM users WHERE email = ? AND password = ?
-> OK

Test 2 : SQL injection attempt...
[DB ENGINE] Exécution de la requête : SELECT * FROM users WHERE email = ? AND password = ?
-> OK

✅ PASSED: The code has been properly secured by the AI ​​agent.
```
