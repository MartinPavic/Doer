import assert from "node:assert/strict";
import { mock, test } from "node:test";

let currentHandler;
mock.module("@tauri-apps/plugin-global-shortcut", {
  namedExports: {
    isRegistered: async () => currentHandler !== undefined,
    register: async (shortcut, handler) => {
      assert.equal(shortcut, "Alt+Space");
      if (currentHandler) throw new Error("Shortcut already registered");
      currentHandler = handler;
    },
    unregister: async (shortcut) => {
      assert.equal(shortcut, "Alt+Space");
      currentHandler = undefined;
    },
  },
});

const { registerShortcut, unregisterShortcut } = await import("./shortcut.ts");

test("replaces the native handler left behind by a webview reload", async () => {
  currentHandler = () => assert.fail("Called the previous webview");
  let pressed = false;
  await registerShortcut(() => { pressed = true; });
  currentHandler();
  assert.equal(pressed, true);
  await unregisterShortcut();
});

test("serializes StrictMode registration, cleanup and remount", async () => {
  currentHandler = undefined;
  const handler = () => {};
  await Promise.all([
    registerShortcut(() => {}),
    unregisterShortcut(),
    registerShortcut(handler),
  ]);
  assert.equal(currentHandler, handler);
  await unregisterShortcut();
  assert.equal(currentHandler, undefined);
});