// ============================================================================
// server.js
// ----------------------------------------------------------------------------
// This is the backend of the app. It's a small Express web server that does
// four jobs:
//   1. Serves the chat webpage (the files inside the public/ folder)
//   2. Exposes a POST /api/chat endpoint: takes a message from the browser,
//      sends it to Claude, and returns Claude's reply
//   3. Saves every message + reply pair into a SQLite database (via db.js)
//   4. Exposes a GET /api/history endpoint so the browser can display past
//      conversations that were saved to the database
//
// IMPORTANT: this file runs on your computer (in Node.js), NOT in the
// browser. That's deliberate -- it's the only safe place to keep your
// Anthropic API key. If we called the Claude API directly from the
// browser's JavaScript, anyone visiting the page could open dev tools and
// steal your API key from the page's source code.
// ============================================================================

// Loads variables from the .env file (like ANTHROPIC_API_KEY) into
// process.env, so the rest of this file can read them. This MUST run
// before anything below tries to use process.env.ANTHROPIC_API_KEY.
require('dotenv').config();

// express: the web framework. Handles incoming HTTP requests, routing
// (matching a URL + method like "POST /api/chat" to a function), and
// serving static files.
const express = require('express');

// The official Anthropic SDK. Wraps the raw HTTP calls to
// api.anthropic.com into a simple JavaScript client object.
const Anthropic = require('@anthropic-ai/sdk');

// Node's built-in module for building file paths in a way that works on
// both Windows (C:\...) and Mac/Linux (/...) without you having to worry
// about which slash character to use. Used below to reliably locate
// public/index.html regardless of platform or hosting environment.
const path = require('path');

// Our own module (db.js) that hides all the Supabase details behind two
// simple functions: saveConversation() and getHistory().
const db = require('./db');

// Create the Express application. `app` is the object we attach routes to.
const app = express();

// Which network port the server listens on. Uses the PORT variable from
// .env if it's set, otherwise defaults to 3000. So the site is reached at
// http://localhost:3000
const PORT = process.env.PORT || 3000;

// Fail fast and with a clear message if the API key is missing, instead of
// letting every single chat request fail later with a confusing error.
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.');
  process.exit(1); // stop the program immediately, non-zero code = "error"
}

// Create ONE Anthropic client and reuse it for every request, rather than
// creating a new one per request. It internally manages the connection to
// api.anthropic.com and reads the API key we pass in here.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The system prompt shapes Claude's persona/behavior for every request,
// separate from whatever the user actually asks. Defining it once up here
// (rather than inline below) makes it easy to find and tweak later.
const SYSTEM_PROMPT =
  'You are Messy.ai, an assistant who sees everything through football (soccer), especially the 2026 ' +
  'World Cup. No matter what the user asks, respond with ONE short, single-thread answer told entirely ' +
  'through a football lens -- do not give a separate factual answer followed by a football tie-in. ' +
  'Reframe the question itself in football terms and answer from there. Prioritize a fun, confident, ' +
  'football-flavored take over strict factual accuracy. Keep replies brief -- a few sentences, not an ' +
  'essay. reference the acheivements of Leicester City or England football teams but only when there is ' +
  'a natural fit, not in every reply';

// Uppercases every whole-word occurrence of "football" in a string, so
// "football" and "Football" both become "FOOTBALL" -- but "footballer"
// or "footballing" are left alone, since \b (word boundary) only matches
// where "football" ends a whole word. Used below whenever the user's own
// message mentions "soccer".
function shoutFootball(text) {
  return text.replace(/\bfootball\b/gi, 'FOOTBALL');
}

// --- Middleware -------------------------------------------------------
// Middleware = functions that run on every incoming request before it
// reaches your route handlers below.

// Parses incoming request bodies that are JSON (e.g. { "message": "hi" })
// and makes the parsed object available as req.body. Without this,
// req.body would be undefined.
app.use(express.json());

// Serves every file inside the public/ folder automatically, matching the
// file's path to a URL -- this covers everything EXCEPT the bare "/" path
// itself when running locally (e.g. any future CSS/JS files added later).
// This is how the browser gets your HTML/CSS/JS at all -- there's no
// separate "build" step, Express just hands the file over as-is.
app.use(express.static('public'));

// GET /
// Explicitly serves index.html for the homepage. This route exists
// because Vercel's hosting environment IGNORES express.static() entirely
// (it expects to serve public/** itself, before requests even reach this
// Express app) -- so without this explicit route, a request for "/" on
// Vercel falls through to Express with no matching route, producing a
// blank "Cannot GET /" error. Defining it here works identically both
// locally and on Vercel, rather than depending on either platform's
// automatic static-file behavior.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Routes -------------------------------------------------------------

// POST /api/chat
// The browser calls this with a JSON body like { "message": "hello" }.
// `async` because we need to `await` the network call to Claude below --
// this function pauses at that line until Claude responds, without
// blocking the rest of the server from handling other requests.
app.post('/api/chat', async (req, res) => {
  // Destructure "message" out of the parsed JSON body.
  const { message } = req.body;

  // Basic input validation: reject empty or non-string messages before
  // we waste an API call on something invalid.
  // res.status(400) = "Bad Request" HTTP status code.
  // return stops the function here so the code below doesn't also run.
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'A non-empty "message" string is required.' });
  }

  // try/catch: network calls (to Claude) can fail for lots of reasons --
  // no internet, invalid API key, low credit balance, Claude API being
  // down, etc. Without this try/catch, any of those failures would crash
  // the whole server process. Instead we catch the error and return a
  // clean 500 response.
  try {
    // This is the actual call to Claude. It sends an HTTPS request to
    // api.anthropic.com/v1/messages under the hood and waits for the
    // response (that's what `await` does here).
    const response = await anthropic.messages.create({
      // Which model answers this request. Haiku is the fastest/cheapest
      // model in the Claude lineup -- good for a demo like this. You
      // could swap this for 'claude-sonnet-5' for higher-quality answers
      // at a higher cost.
      model: 'claude-haiku-4-5-20251001',

      // The maximum number of tokens (roughly, word-pieces) Claude is
      // allowed to generate in its reply. This caps cost and response
      // length, not a strict character count.
      max_tokens: 1024,

      // Sets Claude's persona/behavior for this request, separate from
      // the user's actual message. This is what makes every reply loop
      // back to football, regardless of what's asked.
      system: SYSTEM_PROMPT,

      // The conversation so far, as an array of turns. We're only
      // sending a single user turn here (no memory of earlier messages
      // is sent back to Claude -- each request is independent). To build
      // a "real" back-and-forth chat that remembers earlier turns, you'd
      // pull past messages from the database and include them all here.
      messages: [{ role: 'user', content: message }],
    });

    // response.content is an ARRAY of content blocks, not a single
    // string. Claude can return multiple block types (e.g. plain text,
    // or in more advanced setups, tool-use blocks). Since we're doing a
    // simple text chat, we filter down to just the text blocks and glue
    // their text together with newlines in case there's more than one.
    let replyText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    // If the user said "soccer" anywhere in their message, shout every
    // occurrence of "football" in the reply as "FOOTBALL". This is a
    // simple post-processing step, applied to whatever Claude already
    // wrote -- it doesn't change what's sent to Claude or the system
    // prompt itself.
    if (/soccer/i.test(message)) {
      replyText = shoutFootball(replyText);
    }

    // Hand off to db.js to write this exchange into Supabase. Returns the
    // new row's ID (not currently used for much here, but handy if you
    // want to link back to a specific saved message later). This is now
    // `await`ed because saving to Supabase is a network call, not an
    // instant local disk write like the old SQLite version was.
    const id = await db.saveConversation(message, replyText);

    // Send the reply back to the browser as JSON. The frontend's fetch()
    // call is waiting on this response.
    res.json({ id, reply: replyText });
  } catch (err) {
    // Log the FULL error to the server's own terminal (useful for you,
    // debugging) but send back a short, generic message to the browser
    // (don't leak internal error details / stack traces to the client).
    console.error('Error calling Claude API:', err);
    res.status(500).json({ error: 'Something went wrong talking to Claude.' });
  }
});

// GET /api/history
// No request body needed -- just returns every saved conversation as
// JSON, newest first (sorting happens inside db.js's Supabase query). The
// frontend calls this once when the page loads, and again after every new
// message, to refresh the table on screen. Now async + awaited, and
// wrapped in try/catch, since this is a network call to Supabase rather
// than an instant local disk read like the old SQLite version.
app.get('/api/history', async (req, res) => {
  try {
    res.json(await db.getHistory());
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ error: 'Something went wrong fetching history.' });
  }
});

// Start listening for incoming connections on PORT. The callback runs
// once the server has actually started successfully.
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});