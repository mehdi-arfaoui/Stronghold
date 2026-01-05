const express = require("express");

function createTestApp(router, mountPath, options = {}) {
  const { tenantId = "tenant-1", apiRole = "ADMIN" } = options;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = tenantId;
    req.apiRole = apiRole;
    next();
  });
  app.use(mountPath, router);
  return app;
}

function getOrCreateDelegate(prisma, key) {
  if (!prisma[key]) {
    prisma[key] = {};
  }
  return prisma[key];
}

async function withServer(app, handler) {
  const server = app.listen(0);
  await new Promise((resolve) => server.on("listening", resolve));
  const address = server.address();
  const port = typeof address === "string" ? 0 : address.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await handler(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = {
  createTestApp,
  getOrCreateDelegate,
  withServer,
};
