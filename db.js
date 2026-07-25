// ============================================================================
// db.js
// ----------------------------------------------------------------------------
// This file is the ONLY place in the project that talks directly to the
// database. Everything else (server.js) just calls the two functions
// exported at the bottom -- saveConversation() and getHistory() -- without
// needing to know any SQL. This separation means you could later swap
// SQLite for Postgres/MySQL by rewriting only this file.
//
// We use `node:sqlite`, a database engine built directly into Node.js
// (available from Node v22.5+). It stores everything in a single file
// (chat.db) on disk -- no separate database server to install or run,
// which is why this is a good fit for a small demo.
// ============================================================================

// DatabaseSync = the built-in Node module for working with a SQLite
// database file synchronously (no async/await needed for these calls --
// they're fast, local disk reads/writes, not network calls).
const { DatabaseSync } = require('node:sqlite');

// Node's built-in module for building file paths in a way that works on
// both Windows (C:\...) and Mac/Linux (/...) without you having to worry
// about which slash character to use.
const path = require('path');

// Opens (or creates, if it doesn't exist yet) a file called chat.db in
// the same folder as this script (__dirname = "this file's own
// directory"). This single line is the entire "connection" step --
// there's no separate server to connect to.
const db = new DatabaseSync(path.join(__dirname, 'chat.db'));

// Runs a raw SQL command immediately (not something we call repeatedly,
// so no need for a prepared statement here). This creates the table
// that will hold every chat exchange, but ONLY if it doesn't already
// exist -- so it's safe to run this every time the server starts without
// wiping existing data.
//
// Columns:
//   id            - auto-incrementing unique number for each row
//   user_message  - what the person typed
//   claude_reply  - what Claude answered
//   created_at    - timestamp, automatically set to "now" if not provided
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_message TEXT NOT NULL,
    claude_reply TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// --- Prepared statements -------------------------------------------------
// db.prepare() compiles a piece of SQL ONCE, ahead of time, with `?`
// placeholders standing in for values we'll supply later. We do this
// once here (outside any function) and reuse the same prepared statement
// every time someone chats, rather than re-compiling the SQL on every
// call -- it's both faster and safer.
//
// The safety part matters: if we instead built a SQL string by pasting
// user input directly in (e.g. via string concatenation or template
// literals), a malicious message could contain SQL code that manipulates
// or destroys the database -- this is called a SQL injection attack.
// Using `?` placeholders and passing values separately (see .run() calls
// below) means the database always treats those values as plain data,
// never as executable SQL, no matter what the user types.

// Statement for adding one new row.
const insertConversation = db.prepare(`
  INSERT INTO conversations (user_message, claude_reply)
  VALUES (?, ?)
`);

// Statement for reading every row back out, most recent first.
const getAllConversations = db.prepare(`
  SELECT id, user_message, claude_reply, created_at
  FROM conversations
  ORDER BY id DESC
`);

// module.exports defines what other files get when they do
// require('./db'). We only expose these two functions -- server.js never
// sees the raw `db` object or writes any SQL itself.
module.exports = {
  // Saves one exchange (the user's message + Claude's reply) as a new
  // row. .run(...) executes the prepared INSERT statement, substituting
  // the two arguments here for the two `?` placeholders in order.
  saveConversation(userMessage, claudeReply) {
    const result = insertConversation.run(userMessage, claudeReply);
    // result.lastInsertRowid is the auto-generated `id` of the row we
    // just created -- handy if a caller wants to reference this exact
    // saved message later.
    return result.lastInsertRowid;
  },

  // Returns every saved conversation as a plain JavaScript array of
  // objects, e.g. [{ id: 3, user_message: '...', claude_reply: '...',
  // created_at: '...' }, ...]. .all() runs the SELECT and collects every
  // matching row (as opposed to .get(), which would return just the
  // first one).
  getHistory() {
    return getAllConversations.all();
  },
};
