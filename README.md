# Claude + Database Demo

A minimal example of a website that sends messages to Claude and logs each
exchange to a SQLite database.

## How it fits together

```
Browser (public/index.html)
   │  POST /api/chat { message }
   ▼
Express server (server.js)
   │  calls Anthropic API
   ▼
Claude ──reply──▶ server.js ──saves──▶ chat.db (SQLite, via db.js)
   │
   ▼
Browser shows the reply, and re-fetches /api/history to show the log
```

## Setup

1. **Install Node.js** (v18 or later) if you don't have it: https://nodejs.org

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Add your API key**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and paste in a real key from
   https://console.anthropic.com/settings/keys

4. **Run the server**
   ```bash
   npm start
   ```

5. **Open the site**
   Go to http://localhost:3000 in your browser. Type a message, hit Send —
   it calls Claude, shows the reply, and saves the exchange to `chat.db`
   (a file that appears in this folder the first time you run it).

## Poking at the database directly (optional)

If you have the `sqlite3` CLI installed:
```bash
sqlite3 chat.db "SELECT * FROM conversations;"
```

## Where to go from here

- Swap SQLite for Postgres/MySQL by changing `db.js` — the rest of the app
  doesn't need to change, since it only calls `saveConversation` and
  `getHistory`.
- Add a `system` prompt in `server.js`'s `anthropic.messages.create()` call
  to give Claude a persona or instructions.
- Add user accounts and a `user_id` column to scope history per person.
- Stream Claude's reply token-by-token instead of waiting for the full
  response (Anthropic SDK supports `.stream()`).
