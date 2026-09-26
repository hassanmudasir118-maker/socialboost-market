const { customAlphabet } = require("nanoid");

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const gen = customAlphabet(alphabet, 20);

function newId(prefix) {
  return `${prefix}_${gen()}`;
}

module.exports = { newId };
