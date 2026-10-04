// Tests for util.js functions backed by the filesystem, sandboxed per test
// via TAKBOT_DATA_DIR (see test-helpers.js). Several of these (getGameData,
// saveGameData, getLink) also transitively call into TPS-Ninja's parseTPS /
// lz-string compression, so this tier isn't purely filesystem-only either —
// it still needs the TPS-Ninja submodule initialized.

const fs = require("fs");
const path = require("path");
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const util = require("../util");
const { withTempDataDir, seedResultsDb } = require("./test-helpers");

let tmp;

beforeEach(() => {
  tmp = withTempDataDir();
});

afterEach(() => {
  tmp.restore();
});

// saveGameData's snapshot filenames are `Date.now() + 2 random bytes`. Two
// calls in the same millisecond sort by their random suffix, not
// chronologically, which would make "the latest snapshot" ambiguous. Cross
// a millisecond boundary between writes so tests that depend on ordering
// are deterministic.
function tick() {
  const start = Date.now();
  while (Date.now() === start) {
    // busy-wait
  }
}

const EMPTY_4X4_TPS = "x4/x4/x4/x4 1 1";

function newGameData(overrides = {}) {
  return {
    player1: "Alice",
    player2: "Bob",
    size: 4,
    komi: 0,
    opening: "no-swap",
    ...overrides,
  };
}

test("createPtnFile writes a PTN header readable via getPlies", () => {
  const gameId = util.createPtnFile(newGameData());
  const ptn = util.getPlies(gameId);
  assert.match(ptn, /\[Player1 "Alice"\]/);
  assert.match(ptn, /\[Player2 "Bob"\]/);
  assert.match(ptn, /\[Size "4"\]/);
  assert.match(ptn, /\[Opening "no-swap"\]/);
});

test("addPlyToPtnFile appends plies and comments, stripping braces from comment text", () => {
  const gameId = util.createPtnFile(newGameData());
  util.addPlyToPtnFile(gameId, "a1", ["nice {move}"]);
  const ptn = util.getPlies(gameId);
  assert.match(ptn, / a1 \{nice move\}$/);
});

test("deletePtnFile removes the file; returns false without a gameId", () => {
  const gameId = util.createPtnFile(newGameData());
  assert.equal(util.deletePtnFile({ gameId }), true);

  let threw = false;
  try {
    util.getPlies(gameId);
  } catch (err) {
    threw = true;
    assert.equal(err, "Game not found");
  }
  assert.ok(threw, "expected getPlies to throw for a deleted game");

  assert.equal(util.deletePtnFile(null), false);
  assert.equal(util.deletePtnFile({}), false);
});

test("getPlies throws 'Game not found' for an unknown game id", () => {
  let threw = false;
  try {
    util.getPlies("does-not-exist");
  } catch (err) {
    threw = true;
    assert.equal(err, "Game not found");
  }
  assert.ok(threw);
});

test("getLink returns a ptn.ninja URL", () => {
  const gameId = util.createPtnFile(newGameData());
  const link = util.getLink(gameId);
  assert.match(link, /^<https:\/\/ptn\.ninja\/.+>$/);
});

test("saveGameData/getGameData round-trip for a fresh game", () => {
  const msg = { channel: { id: "chan-fresh" } };
  util.saveGameData(msg, {
    gameData: { player1Id: "p1", player2Id: "p2" },
    tps: EMPTY_4X4_TPS,
  });

  const loaded = util.getGameData(msg);
  assert.equal(loaded.player1Id, "p1");
  assert.equal(loaded.tps, EMPTY_4X4_TPS);
  assert.equal(loaded.turnMarker, "1");
  assert.equal(loaded.moveNumber, 1);
  assert.equal(loaded.hl, undefined);
});

test("getGameData returns undefined when nothing has been saved", () => {
  const msg = { channel: { id: "chan-empty" } };
  assert.equal(util.getGameData(msg), undefined);
});

test("saveGameData keeps a history of snapshots; getGameData reads the latest", () => {
  const msg = { channel: { id: "chan-history" } };
  util.saveGameData(msg, {
    gameData: { player1Id: "p1", player2Id: "p2" },
    tps: EMPTY_4X4_TPS,
  });
  tick();
  util.saveGameData(msg, { tps: "1,x3/x4/x4/x4 2 1", ply: "a1" });

  const loaded = util.getGameData(msg);
  assert.equal(loaded.tps, "1,x3/x4/x4/x4 2 1");
  assert.equal(loaded.hl, "a1");
  assert.equal(loaded.turnMarker, "2");
});

test("clearDrawOffer removes drawOffer; no-ops when nothing was saved yet", () => {
  const msg = { channel: { id: "chan-draw" } };
  assert.doesNotThrow(() => util.clearDrawOffer(msg));

  util.saveGameData(msg, {
    gameData: {
      player1Id: "p1",
      player2Id: "p2",
      drawOffer: { playerId: "p1", tps: EMPTY_4X4_TPS },
    },
    tps: EMPTY_4X4_TPS,
  });
  util.clearDrawOffer(msg);

  const loaded = util.getGameData(msg);
  assert.equal(loaded.drawOffer, undefined);
});

test("getTheme returns the default when unset", () => {
  const msg = { channel: { id: "chan-theme-default" } };
  assert.equal(util.getTheme(msg), "discord");
});

test("setTheme/getTheme round-trip: plain string", () => {
  const msg = { channel: { id: "chan-theme-string" } };
  util.setTheme(msg, "discord");
  assert.equal(util.getTheme(msg), "discord");
});

test("setTheme stores only the id for a built-in theme object", () => {
  const msg = { channel: { id: "chan-theme-builtin" } };
  util.setTheme(msg, { id: "discord", isBuildIn: true, extra: "ignored" });
  assert.equal(util.getTheme(msg), "discord");
});

test("setTheme JSON-stringifies an arbitrary theme object", () => {
  const msg = { channel: { id: "chan-theme-custom" } };
  const theme = { board: { light: "#fff" } };
  util.setTheme(msg, theme);
  assert.equal(util.getTheme(msg), JSON.stringify(theme));
});

test("isGameChannel/isGameOngoing are false before any writes, true after", () => {
  const msg = { channel: { id: "chan-flags" } };
  assert.equal(util.isGameChannel(msg), false);
  assert.equal(util.isGameOngoing(msg), false);

  util.saveGameData(msg, {
    gameData: { player1Id: "p1", player2Id: "p2" },
    tps: EMPTY_4X4_TPS,
  });

  assert.equal(util.isGameChannel(msg), true);
  assert.equal(util.isGameOngoing(msg), true);
});

test("cleanupFiles(channelDeleted=false) removes tps/ but keeps meta/", () => {
  const msg = { channel: { id: "chan-cleanup-soft" } };
  util.saveGameData(msg, {
    gameData: { player1Id: "p1", player2Id: "p2" },
    tps: EMPTY_4X4_TPS,
  });

  util.cleanupFiles(msg.channel.id, false);

  assert.equal(util.isGameOngoing(msg), false);
  assert.equal(util.isGameChannel(msg), true);
});

test("cleanupFiles(channelDeleted=true) removes the whole channel dir", () => {
  const msg = { channel: { id: "chan-cleanup-hard" } };
  util.saveGameData(msg, {
    gameData: { player1Id: "p1", player2Id: "p2" },
    tps: EMPTY_4X4_TPS,
  });

  util.cleanupFiles(msg.channel.id, true);

  assert.equal(util.isGameChannel(msg), false);
  assert.equal(util.isGameOngoing(msg), false);
});

test("cleanupFiles returns false for a non-existent channel dir", () => {
  assert.equal(util.cleanupFiles("does-not-exist", false), false);
});

test("deleteLastTurn removes the latest snapshot and trims the ply from the ptn file", () => {
  const msg = { channel: { id: "chan-undo" } };
  const gameData = newGameData();
  gameData.gameId = util.createPtnFile(gameData);
  gameData.player1Id = "p1";
  gameData.player2Id = "p2";

  util.saveGameData(msg, { gameData, tps: EMPTY_4X4_TPS });
  tick();
  util.addPlyToPtnFile(gameData.gameId, "a1");
  util.saveGameData(msg, { tps: "1,x3/x4/x4/x4 2 1", ply: "a1" });

  assert.equal(util.getGameData(msg).tps, "1,x3/x4/x4/x4 2 1");

  util.deleteLastTurn(msg, gameData);

  assert.equal(util.getGameData(msg).tps, EMPTY_4X4_TPS);
  assert.doesNotMatch(util.getPlies(gameData.gameId), /a1/);
});

test("deleteLastTurn also trims a trailing comment along with the ply", () => {
  const msg = { channel: { id: "chan-undo-comment" } };
  const gameData = newGameData();
  gameData.gameId = util.createPtnFile(gameData);

  util.saveGameData(msg, { gameData, tps: EMPTY_4X4_TPS });
  tick();
  util.addPlyToPtnFile(gameData.gameId, "a1", ["nice move"]);
  util.saveGameData(msg, { tps: "1,x3/x4/x4/x4 2 1", ply: "a1" });

  util.deleteLastTurn(msg, gameData);

  const ptn = util.getPlies(gameData.gameId);
  assert.doesNotMatch(ptn, /a1/);
  assert.doesNotMatch(ptn, /nice move/);
});

test("addToHistoryFile/getHistoryFromFile: newest-first pagination over a seeded header", () => {
  seedResultsDb(tmp.dir);

  for (let i = 1; i <= 12; i++) {
    const gameId = util.createPtnFile(newGameData());
    util.addToHistoryFile({
      gameId,
      player1: "Alice",
      player2: "Bob",
      komi: 0,
      opening: "no-swap",
      result: `R${i}`,
    });
  }

  const page1 = util.getHistoryFromFile(1);
  assert.match(page1, /Page 1 of 2/);
  assert.match(page1, /, R12$/m);
  assert.doesNotMatch(page1, /, R1$/m);

  const page2 = util.getHistoryFromFile(2);
  assert.match(page2, /Page 2 of 2/);
  assert.match(page2, /, R1$/m);
});

test("getHistoryFromFile: invalid page numbers return undefined", () => {
  seedResultsDb(tmp.dir);
  const gameId = util.createPtnFile(newGameData());
  util.addToHistoryFile({
    gameId,
    player1: "Alice",
    player2: "Bob",
    komi: 0,
    opening: "no-swap",
    result: "1-0",
  });

  assert.equal(util.getHistoryFromFile(0), undefined);
  assert.equal(util.getHistoryFromFile(NaN), undefined);
  assert.equal(util.getHistoryFromFile(-1), undefined);
  assert.equal(util.getHistoryFromFile(99), undefined);
});

test("setInactiveTimer writes a timer file; clearInactiveTimer removes it", () => {
  // util.createClient() is never called in this suite, so util.js's
  // module-private `client` stays undefined and setTimer's
  // client.channels.fetch() throws and is caught internally -- no real
  // setTimeout is ever scheduled by this test. The full suite exiting
  // promptly (see npm test) is the end-to-end proof of that.
  const msg = { channelId: "chan-timer" };
  const gameData = { player1Id: "p1", player2Id: "p2" };
  const canvas = { player: 1 };

  util.setInactiveTimer(msg, gameData, canvas);

  const timerPath = path.join(
    tmp.dir,
    "data",
    "chan-timer",
    "timers",
    "inactive.json"
  );
  assert.ok(fs.existsSync(timerPath));
  const timer = JSON.parse(fs.readFileSync(timerPath, "utf8"));
  assert.equal(timer.type, "inactive");
  assert.equal(timer.playerId, "p1");

  util.clearInactiveTimer(msg);
  assert.equal(fs.existsSync(timerPath), false);
});
