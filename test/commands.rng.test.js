// Trivial example of driving a slash command through sim/fakeDiscord: rng.js
// just reads one integer option and replies with a random number.

const test = require("node:test");
const assert = require("node:assert/strict");
const rngCommand = require("../commands/rng");
const {
  createFakeUser,
  createFakeChannel,
  createFakeInteraction,
  createOptions,
} = require("../sim/fakeDiscord");

function makeInteraction(max) {
  return createFakeInteraction({
    commandName: "rng",
    member: createFakeUser({ username: "alice" }),
    channel: createFakeChannel(),
    options: createOptions({ max }),
  });
}

test("rng: replies with the lower boundary when Math.random() returns 0", async (t) => {
  t.mock.method(Math, "random", () => 0);
  const interaction = makeInteraction(6);
  await rngCommand.execute(interaction);
  assert.equal(interaction._lastReply.content, "1");
});

test("rng: replies with the upper boundary when Math.random() is just under 1", async (t) => {
  t.mock.method(Math, "random", () => 0.999999);
  const interaction = makeInteraction(6);
  await rngCommand.execute(interaction);
  assert.equal(interaction._lastReply.content, "6");
});
