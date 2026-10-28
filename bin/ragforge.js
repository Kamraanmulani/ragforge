#!/usr/bin/env node
const { main } = require("../src/cli");

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
