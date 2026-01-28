require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const { test, describe } = require("node:test");

// Dynamic import to handle ES modules
const loadModule = async () => {
  const mod = await import("../src/services/discoveryConnectors.js");
  return mod;
};

describe("parseNmapPortsFromHost", async () => {
  const { parseNmapPortsFromHost } = await loadModule();

  test("parses standard nmap output with ports array", () => {
    const host = {
      ip: "192.168.1.1",
      hostname: "server1",
      ports: [
        {
          port: 22,
          protocol: "tcp",
          state: "open",
          service: { name: "ssh", product: "OpenSSH", version: "8.4" },
        },
        {
          port: 80,
          protocol: "tcp",
          state: "open",
          service: { name: "http", product: "nginx", version: "1.21.0" },
        },
        {
          port: 443,
          protocol: "tcp",
          state: "open",
          service: { name: "https" },
        },
      ],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports.length, 3);
    assert.deepEqual(ports[0], {
      port: 22,
      protocol: "tcp",
      service: "ssh",
      version: "OpenSSH 8.4",
      state: "open",
    });
    assert.deepEqual(ports[1], {
      port: 80,
      protocol: "tcp",
      service: "http",
      version: "nginx 1.21.0",
      state: "open",
    });
    assert.deepEqual(ports[2], {
      port: 443,
      protocol: "tcp",
      service: "https",
      version: undefined,
      state: "open",
    });
  });

  test("parses openPorts array format", () => {
    const host = {
      ip: "10.0.0.1",
      openPorts: [
        { port: 3306, protocol: "tcp", state: "open", service: "mysql" },
        { port: 5432, protocol: "tcp", state: "open", service: "postgresql" },
      ],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports.length, 2);
    assert.equal(ports[0].port, 3306);
    assert.equal(ports[0].service, "mysql");
    assert.equal(ports[1].port, 5432);
    assert.equal(ports[1].service, "postgresql");
  });

  test("handles portid alternative field name", () => {
    const host = {
      ports: [{ portid: 8080, protocol: "tcp", state: "open", serviceName: "http-proxy" }],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports.length, 1);
    assert.equal(ports[0].port, 8080);
    assert.equal(ports[0].service, "http-proxy");
  });

  test("filters out closed ports", () => {
    const host = {
      ports: [
        { port: 22, protocol: "tcp", state: "open", service: "ssh" },
        { port: 23, protocol: "tcp", state: "closed", service: "telnet" },
        { port: 80, protocol: "tcp", state: "filtered", service: "http" },
        { port: 443, protocol: "tcp", state: "open|filtered", service: "https" },
      ],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports.length, 2);
    assert.equal(ports[0].port, 22);
    assert.equal(ports[1].port, 443);
  });

  test("filters out invalid port numbers", () => {
    const host = {
      ports: [
        { port: 22, protocol: "tcp", state: "open" },
        { port: -1, protocol: "tcp", state: "open" },
        { port: 0, protocol: "tcp", state: "open" },
        { port: "invalid", protocol: "tcp", state: "open" },
        { port: null, protocol: "tcp", state: "open" },
      ],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports.length, 1);
    assert.equal(ports[0].port, 22);
  });

  test("handles UDP protocol", () => {
    const host = {
      ports: [
        { port: 53, protocol: "udp", state: "open", service: "dns" },
        { port: 161, protocol: "udp", state: "open", service: "snmp" },
      ],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports.length, 2);
    assert.equal(ports[0].protocol, "udp");
    assert.equal(ports[1].protocol, "udp");
  });

  test("normalizes protocol to lowercase", () => {
    const host = {
      ports: [{ port: 22, protocol: "TCP", state: "open", service: "ssh" }],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports[0].protocol, "tcp");
  });

  test("returns empty array for host without ports", () => {
    const host = { ip: "192.168.1.1" };
    const ports = parseNmapPortsFromHost(host);
    assert.deepEqual(ports, []);
  });

  test("returns empty array for null/undefined host", () => {
    assert.deepEqual(parseNmapPortsFromHost(null), []);
    assert.deepEqual(parseNmapPortsFromHost(undefined), []);
    assert.deepEqual(parseNmapPortsFromHost({}), []);
  });

  test("handles version field without service product", () => {
    const host = {
      ports: [{ port: 9200, protocol: "tcp", state: "open", service: "elasticsearch", version: "7.17.0" }],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports[0].version, "7.17.0");
  });

  test("combines service product and version correctly", () => {
    const host = {
      ports: [
        {
          port: 6379,
          protocol: "tcp",
          state: "open",
          service: { name: "redis", product: "Redis", version: "6.2.6" },
        },
      ],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports[0].service, "redis");
    assert.equal(ports[0].version, "Redis 6.2.6");
  });

  test("handles product without version", () => {
    const host = {
      ports: [
        {
          port: 27017,
          protocol: "tcp",
          state: "open",
          service: { name: "mongodb", product: "MongoDB" },
        },
      ],
    };

    const ports = parseNmapPortsFromHost(host);

    assert.equal(ports[0].version, "MongoDB");
  });
});
