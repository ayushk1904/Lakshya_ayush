try {
  require("dotenv").config();
} catch (_error) {
  console.warn("dotenv not installed. Continuing with system environment variables only.");
}
const app = require("./src/app");
const connectDB = require("./src/config/db");

const host = process.env.HOST || "0.0.0.0";
const port = process.env.PORT || 5000;

connectDB().finally(() => {
  app.listen(port, host, () => {
    console.log(`Lakshya server listening on http://${host}:${port}`);
  });
});
