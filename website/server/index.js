const { createApp } = require("./app");

const port = Number(process.env.PORT) || 8787;
createApp().listen(port, () => {
  console.log(`[ragforge site] http://localhost:${port}`);
});
