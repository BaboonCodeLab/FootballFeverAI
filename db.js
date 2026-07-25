// ============================================================================
// db.js
// ----------------------------------------------------------------------------
// This file is the ONLY place in the project that talks directly to the
// database. Everything else (server.js) just calls the two functions
// exported at the bottom -- saveConversation() and getHistory() -- without
// needing to know any SQL/Supabase details. This separation is what let us
// swap the database engine (SQLite -> Postgres via Supabase) by rewriting
// only this file, with server.js barely changing.
//
// WHY WE MOVED OFF SQLITE:
// The old version used node:sqlite, which stores everything in a single
// chat.db FILE on disk. That works great locally, but breaks on serverless
// hosts like Vercel: every request can run on a fresh, mostly read-only
// filesystem, so a local file either can't be written to, or silently
// resets between requests. Supabase gives us a real, persistent Postgres
// database that lives on Supabase's servers, not on whatever machine
// happens to run our code -- so it survives serverless's "no persistent
// disk" model.
// ============================================================================

// The official Supabase JS client. Wraps HTTPS calls to your Supabase
// project into a simple JavaScript client object, similar in spirit to how
// the Anthropic SDK wraps calls to api.anthropic.com.
const { createClient } = require('@supabase/supabase-js');

// Fail fast if the required environment variables are missing, same
// philosophy as the ANTHROPIC_API_KEY check in server.js -- better to
// crash immediately with a clear message than have every request fail
// later with a confusing error.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY. Check your .env file (see .env.example).');
  process.exit(1);
}

// Create ONE Supabase client and reuse it for every request, rather than
// creating a new one per request -- same pattern as the Anthropic client
// in server.js.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// NOTE: unlike the old db.js, there's no db.exec(...) here to create the
// table automatically. Supabase doesn't let app code run arbitrary schema-
// changing SQL over its normal API for safety reasons -- so the
// `conversations` table needs to be created ONCE, manually, via the
// Supabase dashboard's SQL editor. See the migration notes for the exact
// SQL to run there (it mirrors the old CREATE TABLE statement).

// module.exports defines what other files get when they do
// require('./db'). We only expose these two functions -- server.js never
// sees the raw `supabase` client or writes any SQL itself.
//
// IMPORTANT CHANGE FROM THE SQLITE VERSION: both functions are now async
// and return Promises, because talking to Supabase is a network call
// (like the Anthropic API call), not an instant local disk read. Callers
// in server.js need to `await` these now.
module.exports = {
  // Saves one exchange (the user's message + Claude's reply) as a new
  // row. .insert() sends an INSERT over HTTPS to Supabase. .select() asks
  // Supabase to hand back the row it just created (including its
  // auto-generated id), and .single() unwraps that from an array of one
  // row into a plain object.
  async saveConversation(userMessage, claudeReply) {
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_message: userMessage, claude_reply: claudeReply })
      .select()
      .single();

    if (error) throw error; // let server.js's existing try/catch handle it

    return data.id;
  },

  // Returns every saved conversation as a plain JavaScript array of
  // objects, e.g. [{ id: 3, user_message: '...', claude_reply: '...',
  // created_at: '...' }, ...] -- same shape as before, so index.html's
  // loadHistory() doesn't need any changes at all.
  async getHistory() {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, user_message, claude_reply, created_at')
      .order('id', { ascending: false });

    if (error) throw error;

    return data;
  },
};