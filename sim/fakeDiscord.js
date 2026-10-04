// A minimal set of fake objects that duck-type as discord.js User / GuildMember,
// Message, Interaction, Channel, and Client well enough to drive util.js and
// commands/*.js directly, without a real Discord connection. Used by both
// cli.js (interactive/scripted test-driving) and the test/ suite (as mocks).

let nextId = 1;
function generateId(prefix) {
  return `${prefix}${nextId++}`;
}

function createFakeUser({ id, username, displayName } = {}) {
  const resolvedUsername = username || `user${nextId}`;
  const user = {
    id: id || generateId("user"),
    username: resolvedUsername,
    displayName: displayName || resolvedUsername,
    tag: `${resolvedUsername}#0000`,
  };
  return user;
}

function buildSentMessage({ channel, content }) {
  const normalized =
    typeof content === "string" ? { content, files: [] } : content || {};
  return {
    id: generateId("msg"),
    channel,
    content: normalized.content,
    files: normalized.files || [],
    pin() {
      return Promise.resolve(this);
    },
  };
}

function createFakeChannel({ id, name, type = "text" } = {}) {
  const channel = {
    id: id || generateId("channel"),
    name: name || `channel-${nextId}`,
    type,
    sent: [],
    memberIds: new Set(),
    createdThreads: [],

    send(content) {
      const message = buildSentMessage({ channel, content });
      channel.sent.push(message);
      return Promise.resolve(message);
    },

    setName(newName) {
      channel.name = newName;
      return Promise.resolve(channel);
    },

    delete() {
      return Promise.resolve(channel);
    },

    threads: {
      create({ name: threadName } = {}) {
        const thread = createFakeChannel({ name: threadName, type: "thread" });
        channel.createdThreads.push(thread);
        return Promise.resolve(thread);
      },
    },

    members: {
      add(memberId) {
        channel.memberIds.add(memberId);
        return Promise.resolve(channel);
      },
    },
  };
  return channel;
}

function createOptions(values = {}) {
  const get = (name) => (name in values ? values[name] : null);
  return {
    getUser: get,
    getString: get,
    getInteger: get,
    getNumber: get,
    getBoolean: get,
    getSubcommand: () => get("subcommand"),
    getFocused: () => ({ name: "", value: "" }),
  };
}

// Drives the plain-text move path (bot.js's MessageCreate handler ->
// util.validPly/util.handleMove). Deliberately has no .reply/.fetchReply, so
// util.sendMessage() takes its simple channel.send() branch, matching how a
// real discord.js Message is actually handled by that code path.
function createFakeMessage({ content, author, channel }) {
  return {
    id: generateId("msg"),
    content,
    author,
    channel,
    channelId: channel.id,
    type: 0,
  };
}

// Drives the slash-command path (bot.js's InteractionCreate handler ->
// command.execute(interaction, client)).
function createFakeInteraction({
  commandName,
  member,
  channel,
  options,
  type = 2,
} = {}) {
  const interaction = {
    id: generateId("interaction"),
    commandName,
    member,
    user: member,
    channel,
    channelId: channel.id,
    type,
    options: options || createOptions(),
    replied: false,
    deferred: false,
    _lastReply: null,

    reply(content) {
      interaction.replied = true;
      interaction._lastReply = buildSentMessage({ channel, content });
      return Promise.resolve(interaction._lastReply);
    },

    fetchReply() {
      return Promise.resolve(interaction._lastReply);
    },

    followUp(content) {
      return interaction.reply(content);
    },

    deferReply() {
      interaction.deferred = true;
      return Promise.resolve();
    },

    editReply(content) {
      interaction._lastReply = buildSentMessage({ channel, content });
      return Promise.resolve(interaction._lastReply);
    },

    isAutocomplete() {
      return false;
    },

    isChatInputCommand() {
      return true;
    },
  };
  return interaction;
}

// Passed as execute(interaction, client)'s second argument. Unrelated to
// util.js's own module-private `client` (only ever set by createClient()),
// so this has no bearing on real timers/network ever being touched.
function createFakeClient({ id } = {}) {
  return { user: { id: id || "BOT_ID" } };
}

module.exports = {
  createFakeUser,
  createFakeChannel,
  createFakeMessage,
  createFakeInteraction,
  createFakeClient,
  createOptions,
};
