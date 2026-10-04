// Tests for util.js functions that don't touch the filesystem or
// TPS-Ninja's rendering path. Note: util.js still requires TPS-Ninja
// unconditionally at load time (util.js:6-7), so the submodule must be
// initialized (`git submodule update --init && cd TPS-Ninja && npm i`)
// before this file can even be required, even though none of these tests
// exercise its behavior.

const test = require("node:test");
const assert = require("node:assert/strict");
const util = require("../util");

test("parsePly: plain move", () => {
  assert.deepEqual(util.parsePly("a1"), { ply: "a1", comments: [] });
});

test("parsePly: wall placement", () => {
  assert.deepEqual(util.parsePly("Sd4"), { ply: "Sd4", comments: [] });
});

test("parsePly: capstone placement", () => {
  assert.deepEqual(util.parsePly("Cc3"), { ply: "Cc3", comments: [] });
});

test("parsePly: movement with distribution", () => {
  assert.deepEqual(util.parsePly("3a1>111"), {
    ply: "3a1>111",
    comments: [],
  });
});

test("parsePly: movement with smash suffix", () => {
  assert.deepEqual(util.parsePly("2a1>11*"), {
    ply: "2a1>11*",
    comments: [],
  });
});

test("parsePly: tak suffix", () => {
  assert.deepEqual(util.parsePly("a1'"), { ply: "a1'", comments: [] });
});

test("parsePly: tinue suffix variants", () => {
  assert.deepEqual(util.parsePly('a1"'), { ply: 'a1"', comments: [] });
  assert.deepEqual(util.parsePly("a1’"), {
    ply: "a1’",
    comments: [],
  });
  assert.deepEqual(util.parsePly("a1”"), {
    ply: "a1”",
    comments: [],
  });
});

test("parsePly: single comment", () => {
  assert.deepEqual(util.parsePly("a1 {nice}"), {
    ply: "a1",
    comments: ["nice"],
  });
});

test("parsePly: multiple comments", () => {
  assert.deepEqual(util.parsePly("a1{c1}{c2}"), {
    ply: "a1",
    comments: ["c1", "c2"],
  });
});

test("parsePly: unterminated comment brace is invalid", () => {
  assert.equal(util.parsePly("a1{oops"), null);
});

test("parsePly: trailing garbage with no comment brace is invalid", () => {
  assert.equal(util.parsePly("a1x"), null);
});

test("parsePly: out-of-range square is invalid", () => {
  assert.equal(util.parsePly("z9"), null);
});

test("parsePly: empty string is invalid", () => {
  assert.equal(util.parsePly(""), null);
});

test("parsePly: non-string input is invalid", () => {
  assert.equal(util.parsePly(123), null);
  assert.equal(util.parsePly(null), null);
  assert.equal(util.parsePly(undefined), null);
});

test("parsePly: surrounding whitespace is trimmed", () => {
  assert.deepEqual(util.parsePly("  a1  "), { ply: "a1", comments: [] });
});

test("validPly: true for a valid move, false otherwise", () => {
  assert.equal(util.validPly("a1"), true);
  assert.equal(util.validPly("nonsense"), false);
  assert.equal(util.validPly(null), false);
});

test("formatComments: empty/undefined input", () => {
  assert.equal(util.formatComments(undefined), "");
  assert.equal(util.formatComments([]), "");
});

test("formatComments: single comment", () => {
  assert.equal(util.formatComments(["hello"]), "\n> hello");
});

test("formatComments: multi-line comment quotes every line", () => {
  assert.equal(
    util.formatComments(["line1\nline2"]),
    "\n> line1\n> line2"
  );
});

test("formatComments: multiple comments joined with newline", () => {
  assert.equal(util.formatComments(["c1", "c2"]), "\n> c1\n> c2");
});

test("formatPlyForEcho: double black stack special case rewrites leading count to 2", () => {
  const gameData = { opening: "double black stack" };
  const canvas = { linenum: 1, player: 2 };
  assert.equal(util.formatPlyForEcho(gameData, canvas, "a1"), "2a1");
  assert.equal(util.formatPlyForEcho(gameData, canvas, "3a1"), "2a1");
});

test("formatPlyForEcho: leaves ply unchanged for any other opening", () => {
  const gameData = { opening: "swap" };
  const canvas = { linenum: 1, player: 2 };
  assert.equal(util.formatPlyForEcho(gameData, canvas, "a1"), "a1");
});

test("formatPlyForEcho: leaves ply unchanged for wrong linenum", () => {
  const gameData = { opening: "double black stack" };
  const canvas = { linenum: 2, player: 2 };
  assert.equal(util.formatPlyForEcho(gameData, canvas, "a1"), "a1");
});

test("formatPlyForEcho: leaves ply unchanged for wrong player", () => {
  const gameData = { opening: "double black stack" };
  const canvas = { linenum: 1, player: 1 };
  assert.equal(util.formatPlyForEcho(gameData, canvas, "a1"), "a1");
});

test("formatPlyForEcho: leaves movement plies unchanged", () => {
  const gameData = { opening: "double black stack" };
  const canvas = { linenum: 1, player: 2 };
  assert.equal(util.formatPlyForEcho(gameData, canvas, "3a1>21"), "3a1>21");
});

test("formatPlyForEcho: falsy ply is returned as-is", () => {
  const gameData = { opening: "double black stack" };
  const canvas = { linenum: 1, player: 2 };
  assert.equal(util.formatPlyForEcho(gameData, canvas, ""), "");
  assert.equal(util.formatPlyForEcho(gameData, canvas, null), null);
});

test("getTurnMessage: no-ply path includes the how-to-play hint", () => {
  const gameData = { player1Id: "p1", player2Id: "p2" };
  const canvas = { linenum: 1, player: 1 };
  const message = util.getTurnMessage(gameData, canvas);
  assert.match(message, /Type a valid move in \[PTN\]/);
  assert.match(message, /Your turn 1, <@p1>\./);
});

test("getTurnMessage: single-quote ply appends Tak!", () => {
  const gameData = { player1Id: "p1", player2Id: "p2" };
  const canvas = { linenum: 2, player: 2 };
  const message = util.getTurnMessage(gameData, canvas, "a1'");
  assert.match(message, /\*Tak!\*$/);
});

test("getTurnMessage: double-quote ply appends Tinue sentence, varying with '?'", () => {
  const gameData = {
    player1Id: "p1",
    player2Id: "p2",
    player1: "Alice",
    player2: "Bob",
  };
  const canvas = { linenum: 2, player: 2 };

  const sure = util.getTurnMessage(gameData, canvas, 'a1"');
  assert.match(sure, /Alice is pretty sure that's/);
  assert.match(sure, /Tinu/);

  const unsure = util.getTurnMessage(gameData, canvas, 'a1"?');
  assert.match(unsure, /Alice thinks that might be/);
});

test("getTurnMessage: comments are appended after the echoed ply", () => {
  const gameData = { player1Id: "p1", player2Id: "p2" };
  const canvas = { linenum: 1, player: 1 };
  const message = util.getTurnMessage(gameData, canvas, "a1", ["nice move"]);
  assert.match(message, /a1 \| Your turn 1/);
  assert.match(message, /> nice move/);
});

test("shuffle: deterministic for a given seed", () => {
  const input = [1, 2, 3, 4, 5];
  const a = util.shuffle(input, 42);
  const b = util.shuffle(input, 42);
  assert.deepEqual(a, b);
});

test("shuffle: does not mutate the input array", () => {
  const input = [1, 2, 3];
  const copy = input.slice();
  util.shuffle(input, 7);
  assert.deepEqual(input, copy);
});

test("shuffle: edge cases", () => {
  assert.deepEqual(util.shuffle([], 1), []);
  assert.deepEqual(util.shuffle([1], 1), [1]);
});
