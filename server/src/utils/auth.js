const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign({ userId: user._id, email: user.email }, process.env.JWT_SECRET || "lakshya-dev-secret", {
    expiresIn: "7d"
  });
}

module.exports = { signToken };
