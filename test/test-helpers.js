// Shared test helper: sandboxes util.js's game-state file I/O to a fresh
// temp directory per test, via the TAKBOT_DATA_DIR override (util.js's
// getDataRoot()). This keeps tests from touching the repo's real data/,
// ptn/, and results.db, and from leaking state between tests.

const fs = require("fs");
const os = require("os");
const path = require("path");

function withTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "takbot-test-"));
  const previous = process.env.TAKBOT_DATA_DIR;
  process.env.TAKBOT_DATA_DIR = dir;

  return {
    dir,
    restore() {
      if (previous === undefined) {
        delete process.env.TAKBOT_DATA_DIR;
      } else {
        process.env.TAKBOT_DATA_DIR = previous;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Seeds results.db with the template's header line, matching the manual
// setup step in README.md. Without this, util.getHistoryFromFile() treats
// the first real game appended as the header row.
function seedResultsDb(dir) {
  const template = path.join(__dirname, "..", "results.db.template");
  fs.copyFileSync(template, path.join(dir, "results.db"));
}

module.exports = { withTempDataDir, seedResultsDb };
