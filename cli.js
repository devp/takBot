#!/usr/bin/env node
// Interactive (or piped/scripted) CLI driver for acceptance-testing takBot
// without deploying to Discord. Reads commands and moves from stdin and
// drives commands/*.js and util.js directly via the sim/ fake-Discord
// adapter. Never calls util.createClient()/.login(), so no real Discord
// connection or timers are ever touched.
//
// Usage:
//   npm run cli
//   npm run cli -- --players alice,bob,carol
//   npm run cli -- --data-dir ./my-sandbox
//   node cli.js < scenario.txt   (scripted/non-interactive runs)
//
// Session grammar (one per line):
//   @alice                    switch the acting user to "alice" (created on first use)
//   /channel <name>           switch the active channel
//   /<command> key=value ...  dispatch a slash command (value "@bob" resolves to a user)
//   <ply text>                anything else is tried as a move, e.g. "a1", "Sd4"
//   /quit                     exit

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

function parseArgs(argv) {
  const args = { players: ["alice", "bob"], dataDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--players" && argv[i + 1]) {
      args.players = argv[++i].split(",").map((s) => s.trim());
    } else if (argv[i] === "--data-dir" && argv[i + 1]) {
      args.dataDir = argv[++i];
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const dataDir =
  args.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "takbot-cli-"));
fs.mkdirSync(dataDir, { recursive: true });
process.env.TAKBOT_DATA_DIR = dataDir;

// Seed results.db with the header line, matching the manual setup step in
// README.md ("cp results.db.template results.db") — without it,
// getHistoryFromFile() treats the first real game as the header row.
const resultsDbPath = path.join(dataDir, "results.db");
if (!fs.existsSync(resultsDbPath)) {
  const template = path.join(__dirname, "results.db.template");
  if (fs.existsSync(template)) {
    fs.copyFileSync(template, resultsDbPath);
  }
}

const util = require("./util");
const { loadCommands } = require("./sim/commandRegistry");
const {
  createFakeUser,
  createFakeChannel,
  createFakeMessage,
  createFakeInteraction,
  createFakeClient,
  createOptions,
} = require("./sim/fakeDiscord");

// util.js always calls its own exports via module.exports.setTimer(...)
// (never a closured reference), so reassigning it here silences the
// "Channel not found" console noise setTimer logs every time, since
// util.createClient() is never called and the module-private `client`
// stays undefined.
util.setTimer = async () => false;

const commands = loadCommands();
const fakeClient = createFakeClient();

const renderDir = path.join(dataDir, "renders");
fs.mkdirSync(renderDir, { recursive: true });

const users = new Map();
for (const name of args.players) {
  users.set(name, createFakeUser({ username: name, displayName: name }));
}

const channels = new Map();
const lobby = createFakeChannel({ name: "lobby" });
channels.set(lobby.name, lobby);
channels.set(lobby.id, lobby);

let currentUserName = args.players[0];
let currentChannelName = lobby.name;

function getOrCreateUser(name) {
  if (!users.has(name)) {
    users.set(name, createFakeUser({ username: name, displayName: name }));
  }
  return users.get(name);
}

function currentUser() {
  return getOrCreateUser(currentUserName);
}

function currentChannel() {
  return channels.get(currentChannelName);
}

function registerChannel(channel) {
  channels.set(channel.name, channel);
  channels.set(channel.id, channel);
}

function saveAttachment(file) {
  try {
    const buffer = file.attachment;
    if (!buffer) return null;
    const filename = file.name || `${Date.now()}.png`;
    const outPath = path.join(renderDir, filename);
    fs.writeFileSync(outPath, buffer);
    return outPath;
  } catch (err) {
    console.error("(failed to save attachment:", err.message, ")");
    return null;
  }
}

function printMessage(channel, message, label) {
  if (!message) return;
  const prefix = `[#${channel.name}]${label ? ` ${label}` : ""}`;
  if (message.content) {
    console.log(`${prefix} ${message.content}`);
  }
  for (const file of message.files || []) {
    const savedPath = saveAttachment(file);
    if (savedPath) {
      console.log(`${prefix} (saved image: ${savedPath})`);
    }
  }
}

// Watches a channel's `sent` array and any interaction reply for new
// messages produced while running one command/move, so we can print them
// without the fake adapter itself needing to know about stdout.
function withOutputCapture(channel, fn) {
  const before = channel.sent.length;
  const threadsBefore = channel.createdThreads.length;
  return Promise.resolve(fn()).then((interactionReply) => {
    for (let i = before; i < channel.sent.length; i++) {
      printMessage(channel, channel.sent[i]);
    }
    if (interactionReply) {
      printMessage(channel, interactionReply, "(reply)");
    }
    if (channel.createdThreads.length > threadsBefore) {
      const thread = channel.createdThreads[channel.createdThreads.length - 1];
      registerChannel(thread);
      currentChannelName = thread.name;
      console.log(
        `[new thread created: ${thread.name} — now active channel]`
      );
    }
  });
}

function tokenize(line) {
  const tokens = [];
  const re = /(?:[^\s"]+|"[^"]*")+/g;
  let match;
  while ((match = re.exec(line))) {
    tokens.push(match[0]);
  }
  return tokens;
}

function coerceValue(raw) {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    raw = raw.slice(1, -1);
  }
  if (raw.startsWith("@")) {
    return getOrCreateUser(raw.slice(1));
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function parseOptions(tokens) {
  const values = {};
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq === -1) continue;
    const key = token.slice(0, eq);
    values[key] = coerceValue(token.slice(eq + 1));
  }
  return values;
}

async function dispatchCommand(line) {
  const tokens = tokenize(line.trim());
  const commandName = tokens[0].slice(1);
  const command = commands.get(commandName);
  if (!command) {
    console.log(`(unknown command: /${commandName})`);
    return;
  }
  const options = createOptions(parseOptions(tokens.slice(1)));
  const channel = currentChannel();
  const interaction = createFakeInteraction({
    commandName,
    member: currentUser(),
    channel,
    options,
  });
  await withOutputCapture(channel, async () => {
    await command.execute(interaction, fakeClient);
    return interaction._lastReply;
  });
}

async function handlePly(line) {
  if (!util.validPly(line)) {
    console.log(`(not a recognized command or move: ${line})`);
    return;
  }
  const channel = currentChannel();
  const message = createFakeMessage({
    content: line,
    author: currentUser(),
    channel,
  });
  await withOutputCapture(channel, () => util.handleMove(message, line));
}

async function handleLine(rawLine) {
  const line = rawLine.trim();
  if (!line) return;

  if (line === "/quit" || line === "/exit") {
    rl.close();
    return;
  }

  if (line.startsWith("@") && !line.includes(" ")) {
    currentUserName = line.slice(1);
    getOrCreateUser(currentUserName);
    console.log(`(acting as ${currentUserName})`);
    return;
  }

  if (line.startsWith("/channel ")) {
    const name = line.slice("/channel ".length).trim();
    if (channels.has(name)) {
      currentChannelName = channels.get(name).name;
      console.log(`(active channel: ${currentChannelName})`);
    } else {
      console.log(`(unknown channel: ${name})`);
    }
    return;
  }

  if (line.startsWith("/")) {
    await dispatchCommand(line);
    return;
  }

  await handlePly(line);
}

console.log(`takBot CLI driver`);
console.log(`Sandbox data directory: ${dataDir}`);
console.log(`Real data/, ptn/, results.db are untouched.`);
console.log(`Players: ${args.players.join(", ")} (acting as ${currentUserName})`);
console.log(`Active channel: ${currentChannelName}`);
console.log(
  `Type "@<name>" to switch user, "/<command> key=value ..." to run a command, a move to play it, or "/quit" to exit.`
);

const rl = readline.createInterface({ input: process.stdin });

// Lines are chained onto one queue (rather than paused/resumed) so piped,
// non-interactive input (e.g. `node cli.js < scenario.txt`) is processed
// strictly in order and fully drains before the process exits.
let queue = Promise.resolve();

rl.on("line", (line) => {
  queue = queue
    .then(() => handleLine(line))
    .catch((err) => console.error("(error)", err));
});

rl.on("close", () => {
  queue.finally(() => process.exit(0));
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});
