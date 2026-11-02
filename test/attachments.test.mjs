import test from "node:test";
import assert from "node:assert/strict";
import { collectAttachmentUuids } from "../src/client.mjs";

test("collects uuids from history and new attachments without duplicates", () => {
  const messages = [
    { role: "user", content: "a", attachment_uuids: ["u1"] },
    { role: "assistant", content: "b" },
    { role: "user", content: "c", attachments: [{ uuid: "u2" }, "u1"] },
  ];
  assert.deepEqual(collectAttachmentUuids(messages, [{ uuid: "u3" }, "u2"]), ["u1", "u2", "u3"]);
});

test("empty input gives empty list", () => {
  assert.deepEqual(collectAttachmentUuids(), []);
});
