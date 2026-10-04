// Integration tests for util.handleMove(), the entry point bot.js's
// MessageCreate handler uses for plain-text move input (bot.js:116-126).
// Games are seeded through the real tak.js command flow (via
// sim/fakeDiscord) rather than hand-built TPS strings, since constructing a
// valid board-with-connectivity TPS by hand is fragile against TPS-Ninja's
// internals.

const test = require("node:test");
const { beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const util = require("../util");
const takCommand = require("../commands/tak");
const { withTempDataDir, seedResultsDb } = require("./test-helpers");
const {
  createFakeUser,
  createFakeChannel,
  createFakeMessage,
  createFakeInteraction,
  createFakeClient,
  createOptions,
} = require("../sim/fakeDiscord");

// See test/commands.tak.test.js for why this is needed.
util.setTimer = async () => false;

let tmp;

beforeEach(() => {
  tmp = withTempDataDir();
});

afterEach(() => {
  tmp.restore();
});

async function startGame({ size = 4, opening = "no-swap" } = {}) {
  const alice = createFakeUser({ username: "alice", displayName: "Alice" });
  const bob = createFakeUser({ username: "bob", displayName: "Bob" });
  const lobby = createFakeChannel({ name: "lobby" });
  const client = createFakeClient();

  const interaction = createFakeInteraction({
    commandName: "tak",
    member: alice,
    channel: lobby,
    options: createOptions({ opponent: bob, size, opening, color: 1 }),
  });
  await takCommand.execute(interaction, client);

  const thread = lobby.createdThreads[0];
  return { alice, bob, thread };
}

async function play(thread, user, ply) {
  const message = createFakeMessage({ content: ply, author: user, channel: thread });
  await util.handleMove(message, ply);
}

test("handleMove: a valid move updates game state and announces the next turn", async () => {
  const { alice, bob, thread } = await startGame();

  await play(thread, alice, "a1");

  assert.equal(thread.sent.length, 2);
  const reply = thread.sent[1];
  assert.match(reply.content, new RegExp(`<@${bob.id}>`));
  assert.equal(reply.files.length, 1);

  const gameData = util.getGameData({ channel: thread });
  assert.equal(gameData.turnMarker, "2");
  assert.equal(gameData.hl, "a1");
});

test("handleMove: an invalid move is rejected without changing state", async () => {
  const { alice, thread } = await startGame();

  const before = util.getGameData({ channel: thread });
  await play(thread, alice, "zz9");

  const lastSent = thread.sent[thread.sent.length - 1];
  assert.equal(lastSent.content, "Invalid move.");

  const after = util.getGameData({ channel: thread });
  assert.equal(after.tps, before.tps);
});

test("handleMove: a move made out of turn is rejected", async () => {
  // color:1 in startGame() makes alice player1, so turn 1 belongs to alice.
  const { bob, thread } = await startGame();

  await play(thread, bob, "a1");

  const lastSent = thread.sent[thread.sent.length - 1];
  assert.equal(lastSent.content, "You are not the active player.");
});

test("handleMove: a road-win move ends the game, records history, pins, and renames the channel", async () => {
  seedResultsDb(tmp.dir);
  const { alice, bob, thread } = await startGame({ size: 3 });

  await play(thread, alice, "a1");
  await play(thread, bob, "a2");
  await play(thread, alice, "b1");
  await play(thread, bob, "b2");
  await play(thread, alice, "c1"); // completes alice's road along row 1

  assert.equal(util.isGameOngoing({ channel: thread }), false);
  assert.equal(thread.name, "Alice-vs-Bob");

  const finalMessage = thread.sent.find((m) => /Game Ended/.test(m.content));
  assert.ok(finalMessage, "expected a 'Game Ended' message");
  assert.match(finalMessage.content, new RegExp(`<@${bob.id}>`));

  const history = util.getHistoryFromFile(1);
  assert.match(history, /Alice, Bob/);
});
