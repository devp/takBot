// Loads commands/*.js the same way bot.js does (bot.js:23-40), without
// constructing a real discord.js Client. Safe to require from the CLI and
// from tests.

const fs = require("fs");
const path = require("path");

function loadCommands() {
  const commands = new Map();
  const commandsPath = path.join(__dirname, "..", "commands");
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
      commands.set(command.data.name, command);
    }
  }
  return commands;
}

module.exports = { loadCommands };
