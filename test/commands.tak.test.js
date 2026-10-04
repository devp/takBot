// Complex example of driving a slash command through sim/fakeDiscord: tak.js
// creates a thread, writes game state to disk, and draws the opening board
// via TPS-Ninja.

const test = require("node:test");
const assert = require("node:assert/strict");
const { beforeEach, afterEach } = require("node:test");
const util = require("../util");
const takCommand = require("../commands/tak");
const { withTempDataDir } = require("./test-helpers");
const {
  createFakeUser,
  createFakeChannel,
  createFakeInteraction,
  createFakeClient,
  createOptions,
} = require("../sim/fakeDiscord");

// util.createClient() is never called in this suite, so util.js's
// module-private `client` stays undefined and setInactiveTimer's internal
// setTimer() call throws and is caught, logging "Channel not found" noise.
// Silence it the same way cli.js does (safe: util.js always calls its own
// functions via module.exports.X, so reassigning this property is picked up
// internally with no other behavior change).
util.setTimer = async () => false;

let tmp;

beforeEach(() => {
  tmp = withTempDataDir();
});

afterEach(() => {
  tmp.restore();
});

test("tak: creates a thread, writes game state, and announces the opening turn", async () => {
  const alice = createFakeUser({ username: "alice", displayName: "Alice" });
  const bob = createFakeUser({ username: "bob", displayName: "Bob" });
  const lobby = createFakeChannel({ name: "lobby" });
  const client = createFakeClient();

  const interaction = createFakeInteraction({
    commandName: "tak",
    member: alice,
    channel: lobby,
    options: createOptions({
      opponent: bob,
      size: 4,
      opening: "no-swap",
      color: 1,
    }),
  });

  await takCommand.execute(interaction, client);

  assert.equal(lobby.createdThreads.length, 1);
  const thread = lobby.createdThreads[0];
  assert.equal(thread.name, "Alice-🆚-Bob");
  assert.deepEqual(
    [...thread.memberIds].sort(),
    [alice.id, bob.id].sort()
  );

  assert.match(
    interaction._lastReply.content,
    new RegExp(`<#${thread.id}>`)
  );

  const gameData = util.getGameData({ channel: thread });
  assert.ok(gameData);
  assert.equal(gameData.player1Id, alice.id);
  assert.equal(gameData.player2Id, bob.id);

  const ptn = util.getPlies(gameData.gameId);
  assert.match(ptn, /\[Player1 "Alice"\]/);
  assert.match(ptn, /\[Player2 "Bob"\]/);

  assert.equal(thread.sent.length, 1);
  assert.equal(thread.sent[0].files.length, 1);
  assert.match(thread.sent[0].content, /Your turn 1/);
});

test("tak: rejects challenging the bot itself", async () => {
  const alice = createFakeUser({ username: "alice" });
  const lobby = createFakeChannel();
  const client = createFakeClient({ id: "BOT_ID" });
  const botAsOpponent = { id: "BOT_ID", displayName: "TakBot" };

  const interaction = createFakeInteraction({
    commandName: "tak",
    member: alice,
    channel: lobby,
    options: createOptions({ opponent: botAsOpponent, color: 1 }),
  });

  await takCommand.execute(interaction, client);

  assert.match(interaction._lastReply.content, /don't know how to play/);
  assert.equal(lobby.createdThreads.length, 0);
});

test("tak: rejects starting a game when one is already in progress", async () => {
  const alice = createFakeUser({ username: "alice" });
  const bob = createFakeUser({ username: "bob" });
  const channel = createFakeChannel();
  util.saveGameData(
    { channel },
    {
      gameData: { player1Id: alice.id, player2Id: bob.id },
      tps: "x4/x4/x4/x4 1 1",
    }
  );

  const client = createFakeClient();
  const interaction = createFakeInteraction({
    commandName: "tak",
    member: alice,
    channel,
    options: createOptions({ opponent: bob, color: 1 }),
  });

  await takCommand.execute(interaction, client);

  assert.match(interaction._lastReply.content, /game in progress/);
});

test("tak: relays an invalid TPS error from TPS-Ninja verbatim", async () => {
  const alice = createFakeUser({ username: "alice" });
  const bob = createFakeUser({ username: "bob" });
  const lobby = createFakeChannel();
  const client = createFakeClient();

  const interaction = createFakeInteraction({
    commandName: "tak",
    member: alice,
    channel: lobby,
    options: createOptions({
      opponent: bob,
      color: 1,
      tps: "not a real tps",
    }),
  });

  await takCommand.execute(interaction, client);

  assert.equal(interaction._lastReply.content, "Invalid TPS notation");
  assert.equal(lobby.createdThreads.length, 0);
});
